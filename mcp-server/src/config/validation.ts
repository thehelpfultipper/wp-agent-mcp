import fs from "node:fs";
import path from "node:path";
import { detectExecutable } from "./executables";

export class ConfigValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    const normalizedIssues = issues.filter((issue) => issue.trim().length > 0);
    super(`Invalid MCP server configuration:\n${normalizedIssues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ConfigValidationError";
    this.issues = normalizedIssues;
  }
}

export function parsePort(rawPort: string | undefined, fallback = 7337): number {
  const parsed = Number.parseInt(rawPort ?? String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveWpCli(rawCommand: string | undefined, pathValue: string | undefined): string {
  const detected = detectExecutable({
    rawValue: rawCommand,
    pathValue,
    fallbackCommand: "wp",
    probeArgs: ["--info"],
    missingExecutableMessage:
      "WP_CLI is not set and auto-detection failed for `wp` on PATH. Install WP-CLI and ensure `wp` is available on PATH, or set WP_CLI explicitly (for example: export WP_CLI=/usr/local/bin/wp).",
    explicitInvalidMessage: (value) =>
      `WP_CLI is set to \`${value}\`, but it is not callable. Set WP_CLI to a valid WP-CLI executable path`
  });
  if (detected.issues.length > 0) {
    throw new ConfigValidationError(detected.issues);
  }
  return detected.executablePath;
}

export function resolvePhpBin(rawCommand: string | undefined, pathValue: string | undefined): string {
  const detected = detectExecutable({
    rawValue: rawCommand,
    pathValue,
    fallbackCommand: "php",
    probeArgs: ["-v"],
    missingExecutableMessage:
      "PHP_BIN is not set and auto-detection failed for `php` on PATH. Install PHP and ensure `php` is available on PATH, or set PHP_BIN explicitly (for example: export PHP_BIN=/usr/local/bin/php).",
    explicitInvalidMessage: (value) =>
      `PHP_BIN is set to \`${value}\`, but it is not callable. Set PHP_BIN to a valid PHP executable path`
  });
  if (detected.issues.length > 0) {
    throw new ConfigValidationError(detected.issues);
  }
  return detected.executablePath;
}

export function validateWpRoot(rawWpRoot: string | undefined): string {
  const issues: string[] = [];
  const trimmed = rawWpRoot?.trim();

  if (!trimmed) {
    issues.push(
      "WP_ROOT is required. Set WP_ROOT to the absolute path of your WordPress installation (for example: /path/to/wordpress)."
    );
    throw new ConfigValidationError(issues);
  }

  const resolvedWpRoot = path.resolve(trimmed);
  if (!fs.existsSync(resolvedWpRoot)) {
    issues.push(`WP_ROOT path does not exist: ${resolvedWpRoot}`);
  } else {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(resolvedWpRoot);
    } catch {
      issues.push(`Unable to read WP_ROOT path: ${resolvedWpRoot}`);
    }

    if (stat && !stat.isDirectory()) {
      issues.push(`WP_ROOT must point to a directory: ${resolvedWpRoot}`);
    }
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  const wpIncludesPath = path.join(resolvedWpRoot, "wp-includes");
  const wpConfigPath = path.join(resolvedWpRoot, "wp-config.php");
  const parentWpConfigPath = path.join(path.dirname(resolvedWpRoot), "wp-config.php");
  const hasWpIncludes = fs.existsSync(wpIncludesPath) && fs.statSync(wpIncludesPath).isDirectory();
  const hasWpConfig = fs.existsSync(wpConfigPath) || fs.existsSync(parentWpConfigPath);

  if (!hasWpIncludes && !hasWpConfig) {
    throw new ConfigValidationError([
      `WP_ROOT is not a valid WordPress root: ${resolvedWpRoot}`,
      "Expected `wp-includes` in WP_ROOT or `wp-config.php` in WP_ROOT (or its parent directory)."
    ]);
  }

  return resolvedWpRoot;
}
