import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { AppError } from "./errors";
import { internalDefaults } from "./config/runtime";
import { prependToPathEnv } from "./mysqlClientPrerequisites";

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

export function runWpCli(wpRoot: string, args: string[], command?: string, pathPrepend?: string[]): string {
  ensureWpCliCommandAllowed(args);
  const wpCliPath = detectWpCliPath(command);
  const normalizedWpRoot = wpRoot.trim();
  const spawnEnv =
    pathPrepend && pathPrepend.length > 0
      ? { ...process.env, PATH: prependToPathEnv(process.env.PATH, pathPrepend) }
      : process.env;
  const result = runBinary(wpCliPath, [`--path=${normalizedWpRoot}`, ...args], spawnEnv);

  if (result.status !== 0 && !isWarningOnlyWpCliStderr(result.stderr)) {
    throw new AppError(
      "WPCLI_FAILED",
      "wp-cli command failed.",
      400,
      {
        command: `${wpCliPath} --path=${normalizedWpRoot} ${formatWpCliSubcommand(args)}`,
        subcommand: formatWpCliSubcommand(args),
        args,
        stderr: result.stderr
      }
    );
  }

  return result.stdout;
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
  const spawnEnv =
    pathPrepend && pathPrepend.length > 0
      ? { ...process.env, PATH: prependToPathEnv(process.env.PATH, pathPrepend) }
      : process.env;

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
