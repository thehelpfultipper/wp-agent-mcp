import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { AppError } from "./errors";
import { internalDefaults } from "./config/runtime";
import { prependToPathEnv } from "./mysqlClientPrerequisites";
import {
  isMysqlSocketConnectFailure,
  isWordpressDatabaseErrorDocument,
  resolveAlternateMysqlSocket,
  shouldAttachResolvedSocket,
  socketPathFromConnectFailure,
  type MysqlSocketResolution
} from "./mysqlUnixSocket";

/** Default spawnSync maxBuffer (1 MiB) is too small for `wp db query` over many large posts (base64 content). */
const WP_CLI_SPAWN_MAX_BUFFER = 64 * 1024 * 1024;

function runBinary(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: WP_CLI_SPAWN_MAX_BUFFER,
    env
  });
  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? ""
  };
}

function ensureWpCliCommandAllowed(args: string[]): void {
  const allowlist = internalDefaults.security.wpCliAllowlist;
  const blocklistTokens = internalDefaults.security.wpCliBlocklistTokens;

  for (const token of blocklistTokens) {
    if (token && args.some((arg) => arg.includes(token))) {
      throw new AppError("WPCLI_FAILED", "Blocked wp-cli argument detected by security defaults.", 400, {
        args
      });
    }
  }

  if (allowlist.length === 0) {
    return;
  }

  const matchesAllowlist = allowlist.some((allowedPrefix) => {
    if (allowedPrefix.length === 0 || allowedPrefix.length > args.length) {
      return false;
    }
    return allowedPrefix.every((allowedToken, index) => args[index] === allowedToken);
  });

  if (!matchesAllowlist) {
    throw new AppError(
      "WPCLI_FAILED",
      `wp-cli subcommand is not permitted by the configured allowlist: "${formatWpCliSubcommand(args)}". ` +
        "Add the required prefix to `security.wpCliAllowlist` in your MCP config, or set it to [] to allow all subcommands.",
      400,
      { args }
    );
  }
}

function quoteWpCliArg(value: string): string {
  if (/^[a-zA-Z0-9_./:=,@-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replace(/'/gu, "'\"'\"'")}'`;
}

export function formatWpCliSubcommand(args: string[]): string {
  return args.map((arg) => quoteWpCliArg(arg)).join(" ");
}

export function isWarningOnlyWpCliStderr(stderr: string): boolean {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }
  return lines.every((line) => /^(?:PHP\s+)?(?:Warning|Notice|Deprecated):/iu.test(line));
}

export function detectWpCliPath(command?: string): string {
  const resolvedCommand = command?.trim() || "wp";
  const whichResult = runBinary("which", [resolvedCommand]);
  if (whichResult.status !== 0 || !whichResult.stdout) {
    throw new AppError(
      "WPCLI_NOT_FOUND",
      "Unable to find wp-cli binary. Install wp-cli or ensure command is in PATH.",
      400
    );
  }
  return whichResult.stdout.split("\n")[0] ?? resolvedCommand;
}

const discoveredMysqlSockets = new Map<string, string>();

export function clearDiscoveredMysqlSocketCache(): void {
  discoveredMysqlSockets.clear();
}

export function runWpCli(wpRoot: string, args: string[], command?: string, pathPrepend?: string[]): string {
  return runWpCliAttempt(wpRoot, args, command, pathPrepend, true);
}

function runWpCliAttempt(
  wpRoot: string,
  args: string[],
  command: string | undefined,
  pathPrepend: string[] | undefined,
  useCache: boolean
): string {
  ensureWpCliCommandAllowed(args);
  const wpCliPath = detectWpCliPath(command);
  const normalizedWpRoot = wpRoot.trim();
  const baseEnv = spawnEnvForWpCli(pathPrepend);
  const cachedSocket = useCache ? discoveredMysqlSockets.get(normalizedWpRoot) : undefined;
  const firstEnv = cachedSocket ? envWithMysqlSocket(baseEnv, cachedSocket) : baseEnv;
  const first = runBinary(wpCliPath, [`--path=${normalizedWpRoot}`, ...args], firstEnv);

  if (!wpCliResultFailed(first, args)) {
    return first.stdout;
  }

  if (cachedSocket && isDatabaseConnectionFailure(first, args)) {
    discoveredMysqlSockets.delete(normalizedWpRoot);
    return runWpCliAttempt(wpRoot, args, command, pathPrepend, false);
  }

  const resolution = process.platform === "win32" || !shouldRetryMysqlSocket(first, args)
    ? null
    : resolveAlternateMysqlSocket(normalizedWpRoot, socketPathFromConnectFailure(first.stderr));
  if (resolution?.socketPath && shouldAttachResolvedSocket(resolution, first.stderr)) {
    const retried = runBinary(
      wpCliPath,
      [`--path=${normalizedWpRoot}`, ...args],
      envWithMysqlSocket(baseEnv, resolution.socketPath)
    );
    if (!wpCliResultFailed(retried, args)) {
      discoveredMysqlSockets.set(normalizedWpRoot, resolution.socketPath);
      return retried.stdout;
    }
    throw databaseConnectionError(
      wpCliPath,
      normalizedWpRoot,
      args,
      retried.stderr,
      retried.stdout,
      resolution.socketPath
    );
  }

  if (isDatabaseConnectionFailure(first, args) || resolution) {
    throw databaseConnectionError(
      wpCliPath,
      normalizedWpRoot,
      args,
      first.stderr,
      first.stdout,
      cachedSocket ?? null,
      resolution
    );
  }

  throw new AppError(
    "WPCLI_FAILED",
    "wp-cli command failed.",
    400,
    {
      command: `${wpCliPath} --path=${normalizedWpRoot} ${formatWpCliSubcommand(args)}`,
      subcommand: formatWpCliSubcommand(args),
      args,
      stderr: first.stderr
    }
  );
}

function spawnEnvForWpCli(pathPrepend?: string[]): NodeJS.ProcessEnv {
  if (pathPrepend && pathPrepend.length > 0) {
    return { ...process.env, PATH: prependToPathEnv(process.env.PATH, pathPrepend) };
  }
  return { ...process.env };
}

function envWithMysqlSocket(baseEnv: NodeJS.ProcessEnv, socketPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    MYSQL_UNIX_PORT: socketPath
  };
  if (/[\0\r\n"]/u.test(socketPath)) {
    return env;
  }
  // mysqli.default_socket is PHP_INI_SYSTEM here, so ini_set() and an auto_prepend
  // file do not move WordPress off /tmp/mysql.sock. A scanned ini is applied at
  // startup for both the wp phar and a shell launcher that re-execs PHP.
  const iniDir = phpIniDirForMysqlSocket(socketPath);
  const existingScanDir = baseEnv.PHP_INI_SCAN_DIR?.trim() ?? "";
  env.PHP_INI_SCAN_DIR = existingScanDir.length > 0
    ? `${existingScanDir}${path.delimiter}${iniDir}`
    : `:${iniDir}`;
  return env;
}

function phpIniDirForMysqlSocket(socketPath: string): string {
  const dir = path.join(
    os.tmpdir(),
    "wp-agent-mcp-mysql-socket",
    crypto.createHash("sha256").update(socketPath).digest("hex").slice(0, 16)
  );
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "socket.ini");
  const quoted = `"${socketPath.replace(/\\/gu, "\\\\")}"`;
  const contents = `mysqli.default_socket=${quoted}\npdo_mysql.default_socket=${quoted}\n`;
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== contents) {
    fs.writeFileSync(filePath, contents, { mode: 0o644 });
  }
  return dir;
}

function readDefinedDbHost(wpRoot: string): string | null {
  const candidates = [
    path.join(wpRoot, "wp-config.php"),
    path.join(path.dirname(wpRoot), "wp-config.php")
  ];
  for (const filePath of candidates) {
    let contents: string;
    try {
      contents = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const match = /define\s*\(\s*['"]DB_HOST['"]\s*,\s*['"]([^'"]*)['"]\s*\)/u.exec(contents);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function dbHostIsRemote(host: string): boolean {
  const trimmed = host.trim();
  if (trimmed.includes(":/") || trimmed.includes(":\\")) {
    return false;
  }
  const hostOnly = trimmed.split(":")[0] ?? trimmed;
  return hostOnly !== "localhost" && hostOnly !== "127.0.0.1" && hostOnly !== "::1";
}

function isEvalCommand(args: string[]): boolean {
  return args[0] === "eval" || args[0] === "eval-file";
}

function wpCliResultFailed(
  result: { status: number | null; stdout: string; stderr: string },
  args: string[]
): boolean {
  if (result.status !== 0 && !isWarningOnlyWpCliStderr(result.stderr)) {
    return true;
  }
  return isEvalCommand(args) && isWordpressDatabaseErrorDocument(result.stdout);
}

function shouldRetryMysqlSocket(
  result: { stderr: string; stdout: string },
  args: string[]
): boolean {
  return isMysqlSocketConnectFailure(result.stderr)
    || (isEvalCommand(args) && isWordpressDatabaseErrorDocument(result.stdout));
}

function isDatabaseConnectionFailure(
  result: { stderr: string; stdout: string },
  args: string[]
): boolean {
  return shouldRetryMysqlSocket(result, args);
}

function databaseConnectionError(
  wpCliPath: string,
  wpRoot: string,
  args: string[],
  stderr: string,
  stdout: string,
  retriedSocket: string | null,
  resolution?: MysqlSocketResolution | null
): AppError {
  const failedSocket = socketPathFromConnectFailure(stderr);
  let message = failedSocket
    ? `MySQL is installed, but WP-CLI could not connect through socket '${failedSocket}'.`
    : "WordPress could not connect to MySQL. wp eval printed a database connection page and exited 0.";
  const dbHost = readDefinedDbHost(wpRoot);
  if (retriedSocket) {
    message += ` A connection using socket '${retriedSocket}' failed as well.`;
  } else if (dbHost && dbHostIsRemote(dbHost)) {
    message += ` wp-config.php DB_HOST is '${dbHost}', which this host process cannot reach. Use WP-CLI from inside that same network.`;
  } else if (resolution?.configuredButMissing) {
    message += ` This site's MySQL config names '${resolution.configuredButMissing}', and that socket is not present. Start the site so MySQL is running, then retry.`;
  } else if (resolution?.unresolvedLocalSite) {
    message += " This WordPress root is a Local site, but its runtime MySQL socket was not found. Start the site in Local, then retry.";
  } else if (resolution && resolution.ambiguousSockets.length > 1) {
    message += ` More than one local MySQL socket is available (${resolution.ambiguousSockets.join(", ")}), so none was selected. Choosing one can attach this site to the wrong database.`;
  } else if (resolution?.socketPath && resolution.source === "well-known") {
    message += ` Another MySQL socket is running at '${resolution.socketPath}', and it was not used because this failure was not a socket mismatch.`;
  } else if (!retriedSocket) {
    message += " The site database did not accept this connection.";
  }
  message += " Do not symlink a MySQL socket and do not edit wp-config.php.";

  return new AppError("DB_UNREACHABLE", message, 400, {
    command: `${wpCliPath} --path=${wpRoot} ${formatWpCliSubcommand(args)}`,
    subcommand: formatWpCliSubcommand(args),
    args,
    stderr,
    stdoutSample: stdout.slice(0, 180),
    retriedSocket,
    configuredButMissing: resolution?.configuredButMissing ?? null,
    ambiguousSockets: resolution?.ambiguousSockets ?? []
  });
}

/**
 * Streams a plain `.sql` file into `wp db cli` stdin (mysql client).
 * Fallback when `wp db import` fails on SOURCE/syntax edge cases.
 */
export async function runWpDbCliStreamingSqlFile(
  wpRoot: string,
  sqlFilePath: string,
  command?: string,
  pathPrepend?: string[]
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  ensureWpCliCommandAllowed(["db", "cli"]);
  const wpCliPath = detectWpCliPath(command);
  const normalizedWpRoot = wpRoot.trim();
  const baseEnv = spawnEnvForWpCli(pathPrepend);
  const cachedSocket = discoveredMysqlSockets.get(normalizedWpRoot);
  const spawnEnv = cachedSocket ? envWithMysqlSocket(baseEnv, cachedSocket) : baseEnv;

  const child = spawn(wpCliPath, [`--path=${normalizedWpRoot}`, "db", "cli"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: spawnEnv,
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  const decoder = new TextDecoder();
  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  });

  const stdin = child.stdin;
  if (!stdin) {
    return { status: null, stdout: "", stderr: "stdin pipe unavailable for wp db cli" };
  }

  try {
    await pipeline(createReadStream(sqlFilePath), stdin);
  } catch (error: unknown) {
    stdin.destroy();
    child.kill();
    const message = error instanceof Error ? error.message : String(error);
    return { status: null, stdout: "", stderr: `Failed to stream SQL into wp db cli: ${message}` };
  }

  const status = await new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });

  return { status, stdout: stdout.trim(), stderr: stderr.trim() };
}
