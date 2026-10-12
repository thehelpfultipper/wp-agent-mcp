import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../errors";
import { createLocalDbSyncServiceWithRuntime } from "./localDbSyncService";

type CommandEntry = {
  args: string[];
};

type MutableState = {
  imported: boolean;
  commands: CommandEntry[];
};

function createWpRootFixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-sync-test-"));
}

function createDumpFile(root: string, filename = "live.sql"): string {
  const dumpPath = path.join(root, filename);
  fs.writeFileSync(dumpPath, "-- sql fixture\n");
  return dumpPath;
}

function createServiceForTest(
  wpRoot: string,
  runWpCliImpl: (state: MutableState, args: string[]) => string,
  runtimeOverrides?: Partial<{
    resolveMysqlPathPrepend: () => import("../mysqlClientPrerequisites").MysqlPathPrependResolution;
  }>
) {
  const state: MutableState = {
    imported: false,
    commands: []
  };

  const service = createLocalDbSyncServiceWithRuntime(
    {
      wpCli: "wp",
      config: {
        resolveValidWpRoot: () => wpRoot,
        getConfiguredWpRoot: () => wpRoot
      }
    },
    {
      detectWpCliPath: () => "wp",
      inflateGzipDump: async (gzipPath: string) => gzipPath,
      streamSqlIntoWpDbCli: async () => ({ status: 0, stdout: "", stderr: "" }),
      assertSyncInvariants: () => {},
      resolveMysqlPathPrepend: () => ({ prependDirs: [], autoDiscoveredDir: null }),
      runWpCli: (_wpRoot: string, args: string[]) => {
        if (args[0] === "db" && args[1] === "check") {
          state.commands.push({ args });
          return runWpCliImpl(state, args);
        }
        if (args[0] === "search-replace" && args.includes("--dry-run")) {
          state.commands.push({ args });
          return "Success: 0 replacements to be made.";
        }
        if (args[0] === "eval-file") {
          state.commands.push({ args });
          return "";
        }
        state.commands.push({ args });
        return runWpCliImpl(state, args);
      },
      ...runtimeOverrides
    }
  );

  return { service, state };
}

test("sync_local_db_from_dump preflight fails with SYNC_PREFLIGHT_FAILED when MySQL clients are missing", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "no-mysql.sql");

  const { service } = createServiceForTest(
    wpRoot,
    () => "",
    {
      resolveMysqlPathPrepend: () => {
        throw new AppError("MYSQL_CLIENT_NOT_FOUND", "missing", 400, { installHint: "hint" });
      }
    }
  );

  const result = await service.syncLocalDbFromDump({
    dumpPath,
    localUrl: "http://localhost:8888"
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "SYNC_PREFLIGHT_FAILED");
  assert.ok(result.preflight?.checks.some((c) => c.id === "mysql_clients" && c.ok === false));
});

test("sync_local_db_from_dump returns DB_SYNC_REQUIRES_ELEVATED_CONTEXT with outsideSandboxRemediation when db check looks sandbox-blocked", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "sandbox.sql");

  const { service } = createServiceForTest(wpRoot, (_ctx, args) => {
    if (args[0] === "db" && args[1] === "check") {
      throw new AppError("WPCLI_FAILED", "wp db check failed", 400, {
        stderr: "connect ECONNREFUSED 127.0.0.1:3306\n"
      });
    }
    return "";
  });

  const result = await service.syncLocalDbFromDump({
    dumpPath,
    localUrl: "http://localhost:8888"
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DB_SYNC_REQUIRES_ELEVATED_CONTEXT");
  assert.ok(result.outsideSandboxRemediation);
  assert.ok(result.outsideSandboxRemediation?.assistantMessage.includes("wp db check"));
  assert.ok(result.outsideSandboxRemediation?.verifyConnectivityCommands[0].command.includes(wpRoot));
  assert.ok(result.preflight?.checks.some((c) => c.id === "db_reachable" && c.ok === false));
  const details = result.errorDetails as { outsideSandboxRemediation?: { summary?: string } };
  assert.ok(details.outsideSandboxRemediation?.summary);
});

test("sync_local_db_from_dump succeeds for single-site and infers liveDomain safely", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "single.sql");

  const { service, state } = createServiceForTest(wpRoot, (ctx, args) => {
    if (args[0] === "eval") {
      return "0";
    }
    if (args[0] === "option" && args[1] === "get" && (args[2] === "home" || args[2] === "siteurl")) {
      return ctx.imported ? "https://www.live-example.com" : "https://project.local";
    }
    if (args[0] === "db" && args[1] === "export") {
      const backupPath = args[2];
      fs.writeFileSync(backupPath, "-- local backup\n");
      return "exported";
    }
    if (args[0] === "db" && args[1] === "import") {
      ctx.imported = true;
      return "imported";
    }
    if (args[0] === "option" && args[1] === "update") {
      return "updated";
    }
    if (args[0] === "search-replace") {
      return "replaced";
    }
    if (args[0] === "cache" && args[1] === "flush") {
      return "flushed";
    }
    return "";
  });

  const result = await service.syncLocalDbFromDump({
    dumpPath,
    multisiteMode: "auto"
  });

  assert.equal(result.success, true);
  assert.equal(result.detectedSiteType, "single-site");
  assert.equal(result.detectedLocalUrl, "https://project.local");
  assert.ok(result.warnings.some((entry) => entry.includes("Inferred liveDomain from imported DB")));
  assert.equal(result.primaryReplacementApplied?.label, "primary-domain");
  assert.ok(
    result.primaryReplacementApplied?.executedPairs.some((entry) => entry.from === "https://www.live-example.com")
  );
  assert.equal(result.additionalReplacementsApplied.length, 0);
  assert.ok(result.backupPath && fs.existsSync(result.backupPath));
  assert.ok(state.commands.some((entry) => entry.args[0] === "db" && entry.args[1] === "import"));
  assert.ok(result.preflight?.checks.length);
  assert.ok(result.verification);
  assert.equal(result.verification?.importMethod, "wp_db_import");
  assert.equal(result.verification?.dryRunReplacementsRemaining, 0);
});

test("sync_local_db_from_dump fails before import when dump path is invalid", async () => {
  const wpRoot = createWpRootFixture();
  const { service, state } = createServiceForTest(wpRoot, () => "");

  const result = await service.syncLocalDbFromDump({
    dumpPath: path.join(wpRoot, "missing.sql")
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "SYNC_PREFLIGHT_FAILED");
  assert.ok(result.preflight?.checks.some((c) => c.id === "dump_path" && c.ok === false));
  assert.equal(result.backupPath, null);
  assert.equal(result.importedDumpPath, null);
  assert.ok(state.commands.length === 0 || state.commands.every((entry) => entry.args[0] !== "db"));
});

test("sync_local_db_from_dump fails after backup if import step fails", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "fail-import.sql");

  const { service } = createServiceForTest(wpRoot, (_ctx, args) => {
    if (args[0] === "eval") {
      return "0";
    }
    if (args[0] === "option" && args[1] === "get") {
      return "https://project.local";
    }
    if (args[0] === "db" && args[1] === "export") {
      fs.writeFileSync(args[2], "-- backup\n");
      return "exported";
    }
    if (args[0] === "db" && args[1] === "import") {
      throw new Error("import exploded");
    }
    return "";
  });

  const result = await service.syncLocalDbFromDump({
    dumpPath,
    liveDomain: "www.example.com"
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DB_IMPORT_FAILED");
  assert.ok(result.backupPath);
  assert.ok(result.warnings.some((entry) => entry.includes("You can restore with: wp db import")));
});

test("sync_local_db_from_dump handles multisite path and network command construction", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "multi.sql");

  const { service, state } = createServiceForTest(wpRoot, (ctx, args) => {
    if (args[0] === "eval") {
      return "1";
    }
    if (args[0] === "option" && args[1] === "get" && (args[2] === "home" || args[2] === "siteurl")) {
      return ctx.imported ? "https://www.live-network.com" : "https://network.local";
    }
    if (args[0] === "db" && args[1] === "export") {
      fs.writeFileSync(args[2], "-- backup\n");
      return "exported";
    }
    if (args[0] === "db" && args[1] === "import") {
      ctx.imported = true;
      return "imported";
    }
    if (args[0] === "option" && args[1] === "update") {
      return "updated";
    }
    if (args[0] === "search-replace") {
      return "replaced";
    }
    if (args[0] === "site" && args[1] === "list") {
      return JSON.stringify([{ blog_id: 1, url: "https://www.live-network.com/" }]);
    }
    if (args[0] === "site" && args[1] === "update") {
      return "updated";
    }
    if (args[0] === "network" && args[1] === "list") {
      return "1\n";
    }
    if (args[0] === "network" && args[1] === "meta") {
      return "updated";
    }
    if (args[0] === "cache" && args[1] === "flush") {
      return "flushed";
    }
    return "";
  });

  const result = await service.syncLocalDbFromDump({
    dumpPath,
    liveDomain: "www.live-network.com",
    multisiteMode: "auto"
  });

  assert.equal(result.success, true);
  assert.equal(result.detectedSiteType, "multisite");
  assert.ok(result.primaryReplacementApplied);
  assert.equal(result.additionalReplacementsApplied.length, 0);
  assert.ok(
    state.commands.some(
      (entry) => entry.args[0] === "search-replace" && entry.args.some((token) => token === "--network")
    )
  );
  assert.ok(state.commands.some((entry) => entry.args[0] === "site" && entry.args[1] === "update"));
  assert.ok(state.commands.some((entry) => entry.args[0] === "network" && entry.args[1] === "meta"));
});

test("sync_local_db_from_dump applies additional replacement mappings in deterministic order", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "mapping.sql");

  const { service, state } = createServiceForTest(wpRoot, (ctx, args) => {
    if (args[0] === "eval") {
      return "0";
    }
    if (args[0] === "option" && args[1] === "get" && (args[2] === "home" || args[2] === "siteurl")) {
      return ctx.imported ? "https://www.live-example.com" : "https://project.local";
    }
    if (args[0] === "db" && args[1] === "export") {
      fs.writeFileSync(args[2], "-- backup\n");
      return "exported";
    }
    if (args[0] === "db" && args[1] === "import") {
      ctx.imported = true;
      return "imported";
    }
    if (args[0] === "option" && args[1] === "update") {
      return "updated";
    }
    if (args[0] === "search-replace") {
      return "replaced";
    }
    if (args[0] === "cache" && args[1] === "flush") {
      return "flushed";
    }
    return "";
  });

  const result = await service.syncLocalDbFromDump({
    dumpPath,
    replacementMappings: [
      {
        from: "api.example.com",
        to: "api-dev.example.com",
        label: "api-host"
      },
      {
        from: "source-token",
        to: "target-token",
        label: "auth-token"
      }
    ]
  });

  assert.equal(result.success, true);
  assert.equal(result.primaryReplacementApplied?.label, "primary-domain");
  assert.equal(result.additionalReplacementsApplied.length, 2);
  assert.equal(result.additionalReplacementsApplied[0]?.label, "api-host");
  assert.equal(result.additionalReplacementsApplied[1]?.label, "auth-token");
  assert.ok(result.additionalReplacementsApplied[0]?.executedPairs.length);
  assert.ok(result.additionalReplacementsApplied[1]?.executedPairs.length);

  const searchReplaceCalls = state.commands.filter((entry) => entry.args[0] === "search-replace");
  assert.ok(searchReplaceCalls.length >= 4);
  const firstAdditionalIndex = searchReplaceCalls.findIndex((entry) =>
    entry.args.includes("api.example.com")
  );
  const firstTokenIndex = searchReplaceCalls.findIndex((entry) => entry.args.includes("source-token"));
  assert.ok(firstAdditionalIndex >= 0);
  assert.ok(firstTokenIndex > firstAdditionalIndex);
});

test("sync_local_db_from_dump returns clear mismatch error when multisite override conflicts detection", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "mismatch.sql");

  const { service } = createServiceForTest(wpRoot, (_ctx, args) => {
    if (args[0] === "option" && args[1] === "get") {
      return "https://project.local";
    }
    if (args[0] === "db" && args[1] === "export") {
      fs.writeFileSync(args[2], "-- backup\n");
      return "exported";
    }
    if (args[0] === "db" && args[1] === "import") {
      return "imported";
    }
    if (args[0] === "eval") {
      return "1";
    }
    return "";
  });

  const result = await service.syncLocalDbFromDump({
    dumpPath,
    multisiteMode: "single-site"
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "MULTISITE_UPDATE_FAILED");
  assert.ok(result.errorMessage?.includes("conflicts with detected WordPress mode"));
});

test("sync_local_db_from_dump fails replacement phase after successful import and keeps backup path", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "replace-fail.sql");

  const { service } = createServiceForTest(wpRoot, (ctx, args) => {
    if (args[0] === "eval") {
      return "0";
    }
    if (args[0] === "option" && args[1] === "get" && (args[2] === "home" || args[2] === "siteurl")) {
      return ctx.imported ? "https://www.live-example.com" : "https://project.local";
    }
    if (args[0] === "db" && args[1] === "export") {
      fs.writeFileSync(args[2], "-- backup\n");
      return "exported";
    }
    if (args[0] === "db" && args[1] === "import") {
      ctx.imported = true;
      return "imported";
    }
    if (args[0] === "search-replace") {
      throw new Error("replace exploded");
    }
    return "";
  });

  const result = await service.syncLocalDbFromDump({
    dumpPath
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DB_URL_REPLACE_FAILED");
  assert.ok(result.backupPath);
  assert.ok(result.importedDumpPath?.endsWith("/replace-fail.sql"));
  assert.ok(result.warnings.some((entry) => entry.includes("You can restore with: wp db import")));
});

test("sync_local_db_from_dump rejects invalid replacementMappings entries", async () => {
  const wpRoot = createWpRootFixture();
  const dumpPath = createDumpFile(wpRoot, "invalid-mapping.sql");

  const { service } = createServiceForTest(wpRoot, (_ctx, args) => {
    if (args[0] === "db" && args[1] === "export") {
      fs.writeFileSync(args[2], "-- backup\n");
      return "exported";
    }
    if (args[0] === "option" && args[1] === "get") {
      return "https://project.local";
    }
    if (args[0] === "eval") {
      return "0";
    }
    return "";
  });

  const result = await service.syncLocalDbFromDump({
    dumpPath,
    replacementMappings: [
      {
        from: "same-value",
        to: "same-value",
        label: "invalid"
      }
    ]
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "TOOL_INPUT_INVALID");
  assert.ok(result.errorMessage?.includes("replacementMappings[0]"));
});
