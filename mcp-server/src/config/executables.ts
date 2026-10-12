import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type DetectExecutableOptions = {
  rawValue: string | undefined;
  pathValue: string | undefined;
  fallbackCommand: string;
  probeArgs: string[];
  missingExecutableMessage: string;
  explicitInvalidMessage: (value: string) => string;
};

type DetectExecutableResult = {
  executablePath: string;
  issues: string[];
};

function hasPathSeparators(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

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

function resolveCommandFromPath(command: string, pathValue: string | undefined): string | null {
  const rawPath = pathValue ?? "";
  if (!rawPath) {
    return null;
  }

  const pathEntries = rawPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of pathEntries) {
    const candidate = path.join(entry, command);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

function probeExecutable(executablePath: string, args: string[]): string | null {
  const result = spawnSync(executablePath, args, { encoding: "utf8", timeout: 10000 });
  if (result.error) {
    return result.error.message;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const details = stderr || stdout || `process exited with code ${String(result.status)}`;
    return details;
  }
  return null;
}

export function detectExecutable(options: DetectExecutableOptions): DetectExecutableResult {
  const issues: string[] = [];
  const explicitValue = options.rawValue?.trim();
  const explicitCandidate = explicitValue && explicitValue.length > 0 ? explicitValue : null;

  if (explicitCandidate) {
    const explicitPath = hasPathSeparators(explicitCandidate)
      ? path.resolve(explicitCandidate)
      : (resolveCommandFromPath(explicitCandidate, options.pathValue) ?? explicitCandidate);
    const probeFailure = probeExecutable(explicitPath, options.probeArgs);
    if (probeFailure) {
      issues.push(`${options.explicitInvalidMessage(explicitCandidate)} (${probeFailure})`);
      return { executablePath: explicitCandidate, issues };
    }
    return { executablePath: explicitPath, issues };
  }

  const fallbackPath = resolveCommandFromPath(options.fallbackCommand, options.pathValue);
  if (!fallbackPath) {
    issues.push(options.missingExecutableMessage);
    return { executablePath: options.fallbackCommand, issues };
  }

  const probeFailure = probeExecutable(fallbackPath, options.probeArgs);
  if (probeFailure) {
    issues.push(`${options.missingExecutableMessage} (${probeFailure})`);
    return { executablePath: options.fallbackCommand, issues };
  }

  return { executablePath: fallbackPath, issues };
}
