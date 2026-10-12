import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./errors";
import {
  areMysqlCliToolsReachableWithPath,
  parseWpAgentExtraPath,
  prependToPathEnv,
  resolveMysqlPathPrependForDbSync
} from "./mysqlClientPrerequisites";

test("parseWpAgentExtraPath trims and resolves entries", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-mysql-path-"));
  const a = path.join(tmp, "a");
  const b = path.join(tmp, "b");
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  const joined = `${a}${path.delimiter}  ${b}  ${path.delimiter}`;
  const parsed = parseWpAgentExtraPath(joined);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0], path.resolve(a));
  assert.equal(parsed[1], path.resolve(b));
});

test("prependToPathEnv preserves order and merges tail", () => {
  const merged = prependToPathEnv("/usr/bin:/bin", ["/opt/mysql"]);
  assert.ok(merged.startsWith(`/opt/mysql${path.delimiter}`));
  assert.ok(merged.includes("/usr/bin"));
});

test("areMysqlCliToolsReachableWithPath returns true when all three exist on PATH", () => {
  if (process.platform === "win32") {
    return;
  }
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-mysql-cli-"));
  const names = ["mysql", "mysqldump", "mysqlcheck"] as const;
  for (const name of names) {
    const fp = path.join(binDir, name);
    fs.writeFileSync(fp, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(fp, 0o755);
  }
  const pathEnv = prependToPathEnv("", [binDir]);
  assert.equal(areMysqlCliToolsReachableWithPath(pathEnv), true);
});

test("resolveMysqlPathPrependForDbSync uses WP_AGENT_EXTRA_PATH when binaries live there", () => {
  if (process.platform === "win32") {
    return;
  }
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-mysql-cli-"));
  for (const name of ["mysql", "mysqldump", "mysqlcheck"] as const) {
    const fp = path.join(binDir, name);
    fs.writeFileSync(fp, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(fp, 0o755);
  }
  const env = {
    ...process.env,
    PATH: "/nonexistent-only",
    WP_AGENT_EXTRA_PATH: binDir
  };
  const result = resolveMysqlPathPrependForDbSync(env);
  assert.deepEqual(result.prependDirs, [path.resolve(binDir)]);
  assert.equal(result.autoDiscoveredDir, null);
});
