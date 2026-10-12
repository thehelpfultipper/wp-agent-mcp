import fs from "node:fs";
import path from "node:path";
import { AppError } from "./errors";

function normalize(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function assertWithinRoot(root: string, targetPath: string, label = "path"): string {
  const safeRoot = normalize(root);
  const safeTarget = normalize(targetPath);
  const relative = path.relative(safeRoot, safeTarget);
  const isInside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (!isInside) {
    throw new AppError(
      "WP_ROOT_INVALID",
      `${label} must be within WP_ROOT`,
      400,
      { root: safeRoot, requested: safeTarget }
    );
  }

  return safeTarget;
}

export function resolveWpRoot(inputWpRoot: string | undefined, configuredWpRoot?: string): string {
  if (!inputWpRoot) {
    throw new AppError(
      "WP_ROOT_INVALID",
      "Missing wpRoot. Provide POST body { \"wpRoot\": \"/absolute/path\" } or set WP_ROOT."
    );
  }

  const requestedRoot = normalize(inputWpRoot.trim());
  if (configuredWpRoot) {
    return assertWithinRoot(configuredWpRoot, requestedRoot, "wpRoot");
  }
  return requestedRoot;
}

export function wpRootLooksValid(wpRoot: string): boolean {
  const wpIncludesPath = path.join(wpRoot, "wp-includes");
  const wpConfigPath = path.join(wpRoot, "wp-config.php");
  const parentWpConfigPath = path.join(path.dirname(wpRoot), "wp-config.php");

  const hasWpIncludes = fs.existsSync(wpIncludesPath) && fs.statSync(wpIncludesPath).isDirectory();
  const hasWpConfig = fs.existsSync(wpConfigPath) || fs.existsSync(parentWpConfigPath);

  return hasWpIncludes || hasWpConfig;
}
