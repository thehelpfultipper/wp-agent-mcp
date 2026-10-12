import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { AppError, type ErrorCode } from "../errors";
import type { PreflightCheck, PreflightReport } from "../dbSyncPreflight";
import { isSandboxOrNetworkBlocked } from "../dbSyncPreflight";
import { buildOutsideSandboxRemediation, type OutsideSandboxRemediation } from "../dbSyncOutsideSandboxRemediation";
import { resolveMysqlPathPrependForDbSync, type MysqlPathPrependResolution } from "../mysqlClientPrerequisites";
import { detectWpCliPath, runWpCli, runWpDbCliStreamingSqlFile } from "../wpCli";
import type { ConfigService } from "./configService";

type SiteType = "single-site" | "multisite";

export type MultisiteModeOverride = boolean | "auto" | "single-site" | "multisite";

export type SyncLocalDbFromDumpInput = {
  dumpPath: string;
  liveDomain?: string;
  localUrl?: string;
  replacementMappings?: ReplacementMappingInput[];
  multisiteMode?: MultisiteModeOverride;
  wpRoot?: string;
};

export type ReplacementMappingInput = {
  from: string;
  to: string;
  label?: string;
};

export type AppliedReplacement = {
  label: string;
  from: string;
  to: string;
  executedPairs: ReplacementPair[];
};

export type VerificationReport = {
  importMethod: "wp_db_import" | "wp_db_cli_stdin";
  wpDbCheckOk: boolean;
  homeOptionMatchesLocal: boolean;
  siteurlOptionMatchesLocal: boolean;
  multisiteCoreDomainTablesAligned?: boolean;
  dryRunReplacementsRemaining: number;
  cacheFlushOk: boolean;
  finalAssertionsPassed: boolean;
};

export type SyncLocalDbFromDumpResult = {
  success: boolean;
  backupPath: string | null;
  importedDumpPath: string | null;
  detectedSiteType: SiteType | null;
  detectedLocalUrl: string | null;
  primaryReplacementApplied: AppliedReplacement | null;
  additionalReplacementsApplied: AppliedReplacement[];
  warnings: string[];
  preflight?: PreflightReport;
  verification?: VerificationReport;
  errorCode?: ErrorCode;
  errorMessage?: string;
  errorDetails?: unknown;
  /** Present when `errorCode` is `DB_SYNC_REQUIRES_ELEVATED_CONTEXT` — copy-paste Terminal + IDE steps */
  outsideSandboxRemediation?: OutsideSandboxRemediation;
};

export type LocalDbSyncService = {
  syncLocalDbFromDump: (input: SyncLocalDbFromDumpInput) => Promise<SyncLocalDbFromDumpResult>;
};

type LocalDbSyncServiceDeps = {
  wpCli: string;
  config: ConfigService;
};

type WpCliRunner = (wpRoot: string, args: string[], command?: string, pathPrepend?: string[]) => string;
type WpCliDetector = (command?: string) => string;
type GzipInflator = (gzipPath: string) => Promise<string>;

type LocalDbSyncRuntimeDeps = {
  runWpCli: WpCliRunner;
  detectWpCliPath: WpCliDetector;
  inflateGzipDump: GzipInflator;
  resolveMysqlPathPrepend: (env?: NodeJS.ProcessEnv) => MysqlPathPrependResolution;
  streamSqlIntoWpDbCli: (
    wpRoot: string,
    sqlFilePath: string,
    command?: string,
    pathPrepend?: string[]
  ) => Promise<{ status: number | null; stdout: string; stderr: string }>;
  assertSyncInvariants: (input: {
    wpRoot: string;
    wpCli: string;
    detectedLocalUrl: string;
    resolvedSiteType: SiteType;
    pairsForDryRun: ReplacementPair[];
    multisiteCoreAligned: boolean;
    executeWpCli: WpCliRunner;
  }) => void;
};

type ReplacementPair = {
  from: string;
  to: string;
};

type ReplacementPlan = {
  label: string;
  sourceFrom: string;
  sourceTo: string;
  pairs: ReplacementPair[];
};

type LiveDomainInferenceResult = {
  liveDomain: string | null;
  ambiguousOrigins: string[];
};

function ensureNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("INVALID_DUMP_FILE", `Invalid \`${field}\`. Provide a non-empty string.`, 400, {
      field
    });
  }
  return value.trim();
}

function normalizeMultisiteOverride(mode: MultisiteModeOverride | undefined): "auto" | SiteType {
  if (typeof mode === "boolean") {
    return mode ? "multisite" : "single-site";
  }
  if (mode === "single-site" || mode === "multisite") {
    return mode;
  }
  return "auto";
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseAllowedDumpRoots(wpRoot: string): string[] {
  const fromEnv = (process.env.WP_AGENT_ALLOWED_DUMP_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const baseRoots = [wpRoot, process.cwd(), os.homedir(), ...fromEnv];

  const resolved = new Set<string>();
  for (const root of baseRoots) {
    const absoluteRoot = path.resolve(root);
    try {
      resolved.add(fs.realpathSync(absoluteRoot));
    } catch {
      resolved.add(absoluteRoot);
    }
  }
  return [...resolved];
}

function resolveValidatedDumpPath(rawDumpPath: string, wpRoot: string): string {
  const normalized = ensureNonEmptyString(rawDumpPath, "dumpPath");
  if (normalized.includes("\u0000")) {
    throw new AppError("INVALID_DUMP_FILE", "Invalid `dumpPath`. Path must not contain null bytes.", 400);
  }

  const absolutePath = path.resolve(normalized);
  if (!fs.existsSync(absolutePath)) {
    throw new AppError("INVALID_DUMP_FILE", "Dump file was not found.", 400, {
      dumpPath: absolutePath
    });
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new AppError("INVALID_DUMP_FILE", "Dump path must point to a regular file.", 400, {
      dumpPath: absolutePath
    });
  }

  const lower = absolutePath.toLowerCase();
  if (!lower.endsWith(".sql") && !lower.endsWith(".sql.gz")) {
    throw new AppError("INVALID_DUMP_FILE", "Dump file must end with `.sql` or `.sql.gz`.", 400, {
      dumpPath: absolutePath
    });
  }

  let realDumpPath = absolutePath;
  try {
    realDumpPath = fs.realpathSync(absolutePath);
  } catch {
    // Keep the resolved absolute path if realpath is unavailable.
  }

  const allowedRoots = parseAllowedDumpRoots(wpRoot);
  const isAllowed = allowedRoots.some((allowedRoot) => isPathWithinRoot(realDumpPath, allowedRoot));
  if (!isAllowed) {
    throw new AppError(
      "DUMP_PATH_NOT_ALLOWED",
      "Dump file path is outside allowed local roots. Move the dump under an allowed root or set WP_AGENT_ALLOWED_DUMP_ROOTS.",
      400,
      {
        dumpPath: realDumpPath,
        allowedRoots
      }
    );
  }

  return realDumpPath;
}

function formatTimestamp(date = new Date()): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}Z`;
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (/^https?:\/\//iu.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function tryParseUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const appearsUrlLike =
    /^https?:\/\//iu.test(trimmed)
    || trimmed.includes("/")
    || trimmed.includes(".")
    || trimmed.includes(":")
    || trimmed.toLowerCase() === "localhost";
  if (!appearsUrlLike) {
    return null;
  }
  try {
    return new URL(normalizeUrl(trimmed));
  } catch {
    return null;
  }
}

function localDomainHostPortForReplacement(parsedTo: URL): string {
  const host = parsedTo.hostname;
  if (parsedTo.port && String(parsedTo.port).length > 0) {
    return `${host}:${parsedTo.port}`;
  }
  return host;
}

function normalizeHost(rawValue: string): string {
  return rawValue
    .trim()
    .replace(/^https?:\/\//iu, "")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

function normalizeReplacementPair(rawPair: { from: string; to: string }): ReplacementPair | null {
  const from = rawPair.from.trim();
  const to = rawPair.to.trim();
  if (from.length === 0 || to.length === 0 || from === to) {
    return null;
  }
  return { from, to };
}

function buildPairsFromMapping(fromValue: string, toValue: string): ReplacementPair[] {
  const pairs: ReplacementPair[] = [];
  const parsedFrom = tryParseUrl(fromValue);
  const parsedTo = tryParseUrl(toValue);

  const registerPair = (from: string, to: string): void => {
    const normalized = normalizeReplacementPair({ from, to });
    if (!normalized) {
      return;
    }
    if (pairs.some((entry) => entry.from === normalized.from && entry.to === normalized.to)) {
      return;
    }
    pairs.push(normalized);
  };

  registerPair(fromValue, toValue);

  if (parsedFrom && parsedTo) {
    registerPair(parsedFrom.origin, parsedTo.origin);
    registerPair(`https://${parsedFrom.host}`, parsedTo.origin);
    registerPair(`http://${parsedFrom.host}`, parsedTo.origin);
    registerPair(parsedFrom.host, localDomainHostPortForReplacement(parsedTo));
    return pairs;
  }

  const normalizedFromHost = normalizeHost(fromValue);
  const normalizedToHost = normalizeHost(toValue);
  if (normalizedFromHost.length > 0 && normalizedToHost.length > 0) {
    registerPair(normalizedFromHost, normalizedToHost);
    registerPair(`https://${normalizedFromHost}`, `https://${normalizedToHost}`);
    registerPair(`http://${normalizedFromHost}`, `https://${normalizedToHost}`);
  }

  return pairs;
}

function buildReplacementPlan(input: { from: string; to: string; label?: string }, defaultLabel: string): ReplacementPlan | null {
  const sourceFrom = input.from.trim();
  const sourceTo = input.to.trim();
  if (!sourceFrom || !sourceTo) {
    return null;
  }
  if (sourceFrom === sourceTo) {
    return null;
  }

  const pairs = buildPairsFromMapping(sourceFrom, sourceTo);
  if (pairs.length === 0) {
    return null;
  }

  const label = typeof input.label === "string" && input.label.trim().length > 0 ? input.label.trim() : defaultLabel;
  return {
    label,
    sourceFrom,
    sourceTo,
    pairs
  };
}

function validateReplacementMappingsInput(
  value: ReplacementMappingInput[] | undefined
): ReplacementMappingInput[] {
  if (!value) {
    return [];
  }

  return value.map((mapping, index) => {
    const fieldBase = `replacementMappings[${String(index)}]`;
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new AppError("TOOL_INPUT_INVALID", `Invalid \`${fieldBase}\`. Each mapping must be an object.`, 400, {
        field: fieldBase
      });
    }

    const from = typeof mapping.from === "string" ? mapping.from.trim() : "";
    const to = typeof mapping.to === "string" ? mapping.to.trim() : "";
    if (!from || !to) {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        `Invalid \`${fieldBase}\`. Each mapping must include non-empty \`from\` and \`to\` values.`,
        400,
        {
          field: fieldBase
        }
      );
    }
    if (from === to) {
      throw new AppError("TOOL_INPUT_INVALID", `Invalid \`${fieldBase}\`. \`from\` and \`to\` must differ.`, 400, {
        field: fieldBase
      });
    }
    if (mapping.label !== undefined && typeof mapping.label !== "string") {
      throw new AppError("TOOL_INPUT_INVALID", `Invalid \`${fieldBase}.label\`. Label must be a string.`, 400, {
        field: `${fieldBase}.label`
      });
    }

    return {
      from,
      to,
      label: typeof mapping.label === "string" ? mapping.label.trim() : undefined
    };
  });
}

function dedupeReplacementPairs(inputPairs: ReplacementPair[]): ReplacementPair[] {
  const unique: ReplacementPair[] = [];
  for (const pair of inputPairs) {
    if (unique.some((entry) => entry.from === pair.from && entry.to === pair.to)) {
      continue;
    }
    unique.push(pair);
  }
  return unique;
}

function readWpOption(wpRoot: string, wpCli: string, key: string, executeWpCli: WpCliRunner): string | null {
  try {
    const value = executeWpCli(wpRoot, ["option", "get", key, "--format=plaintext"], wpCli).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function detectLocalUrl(wpRoot: string, wpCli: string, executeWpCli: WpCliRunner): string | null {
  const keys: string[] = ["home", "siteurl"];
  for (const key of keys) {
    const value = readWpOption(wpRoot, wpCli, key, executeWpCli);
    if (value) {
      return value;
    }
  }
  return null;
}

async function inflateGzipDump(gzipPath: string): Promise<string> {
  const tempDumpPath = path.join(os.tmpdir(), `.wp-agent-import-${Date.now()}-${process.pid}.sql`);
  await pipeline(fs.createReadStream(gzipPath), zlib.createGunzip(), fs.createWriteStream(tempDumpPath));
  return tempDumpPath;
}

function runSearchReplace(
  wpRoot: string,
  wpCli: string,
  pair: ReplacementPair,
  siteType: SiteType,
  executeWpCli: WpCliRunner
): void {
  const args = [
    "search-replace",
    pair.from,
    pair.to,
    "--all-tables-with-prefix",
    "--precise",
    "--recurse-objects",
    "--skip-columns=guid"
  ];
  if (siteType === "multisite") {
    args.push("--network");
  }
  executeWpCli(wpRoot, args, wpCli);
}

function updateMultisiteDomainData(
  wpRoot: string,
  wpCli: string,
  primaryReplacementPairs: ReplacementPair[],
  localUrl: string,
  warnings: string[],
  executeWpCli: WpCliRunner
): { sitesUpdated: number; networksUpdated: number } {
  const localParsed = tryParseUrl(localUrl);
  if (!localParsed) {
    warnings.push("Skipping multisite domain updates because `localUrl` is not a valid URL.");
    return {
      sitesUpdated: 0,
      networksUpdated: 0
    };
  }

  const sitesRaw = executeWpCli(wpRoot, ["site", "list", "--fields=blog_id,url", "--format=json"], wpCli);
  const sites = JSON.parse(sitesRaw) as Array<{ blog_id?: number | string; url?: string }>;
  let sitesUpdated = 0;

  for (const site of sites) {
    if (!site.blog_id || typeof site.url !== "string" || site.url.trim().length === 0) {
      continue;
    }

    let updatedUrl = site.url;
    for (const pair of primaryReplacementPairs) {
      if (updatedUrl.includes(pair.from)) {
        updatedUrl = updatedUrl.replace(pair.from, pair.to);
      }
    }

    const parsedUpdated = tryParseUrl(updatedUrl);
    const targetDomain = parsedUpdated?.hostname ?? localParsed.hostname;
    const targetPath = parsedUpdated?.pathname && parsedUpdated.pathname.length > 0 ? parsedUpdated.pathname : "/";

    executeWpCli(
      wpRoot,
      ["site", "update", String(site.blog_id), `--domain=${targetDomain}`, `--path=${targetPath}`],
      wpCli
    );
    sitesUpdated += 1;
  }

  const networkIdsRaw = executeWpCli(wpRoot, ["network", "list", "--field=id"], wpCli);
  const networkIds = networkIdsRaw
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  let networksUpdated = 0;
  for (const networkId of networkIds) {
    executeWpCli(wpRoot, ["network", "meta", "update", networkId, "siteurl", localParsed.origin], wpCli);
    networksUpdated += 1;
  }
  return {
    sitesUpdated,
    networksUpdated
  };
}

function inferLiveDomainFromImportedDb(
  wpRoot: string,
  wpCli: string,
  localUrl: string,
  warnings: string[],
  executeWpCli: WpCliRunner
): LiveDomainInferenceResult {
  const localParsed = tryParseUrl(localUrl);
  if (!localParsed) {
    return {
      liveDomain: null,
      ambiguousOrigins: []
    };
  }

  const optionValues = ["home", "siteurl"]
    .map((key) => readWpOption(wpRoot, wpCli, key, executeWpCli))
    .filter((value): value is string => Boolean(value));

  const parsedOrigins = optionValues
    .map((value) => tryParseUrl(value))
    .filter((value): value is URL => Boolean(value))
    .map((value) => value.origin);

  const uniqueOrigins = [...new Set(parsedOrigins)];
  if (uniqueOrigins.length !== 1) {
    if (uniqueOrigins.length > 1) {
      warnings.push(
        `Imported DB has ambiguous home/siteurl origins (${uniqueOrigins.join(", ")}); unable to safely infer liveDomain.`
      );
    }
    return {
      liveDomain: null,
      ambiguousOrigins: uniqueOrigins
    };
  }

  const inferredOrigin = uniqueOrigins[0];
  const inferredParsed = tryParseUrl(inferredOrigin);
  if (!inferredParsed) {
    return {
      liveDomain: null,
      ambiguousOrigins: uniqueOrigins
    };
  }

  const normalizedLocalOrigin = localParsed.origin;
  if (inferredParsed.origin === normalizedLocalOrigin) {
    warnings.push("Imported DB home/siteurl already match localUrl; provide liveDomain to run search-replace.");
    return {
      liveDomain: null,
      ambiguousOrigins: uniqueOrigins
    };
  }

  const localHost = localParsed.hostname.toLowerCase();
  const inferredHost = inferredParsed.hostname.toLowerCase();
  if (inferredHost === localHost) {
    warnings.push("Imported DB host matches local host; provide liveDomain explicitly for deterministic rewriting.");
    return {
      liveDomain: null,
      ambiguousOrigins: uniqueOrigins
    };
  }

  return {
    liveDomain: inferredOrigin,
    ambiguousOrigins: uniqueOrigins
  };
}

function getWpCliStderrFromError(error: unknown): string {
  if (error instanceof AppError) {
    const details = error.details as { stderr?: unknown } | undefined;
    if (details && typeof details.stderr === "string") {
      return details.stderr;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function shouldFallbackImportToWpDbCli(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    // MySQL rejects the SOURCE command (some clients don't support it)
    s.includes("'source'") ||
    s.includes("near source") ||
    s.includes("syntax error") ||
    s.includes("sql syntax") ||
    s.includes("gone away") ||
    s.includes("errno: 2") ||
    s.includes("failed to open file")
  );
}

function parseDryRunReplacementsTotal(output: string): number {
  let total = 0;
  const patterns = [/(\d+)\s+replacements?\s+to\s+be\s+made/giu, /(\d+)\s+replacements?\s+will\s+be\s+made/giu];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      total += Number.parseInt(m[1]!, 10);
    }
  }
  return total;
}

function sumDryRunReplacementsForPairs(
  wpRoot: string,
  wpCli: string,
  pairs: ReplacementPair[],
  siteType: SiteType,
  executeWpCli: WpCliRunner
): number {
  let total = 0;
  for (const pair of pairs) {
    const args = [
      "search-replace",
      pair.from,
      pair.to,
      "--dry-run",
      "--all-tables-with-prefix",
      "--precise",
      "--recurse-objects",
      "--skip-columns=guid"
    ];
    if (siteType === "multisite") {
      args.push("--network");
    }
    const out = executeWpCli(wpRoot, args, wpCli);
    total += parseDryRunReplacementsTotal(out);
  }
  return total;
}

function expectedMultisiteDomainColumn(localUrl: string): string | null {
  const parsed = tryParseUrl(localUrl);
  if (!parsed) {
    return null;
  }
  if (parsed.port && String(parsed.port).length > 0) {
    return `${parsed.hostname}:${parsed.port}`;
  }
  return parsed.hostname;
}

function assertMultisiteDomainsOrThrow(
  wpRoot: string,
  wpCli: string,
  expectedDomain: string,
  executeWpCli: WpCliRunner
): void {
  const prefix = executeWpCli(wpRoot, ["config", "get", "table_prefix", "--format=plaintext"], wpCli).trim();
  if (!/^[\w]+$/u.test(prefix)) {
    throw new AppError(
      "DB_SYNC_ASSERTION_FAILED",
      "Multisite domain assertion skipped: unexpected `table_prefix` shape from WordPress config.",
      400,
      { tablePrefix: prefix }
    );
  }
  const siteTable = `${prefix}site`;
  const blogsTable = `${prefix}blogs`;
  const siteDomain = executeWpCli(
    wpRoot,
    ["db", "query", `SELECT domain FROM ${siteTable} WHERE id=1`, "--skip-column-names"],
    wpCli
  ).trim();
  if (siteDomain !== expectedDomain) {
    throw new AppError("DB_SYNC_ASSERTION_FAILED", "Multisite `{prefix}site.domain` does not match the local target after sync.", 400, {
      expectedDomain,
      actualSiteDomain: siteDomain
    });
  }
  const escaped = expectedDomain.replace(/'/gu, "''");
  const badCountRaw = executeWpCli(
    wpRoot,
    ["db", "query", `SELECT COUNT(*) FROM ${blogsTable} WHERE domain != '${escaped}'`, "--skip-column-names"],
    wpCli
  ).trim();
  const badCount = Number.parseInt(badCountRaw, 10);
  if (!Number.isFinite(badCount) || badCount > 0) {
    throw new AppError(
      "DB_SYNC_ASSERTION_FAILED",
      "Multisite `{prefix}blogs.domain` is not fully aligned to the local target after sync.",
      400,
      {
        expectedDomain,
        mismatchedBlogRows: badCountRaw
      }
    );
  }
}

function defaultAssertSyncInvariants(input: {
  wpRoot: string;
  wpCli: string;
  detectedLocalUrl: string;
  resolvedSiteType: SiteType;
  pairsForDryRun: ReplacementPair[];
  multisiteCoreAligned: boolean;
  executeWpCli: WpCliRunner;
}): void {
  const target = normalizeOptionUrlValue(input.detectedLocalUrl);
  const home = normalizeOptionUrlValue(readWpOption(input.wpRoot, input.wpCli, "home", input.executeWpCli));
  const siteurl = normalizeOptionUrlValue(readWpOption(input.wpRoot, input.wpCli, "siteurl", input.executeWpCli));
  if (home !== target) {
    throw new AppError("DB_SYNC_ASSERTION_FAILED", "`home` option does not match `localUrl` after sync.", 400, {
      home,
      target
    });
  }
  if (siteurl !== target) {
    throw new AppError("DB_SYNC_ASSERTION_FAILED", "`siteurl` option does not match `localUrl` after sync.", 400, {
      siteurl,
      target
    });
  }
  const dryTotal = sumDryRunReplacementsForPairs(
    input.wpRoot,
    input.wpCli,
    input.pairsForDryRun,
    input.resolvedSiteType,
    input.executeWpCli
  );
  if (dryTotal > 0) {
    throw new AppError(
      "DB_SYNC_ASSERTION_FAILED",
      `Dry-run search-replace still reports ${String(dryTotal)} pending replacement(s) for the executed matrix.`,
      400,
      { dryRunReplacementsRemaining: dryTotal }
    );
  }
  if (
    input.resolvedSiteType === "multisite" &&
    process.env.WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS !== "0"
  ) {
    if (!input.multisiteCoreAligned) {
      throw new AppError(
        "DB_SYNC_ASSERTION_FAILED",
        "Multisite core `{prefix}site` / `{prefix}blogs` domain alignment did not complete while required. Set `WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS=0` only if you intentionally skip this step.",
        400,
        { multisiteCoreAligned: false }
      );
    }
    const expectedDomain = expectedMultisiteDomainColumn(input.detectedLocalUrl);
    if (expectedDomain) {
      assertMultisiteDomainsOrThrow(input.wpRoot, input.wpCli, expectedDomain, input.executeWpCli);
    }
  }
}

function alignMultisiteCoreDomainColumns(
  wpRoot: string,
  wpCli: string,
  localUrl: string,
  executeWpCli: WpCliRunner,
  warnings: string[]
): boolean {
  const tmp = path.join(os.tmpdir(), `.wp-agent-ms-dom-${process.pid}-${String(Date.now())}.php`);
  const urlLiteral = JSON.stringify(localUrl);
  const phpSource = [
    "<?php",
    "global $wpdb;",
    `$url = ${urlLiteral};`,
    "$parts = parse_url($url);",
    "if ($parts === false || empty($parts['host'])) {",
    '  fwrite(STDERR, "wp_agent_invalid_local_url\\n");',
    "  exit(1);",
    "}",
    "$domain = $parts['host'];",
    "if (!empty($parts['port'])) {",
    "  $domain = $parts['host'] . ':' . $parts['port'];",
    "}",
    "$sitePath = '/';",
    "if (!empty($parts['path']) && $parts['path'] !== '/') {",
    "  $sitePath = $parts['path'];",
    "  if (substr($sitePath, -1) !== '/') {",
    "    $sitePath .= '/';",
    "  }",
    "}",
    "$px = $wpdb->prefix;",
    "$siteTable = $px . 'site';",
    "$blogsTable = $px . 'blogs';",
    "if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $siteTable)) !== $siteTable) {",
    '  echo "skip_site";',
    "  return;",
    "}",
    '$wpdb->query($wpdb->prepare("UPDATE `" . $siteTable . "` SET domain = %s, path = %s WHERE id = 1", $domain, $sitePath));',
    "if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $blogsTable)) === $blogsTable) {",
    '$wpdb->query($wpdb->prepare("UPDATE `" . $blogsTable . "` SET domain = %s", $domain));',
    "}",
    'echo "ok";',
    ""
  ].join("\n");
  fs.writeFileSync(tmp, phpSource, "utf8");
  try {
    executeWpCli(wpRoot, ["eval-file", tmp], wpCli);
    warnings.push(
      "Aligned multisite `{prefix}site` and `{prefix}blogs` domain columns with localUrl. Set WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS=0 to skip this step for subdomain-style multisite."
    );
    return true;
  } catch (error) {
    warnings.push(
      `Multisite core domain column alignment skipped or failed: ${error instanceof Error ? error.message : String(error)}.`
    );
    return false;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function normalizeOptionUrlValue(raw: string | null): string {
  if (!raw) {
    return "";
  }
  const trimmed = raw.trim();
  const parsed = tryParseUrl(trimmed);
  if (parsed) {
    const pathPart = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/u, "");
    return `${parsed.origin}${pathPart}`;
  }
  return trimmed.replace(/\/+$/u, "");
}

function buildVerificationReport(params: {
  wpRoot: string;
  wpCli: string;
  detectedLocalUrl: string;
  resolvedSiteType: SiteType;
  allDryRunPairs: ReplacementPair[];
  executeWpCli: WpCliRunner;
  importMethod: "wp_db_import" | "wp_db_cli_stdin";
  multisiteCoreAligned: boolean;
  cacheFlushOk: boolean;
  finalAssertionsPassed: boolean;
}): VerificationReport {
  const home = readWpOption(params.wpRoot, params.wpCli, "home", params.executeWpCli);
  const siteurl = readWpOption(params.wpRoot, params.wpCli, "siteurl", params.executeWpCli);
  const target = normalizeOptionUrlValue(params.detectedLocalUrl);
  const homeNorm = normalizeOptionUrlValue(home);
  const siteNorm = normalizeOptionUrlValue(siteurl);

  const dryRunRemaining = sumDryRunReplacementsForPairs(
    params.wpRoot,
    params.wpCli,
    params.allDryRunPairs,
    params.resolvedSiteType,
    params.executeWpCli
  );

  return {
    importMethod: params.importMethod,
    wpDbCheckOk: true,
    homeOptionMatchesLocal: homeNorm === target,
    siteurlOptionMatchesLocal: siteNorm === target,
    multisiteCoreDomainTablesAligned: params.resolvedSiteType === "multisite" ? params.multisiteCoreAligned : undefined,
    dryRunReplacementsRemaining: dryRunRemaining,
    cacheFlushOk: params.cacheFlushOk,
    finalAssertionsPassed: params.finalAssertionsPassed
  };
}

async function importSqlDumpWithCliFallback(
  wpRoot: string,
  importPath: string,
  dumpPath: string,
  backupPath: string | null,
  wpCli: string,
  prependDirs: string[],
  executeWpCli: WpCliRunner,
  streamSqlIntoWpDbCli: LocalDbSyncRuntimeDeps["streamSqlIntoWpDbCli"]
): Promise<{ method: "wp_db_import" | "wp_db_cli_stdin" }> {
  try {
    executeWpCli(wpRoot, ["db", "import", importPath], wpCli);
    return { method: "wp_db_import" };
  } catch (primary) {
    const stderr = getWpCliStderrFromError(primary);
    const stdout =
      primary instanceof AppError
        ? String((primary.details as { stdout?: string } | undefined)?.stdout ?? "")
        : "";
    if (!shouldFallbackImportToWpDbCli(`${stderr}\n${stdout}`)) {
      throw new AppError("DB_IMPORT_FAILED", "`wp db import` failed and automatic `wp db cli` fallback was not applicable.", 400, {
        importedDumpPath: dumpPath,
        backupPath,
        cause: stderr,
        remediation:
          "Inspect SQL dump compatibility. If this is a SOURCE/syntax limitation, retry with the latest wp-agent (streaming `wp db cli` fallback) or decompress manually and import with `wp db cli < dump.sql`."
      });
    }
    const streamed = await streamSqlIntoWpDbCli(wpRoot, importPath, wpCli, prependDirs);
    if ((streamed.status ?? 1) !== 0) {
      throw new AppError(
        "IMPORT_METHOD_FAILED",
        "Both `wp db import` and streaming `wp db cli` failed to apply the SQL dump.",
        400,
        {
          primaryStrategy: "wp_db_import",
          primaryCause: getWpCliStderrFromError(primary),
          fallbackStrategy: "wp_db_cli_stdin",
          fallbackStatus: streamed.status,
          fallbackStderr: streamed.stderr,
          importedDumpPath: dumpPath,
          backupPath
        }
      );
    }
    return { method: "wp_db_cli_stdin" };
  }
}

function toFailureResult(
  error: unknown,
  context: {
    backupPath: string | null;
    importedDumpPath: string | null;
    detectedSiteType: SiteType | null;
    detectedLocalUrl: string | null;
    primaryReplacementApplied: AppliedReplacement | null;
    additionalReplacementsApplied: AppliedReplacement[];
    warnings: string[];
  }
): SyncLocalDbFromDumpResult {
  const errorCode: ErrorCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  const errorMessage = error instanceof Error ? error.message : "Unexpected database sync failure.";
  let preflight: PreflightReport | undefined;
  if (error instanceof AppError && error.details && typeof error.details === "object" && "preflight" in error.details) {
    const maybe = (error.details as { preflight?: PreflightReport }).preflight;
    if (maybe && Array.isArray(maybe.checks)) {
      preflight = maybe;
    }
  }
  if (
    !preflight &&
    error instanceof AppError &&
    (error.code === "SYNC_PREFLIGHT_FAILED" || error.code === "DB_SYNC_REQUIRES_ELEVATED_CONTEXT") &&
    error.details &&
    typeof error.details === "object"
  ) {
    const details = error.details as { checks?: PreflightCheck[] };
    if (Array.isArray(details.checks)) {
      preflight = { checks: details.checks };
    }
  }
  let outsideSandboxRemediation: OutsideSandboxRemediation | undefined;
  if (error instanceof AppError && error.details && typeof error.details === "object") {
    const details = error.details as { outsideSandboxRemediation?: OutsideSandboxRemediation };
    if (details.outsideSandboxRemediation) {
      outsideSandboxRemediation = details.outsideSandboxRemediation;
    }
  }
  return {
    success: false,
    backupPath: context.backupPath,
    importedDumpPath: context.importedDumpPath,
    detectedSiteType: context.detectedSiteType,
    detectedLocalUrl: context.detectedLocalUrl,
    primaryReplacementApplied: context.primaryReplacementApplied,
    additionalReplacementsApplied: context.additionalReplacementsApplied,
    warnings: context.warnings,
    preflight,
    outsideSandboxRemediation,
    errorCode,
    errorMessage,
    errorDetails: error instanceof AppError ? error.details : undefined
  };
}

export function createLocalDbSyncService(deps: LocalDbSyncServiceDeps): LocalDbSyncService {
  return createLocalDbSyncServiceWithRuntime(deps);
}

export function createLocalDbSyncServiceWithRuntime(
  deps: LocalDbSyncServiceDeps,
  runtimeDeps: Partial<LocalDbSyncRuntimeDeps> = {}
): LocalDbSyncService {
  const rt: LocalDbSyncRuntimeDeps = {
    runWpCli,
    detectWpCliPath,
    inflateGzipDump,
    resolveMysqlPathPrepend: resolveMysqlPathPrependForDbSync,
    streamSqlIntoWpDbCli: runWpDbCliStreamingSqlFile,
    assertSyncInvariants: defaultAssertSyncInvariants,
    ...runtimeDeps
  };

  const syncLocalDbFromDump = async (input: SyncLocalDbFromDumpInput): Promise<SyncLocalDbFromDumpResult> => {
    let backupPath: string | null = null;
    let importedDumpPath: string | null = null;
    let detectedSiteType: SiteType | null = null;
    let detectedLocalUrl: string | null = null;
    let primaryReplacementApplied: AppliedReplacement | null = null;
    const additionalReplacementsApplied: AppliedReplacement[] = [];
    const warnings: string[] = [];
    let tempInflatedDumpPath: string | null = null;

    try {
      const wpRoot = deps.config.resolveValidWpRoot(input.wpRoot);
      rt.detectWpCliPath(deps.wpCli);

      let dumpPath: string;
      const preflightChecks: PreflightCheck[] = [];
      try {
        dumpPath = resolveValidatedDumpPath(input.dumpPath, wpRoot);
        preflightChecks.push({ id: "dump_path", ok: true, message: `Dump file is readable at ${dumpPath}.` });
      } catch (error) {
        const message = error instanceof AppError ? error.message : String(error);
        const errorCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
        preflightChecks.push({
          id: "dump_path",
          ok: false,
          message,
          errorCode,
          remediation:
            "Pass `dumpPath` to an existing `.sql` or `.sql.gz` under WP_ROOT, cwd, home, or WP_AGENT_ALLOWED_DUMP_ROOTS."
        });
        throw new AppError(
          "SYNC_PREFLIGHT_FAILED",
          "Database sync preflight failed. Inspect `preflight.checks` for remediation steps.",
          400,
          { checks: preflightChecks }
        );
      }
      importedDumpPath = dumpPath;

      const modeOverride = normalizeMultisiteOverride(input.multisiteMode);
      const validatedReplacementMappings = validateReplacementMappingsInput(input.replacementMappings);

      if (typeof input.localUrl === "string" && input.localUrl.trim().length > 0) {
        detectedLocalUrl = input.localUrl.trim();
      } else {
        detectedLocalUrl = detectLocalUrl(wpRoot, deps.wpCli, rt.runWpCli);
      }

      const localUrlParsed = detectedLocalUrl ? tryParseUrl(detectedLocalUrl) : null;
      preflightChecks.push({
        id: "local_url",
        ok: Boolean(detectedLocalUrl && localUrlParsed),
        message: detectedLocalUrl
          ? `localUrl candidate: ${detectedLocalUrl}.`
          : "localUrl could not be determined from WordPress options.",
        remediation: !detectedLocalUrl || !localUrlParsed
          ? "Pass explicit `localUrl` (for example `http://localhost:8888`) matching your local stack."
          : undefined,
        errorCode: !detectedLocalUrl || !localUrlParsed ? "DB_URL_REPLACE_FAILED" : undefined
      });
      if (!detectedLocalUrl || !localUrlParsed) {
        throw new AppError(
          "SYNC_PREFLIGHT_FAILED",
          "Database sync preflight failed. Inspect `preflight.checks` for remediation steps.",
          400,
          { checks: preflightChecks }
        );
      }

      let prependDirs: string[];
      let autoDiscoveredDir: string | null;
      try {
        const resolvedMysql = rt.resolveMysqlPathPrepend(process.env);
        prependDirs = resolvedMysql.prependDirs;
        autoDiscoveredDir = resolvedMysql.autoDiscoveredDir;
        preflightChecks.push({
          id: "mysql_clients",
          ok: true,
          message: "mysql, mysqldump, and mysqlcheck are reachable for WP-CLI database commands."
        });
      } catch (error) {
        const message = error instanceof AppError ? error.message : String(error);
        const installHint =
          error instanceof AppError && error.details && typeof error.details === "object"
            ? String((error.details as { installHint?: string }).installHint ?? "")
            : "";
        preflightChecks.push({
          id: "mysql_clients",
          ok: false,
          message,
          remediation:
            installHint ||
            "Install MySQL client utilities and/or set WP_AGENT_EXTRA_PATH so the MCP process can run `wp db export`/`import`.",
          errorCode: "MYSQL_CLIENT_NOT_FOUND"
        });
        throw new AppError(
          "SYNC_PREFLIGHT_FAILED",
          "Database sync preflight failed. Inspect `preflight.checks` for remediation steps.",
          400,
          { checks: preflightChecks }
        );
      }

      if (autoDiscoveredDir) {
        warnings.push(
          `MySQL client tools were not on PATH; auto-discovered ${autoDiscoveredDir} for this sync. Set WP_AGENT_EXTRA_PATH in the MCP server environment to include this directory (use "${path.delimiter}" between multiple directories) so wp db export/import keep working when the IDE starts with a minimal PATH.`
        );
      }
      const executeWpCli: WpCliRunner = (wr, ar, cmd) => rt.runWpCli(wr, ar, cmd ?? deps.wpCli, prependDirs);

      try {
        executeWpCli(wpRoot, ["db", "check"], deps.wpCli);
        preflightChecks.push({
          id: "db_reachable",
          ok: true,
          message: "`wp db check` succeeded (MySQL client can reach the WordPress database)."
        });
      } catch (error) {
        const stderr = getWpCliStderrFromError(error);
        const stdout =
          error instanceof AppError
            ? String((error.details as { stdout?: string } | undefined)?.stdout ?? "")
            : "";
        const sandbox = isSandboxOrNetworkBlocked(stderr, stdout);
        const outsideSandboxRemediation = sandbox
          ? buildOutsideSandboxRemediation({
              wpRoot,
              wpCli: deps.wpCli,
              wpAgentExtraPath: process.env.WP_AGENT_EXTRA_PATH
            })
          : undefined;
        preflightChecks.push({
          id: "db_reachable",
          ok: false,
          message: stderr.length > 0 ? stderr.slice(0, 800) : "wp db check failed.",
          remediation: sandbox
            ? "Follow `outsideSandboxRemediation` / `errorDetails.outsideSandboxRemediation`: run the Terminal commands on the host, adjust Cursor MCP network/sandbox settings, then retry. No backup or import was started."
            : "Confirm MySQL is running and wp-config.php DB_HOST/DB_PORT (or socket) is correct for this machine.",
          errorCode: sandbox ? "DB_SYNC_REQUIRES_ELEVATED_CONTEXT" : "DB_UNREACHABLE"
        });
        if (sandbox) {
          throw new AppError(
            "DB_SYNC_REQUIRES_ELEVATED_CONTEXT",
            "This sync needs out-of-sandbox access to reach the WordPress database (commonly 127.0.0.1 or a local MySQL port). No backup or import was started. Use `outsideSandboxRemediation.assistantMessage` (or `errorDetails`) for copy-paste Terminal commands and MCP steps, then retry `sync_local_db_from_dump`.",
            400,
            { checks: preflightChecks, outsideSandboxRemediation }
          );
        }
        throw new AppError(
          "SYNC_PREFLIGHT_FAILED",
          "Database sync preflight failed. Inspect `preflight.checks` for remediation steps.",
          400,
          { checks: preflightChecks }
        );
      }

      const preflightReport: PreflightReport = { checks: preflightChecks };

      backupPath = path.join(wpRoot, `.wp-agent-db-backup-${formatTimestamp()}.sql`);
      try {
        executeWpCli(wpRoot, ["db", "export", backupPath, "--add-drop-table"], deps.wpCli);
        if (!fs.existsSync(backupPath)) {
          throw new Error("wp db export completed but backup file does not exist.");
        }
      } catch (error) {
        throw new AppError("DB_BACKUP_FAILED", "Failed to create local database backup before import.", 400, {
          backupPath,
          cause: error instanceof Error ? error.message : String(error),
          preflight: preflightReport
        });
      }

      let importPath = dumpPath;
      if (dumpPath.toLowerCase().endsWith(".sql.gz")) {
        tempInflatedDumpPath = await rt.inflateGzipDump(dumpPath);
        importPath = tempInflatedDumpPath;
      }

      let importMethod: "wp_db_import" | "wp_db_cli_stdin" = "wp_db_import";
      try {
        const importOutcome = await importSqlDumpWithCliFallback(
          wpRoot,
          importPath,
          dumpPath,
          backupPath,
          deps.wpCli,
          prependDirs,
          executeWpCli,
          rt.streamSqlIntoWpDbCli
        );
        importMethod = importOutcome.method;
        if (importMethod === "wp_db_cli_stdin") {
          warnings.push("Primary `wp db import` failed with SOURCE/SQL edge behavior; applied dump via streaming `wp db cli` instead.");
        }
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === "IMPORT_METHOD_FAILED" || error.code === "DB_IMPORT_FAILED")
        ) {
          throw error;
        }
        throw new AppError("DB_IMPORT_FAILED", "Failed to import the provided SQL dump.", 400, {
          importedDumpPath: dumpPath,
          backupPath,
          cause: getWpCliStderrFromError(error),
          preflight: preflightReport
        });
      }

      const multisiteDetected =
        executeWpCli(wpRoot, ["eval", "echo is_multisite() ? '1' : '0';"], deps.wpCli).trim() === "1";
      const autoDetectedSiteType: SiteType = multisiteDetected ? "multisite" : "single-site";
      if (modeOverride !== "auto" && modeOverride !== autoDetectedSiteType) {
        throw new AppError(
          "MULTISITE_UPDATE_FAILED",
          `multisiteMode "${modeOverride}" conflicts with detected WordPress mode "${autoDetectedSiteType}". Use \`auto\` or match the detected mode.`,
          400,
          {
            requestedMultisiteMode: modeOverride,
            detectedSiteType: autoDetectedSiteType
          }
        );
      }
      detectedSiteType = modeOverride === "auto" ? autoDetectedSiteType : modeOverride;
      if (!detectedSiteType) {
        throw new AppError("INTERNAL_ERROR", "Failed to resolve site type for local DB sync.", 500);
      }
      const resolvedSiteType = detectedSiteType;
      if (modeOverride !== "auto") {
        warnings.push(`Used multisite override "${modeOverride}" (auto-detected: ${autoDetectedSiteType}).`);
      }

      let liveDomain = typeof input.liveDomain === "string" ? input.liveDomain.trim() : "";
      let inferredOrigins: string[] = [];
      if (!liveDomain) {
        const inferred = inferLiveDomainFromImportedDb(
          wpRoot,
          deps.wpCli,
          detectedLocalUrl,
          warnings,
          executeWpCli
        );
        inferredOrigins = inferred.ambiguousOrigins;
        if (inferred.liveDomain) {
          liveDomain = inferred.liveDomain;
          warnings.push(`Inferred liveDomain from imported DB: ${inferred.liveDomain}`);
        }
      }

      if (!liveDomain) {
        throw new AppError(
          "DB_URL_REPLACE_FAILED",
          "Could not safely infer `liveDomain` from the imported DB. Provide `liveDomain` explicitly.",
          400,
          {
            requiredField: "liveDomain",
            localUrl: detectedLocalUrl,
            inferredOrigins
          }
        );
      }

      const primaryPlan = buildReplacementPlan(
        {
          from: liveDomain,
          to: detectedLocalUrl,
          label: "primary-domain"
        },
        "primary-domain"
      );
      if (!primaryPlan) {
        throw new AppError(
          "DB_URL_REPLACE_FAILED",
          "Unable to construct deterministic replacement pairs. Provide explicit `liveDomain` and `localUrl`.",
          400,
          {
            liveDomain,
            localUrl: detectedLocalUrl
          }
        );
      }

      const additionalPlans: ReplacementPlan[] = [];
      for (let index = 0; index < validatedReplacementMappings.length; index += 1) {
        const mapping = validatedReplacementMappings[index];
        const defaultLabel = `replacement-${String(index + 1)}`;
        const plan = buildReplacementPlan(mapping, defaultLabel);
        if (!plan) {
          throw new AppError(
            "TOOL_INPUT_INVALID",
            `Invalid \`replacementMappings[${String(index)}]\`. Could not construct deterministic replacement pairs.`,
            400,
            {
              field: `replacementMappings[${String(index)}]`
            }
          );
        }
        additionalPlans.push(plan);
      }

      const usedPairKeys = new Set<string>();
      const applyReplacementPlan = (plan: ReplacementPlan): AppliedReplacement => {
        const executedPairs: ReplacementPair[] = [];
        const dedupedPairs = dedupeReplacementPairs(plan.pairs);
        for (const pair of dedupedPairs) {
          const pairKey = `${pair.from}:::${pair.to}`;
          if (usedPairKeys.has(pairKey)) {
            continue;
          }
          runSearchReplace(wpRoot, deps.wpCli, pair, resolvedSiteType, executeWpCli);
          usedPairKeys.add(pairKey);
          executedPairs.push(pair);
        }
        return {
          label: plan.label,
          from: plan.sourceFrom,
          to: plan.sourceTo,
          executedPairs
        };
      };

      let multisiteCoreAligned = false;
      if (detectedLocalUrl) {
        try {
          executeWpCli(wpRoot, ["option", "update", "home", detectedLocalUrl], deps.wpCli);
          executeWpCli(wpRoot, ["option", "update", "siteurl", detectedLocalUrl], deps.wpCli);
        } catch (error) {
          throw new AppError("DB_URL_REPLACE_FAILED", "Failed to set canonical local `home` / `siteurl` before search-replace.", 400, {
            backupPath,
            localUrl: detectedLocalUrl,
            cause: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (resolvedSiteType === "multisite" && process.env.WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS !== "0") {
        multisiteCoreAligned = alignMultisiteCoreDomainColumns(
          wpRoot,
          deps.wpCli,
          detectedLocalUrl,
          executeWpCli,
          warnings
        );
      }

      try {
        primaryReplacementApplied = applyReplacementPlan(primaryPlan);
      } catch (error) {
        throw new AppError("DB_URL_REPLACE_FAILED", "Search-replace failed while rewriting primary site URLs.", 400, {
          backupPath,
          liveDomain,
          localUrl: detectedLocalUrl,
          cause: error instanceof Error ? error.message : String(error)
        });
      }

      try {
        for (const plan of additionalPlans) {
          additionalReplacementsApplied.push(applyReplacementPlan(plan));
        }
      } catch (error) {
        throw new AppError("DB_URL_REPLACE_FAILED", "Search-replace failed while applying additional replacements.", 400, {
          backupPath,
          localUrl: detectedLocalUrl,
          cause: error instanceof Error ? error.message : String(error)
        });
      }

      if (primaryReplacementApplied.executedPairs.length === 0) {
        warnings.push("Primary replacement mapping produced no unique search-replace commands.");
      }

      if (detectedSiteType === "multisite") {
        try {
          if (detectedLocalUrl) {
            const multisiteUpdates = updateMultisiteDomainData(
              wpRoot,
              deps.wpCli,
              primaryReplacementApplied.executedPairs,
              detectedLocalUrl,
              warnings,
              executeWpCli
            );
            warnings.push(
              `Multisite domain updates applied to ${String(multisiteUpdates.sitesUpdated)} site(s) and ${String(multisiteUpdates.networksUpdated)} network(s).`
            );
          } else {
            warnings.push("Multisite detected but local URL is unknown; skipped network domain updates.");
          }
        } catch (error) {
          throw new AppError("MULTISITE_UPDATE_FAILED", "Multisite post-import updates failed.", 400, {
            backupPath,
            localUrl: detectedLocalUrl,
            cause: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const pairsForDryRun = dedupeReplacementPairs([
        ...primaryReplacementApplied.executedPairs,
        ...additionalReplacementsApplied.flatMap((entry) => entry.executedPairs)
      ]);

      rt.assertSyncInvariants({
        wpRoot,
        wpCli: deps.wpCli,
        detectedLocalUrl,
        resolvedSiteType,
        pairsForDryRun,
        multisiteCoreAligned,
        executeWpCli
      });

      let cacheFlushOk = true;
      try {
        executeWpCli(wpRoot, ["cache", "flush"], deps.wpCli);
      } catch {
        cacheFlushOk = false;
        warnings.push("Cache flush failed; database import succeeded but cache may still contain stale values.");
      }

      const verification = buildVerificationReport({
        wpRoot,
        wpCli: deps.wpCli,
        detectedLocalUrl,
        resolvedSiteType,
        allDryRunPairs: pairsForDryRun,
        executeWpCli,
        importMethod,
        multisiteCoreAligned,
        cacheFlushOk,
        finalAssertionsPassed: true
      });

      return {
        success: true,
        backupPath,
        importedDumpPath,
        detectedSiteType,
        detectedLocalUrl,
        primaryReplacementApplied,
        additionalReplacementsApplied,
        warnings,
        preflight: preflightReport,
        verification
      };
    } catch (error) {
      if (backupPath) {
        warnings.push(`Local backup is available at ${backupPath}. You can restore with: wp db import "${backupPath}"`);
      }
      return toFailureResult(error, {
        backupPath,
        importedDumpPath,
        detectedSiteType,
        detectedLocalUrl,
        primaryReplacementApplied,
        additionalReplacementsApplied,
        warnings
      });
    } finally {
      if (tempInflatedDumpPath) {
        try {
          fs.unlinkSync(tempInflatedDumpPath);
        } catch {
          // Ignore temp cleanup failures.
        }
      }
    }
  };

  return {
    syncLocalDbFromDump
  };
}

