import fs from "node:fs";
import path from "node:path";
import { AppError } from "./errors";

const MYSQL_CLI_BASES = ["mysql", "mysqldump", "mysqlcheck"] as const;

export type MysqlPathPrependResolution = {
  prependDirs: string[];
  autoDiscoveredDir: string | null;
};

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function mysqlBinaryCandidates(dir: string, base: string): string[] {
  const normalized = path.resolve(dir);
  if (isWindows()) {
    return [path.join(normalized, `${base}.exe`), path.join(normalized, `${base}.cmd`)];
  }
  return [path.join(normalized, base)];
}

function directoryProvidesAllMysqlClients(dir: string): boolean {
  for (const base of MYSQL_CLI_BASES) {
    const candidates = mysqlBinaryCandidates(dir, base);
    const ok = candidates.some((candidate) => {
      if (isWindows()) {
        return fs.existsSync(candidate);
      }
      return isExecutableFile(candidate);
    });
    if (!ok) {
      return false;
    }
  }
  return true;
}

export function parseWpAgentExtraPath(raw: string | undefined): string[] {
  if (!raw || typeof raw !== "string") {
    return [];
  }
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));
}

export function prependToPathEnv(existingPath: string | undefined, prependDirs: string[]): string {
  const head = prependDirs
    .map((dir) => path.resolve(dir))
    .filter((dir) => dir.length > 0);
  const tail = (existingPath ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...head, ...tail].join(path.delimiter);
}

function binaryExistsOnPathSegment(segment: string, base: string): boolean {
  return mysqlBinaryCandidates(segment, base).some((candidate) =>
    isWindows() ? fs.existsSync(candidate) : isExecutableFile(candidate)
  );
}

export function areMysqlCliToolsReachableWithPath(pathEnv: string): boolean {
  const segments = pathEnv
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const base of MYSQL_CLI_BASES) {
    const found = segments.some((segment) => binaryExistsOnPathSegment(segment, base));
    if (!found) {
      return false;
    }
  }
  return true;
}

function discoverMysqlClientBinDirFromWellKnownLocations(): string | null {
  const candidates: string[] = [];

  if (process.platform === "darwin") {
    candidates.push(
      "/opt/homebrew/opt/mysql-client/bin",
      "/opt/homebrew/opt/mysql/bin",
      "/usr/local/opt/mysql-client/bin",
      "/usr/local/opt/mysql/bin",
      "/usr/local/mysql/bin"
    );
  } else if (isWindows()) {
    const pf = process.env.ProgramFiles;
    const pfx86 = process.env["ProgramFiles(x86)"];
    if (pf) {
      candidates.push(path.join(pf, "MySQL", "MySQL Server 8.4", "bin"));
      candidates.push(path.join(pf, "MySQL", "MySQL Server 8.3", "bin"));
      candidates.push(path.join(pf, "MySQL", "MySQL Server 8.2", "bin"));
      candidates.push(path.join(pf, "MySQL", "MySQL Server 8.1", "bin"));
      candidates.push(path.join(pf, "MySQL", "MySQL Server 8.0", "bin"));
    }
    if (pfx86) {
      candidates.push(path.join(pfx86, "MySQL", "MySQL Server 8.0", "bin"));
    }
  } else {
    candidates.push("/usr/bin", "/usr/local/bin", "/opt/mysql/bin");
    const home = process.env.HOME;
    if (home) {
      candidates.push(path.join(home, ".linuxbrew", "opt", "mysql-client", "bin"));
    }
  }

  for (const dir of candidates) {
    try {
      if (directoryProvidesAllMysqlClients(dir)) {
        return path.resolve(dir);
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Ensures mysql, mysqldump, and mysqlcheck are reachable for WP-CLI `db export` / `db import`.
 * Honors WP_AGENT_EXTRA_PATH (prepend to PATH), then scans well-known install locations (macOS / Windows / Linux).
 */
export function resolveMysqlPathPrependForDbSync(env: NodeJS.ProcessEnv = process.env): MysqlPathPrependResolution {
  const fromConfig = parseWpAgentExtraPath(env.WP_AGENT_EXTRA_PATH);
  const pathWithConfig = prependToPathEnv(env.PATH, fromConfig);
  if (areMysqlCliToolsReachableWithPath(pathWithConfig)) {
    return { prependDirs: fromConfig, autoDiscoveredDir: null };
  }

  const discovered = discoverMysqlClientBinDirFromWellKnownLocations();
  if (discovered && !fromConfig.includes(discovered)) {
    const combined = [...fromConfig, discovered];
    const pathWithDiscovery = prependToPathEnv(env.PATH, combined);
    if (areMysqlCliToolsReachableWithPath(pathWithDiscovery)) {
      return { prependDirs: combined, autoDiscoveredDir: discovered };
    }
  }

  const installHint = isWindows()
    ? "Install MySQL Server or MySQL Shell (includes client tools) from https://dev.mysql.com/downloads/mysql/ and add the installation `bin` folder to PATH, or set WP_AGENT_EXTRA_PATH to that folder (often under Program Files\\MySQL\\MySQL Server 8.x\\bin)."
    : "Install client tools (for example: `brew install mysql-client`) and ensure the `bin` directory is on PATH, or set WP_AGENT_EXTRA_PATH to that directory (for example `/opt/homebrew/opt/mysql-client/bin` on Apple Silicon).";

  throw new AppError(
    "MYSQL_CLIENT_NOT_FOUND",
    "MySQL client programs (mysql, mysqldump, mysqlcheck) are required for database import/export but were not found on PATH.",
    400,
    {
      missingBinaries: [...MYSQL_CLI_BASES],
      recommendedEnv: "WP_AGENT_EXTRA_PATH",
      recommendedEnvExample: isWindows()
        ? "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin"
        : "/opt/homebrew/opt/mysql-client/bin",
      installHint,
      mcpConfigHint:
        "If tools work in Terminal but not here, Cursor may start the MCP server with a reduced PATH. Add WP_AGENT_EXTRA_PATH (and optionally merge PATH) in your MCP server `env` block so the same bin directory is visible to the wp-agent process."
    }
  );
}
