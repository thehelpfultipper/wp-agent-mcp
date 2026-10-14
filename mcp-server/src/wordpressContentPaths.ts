import fs from "node:fs";
import path from "node:path";
import { AppError } from "./errors";
import { runWpCli } from "./wpCli";

export type ContentPathResolution = "wp-cli" | "filesystem-fallback";

export type WordPressContentPaths = {
  resolution: ContentPathResolution;
  contentDir: string;
  themesDir: string;
  pluginsDir: string;
  muPluginsDir: string;
  contentRelativePrefix: string;
};

export type FilesystemRootsSummary = {
  resolution: ContentPathResolution;
  contentRelativePrefix: string;
  themesDir: string;
  pluginsDir: string;
  muPluginsDir: string;
  scanRootsExist: {
    themes: boolean;
    plugins: boolean;
    muPlugins: boolean;
  };
};

type WpCliContentPathsPayload = {
  contentDir?: string;
  pluginsDir?: string;
  themesDir?: string;
  muPluginsDir?: string;
};

const contentPathsCache = new Map<string, WordPressContentPaths>();

function normalizeWpRoot(wpRoot: string): string {
  return path.resolve(wpRoot.trim());
}

function toPosixRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

function dirExists(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function assertPathWithinRoot(root: string, target: string, label: string): string {
  const safeRoot = path.resolve(root);
  const safeTarget = path.resolve(target);
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

function buildContentPaths(
  wpRoot: string,
  resolution: ContentPathResolution,
  contentDir: string,
  themesDir: string,
  pluginsDir: string,
  muPluginsDir: string
): WordPressContentPaths {
  const safeContentDir = assertPathWithinRoot(wpRoot, contentDir, "contentDir");
  const safeThemesDir = assertPathWithinRoot(wpRoot, themesDir, "themesDir");
  const safePluginsDir = assertPathWithinRoot(wpRoot, pluginsDir, "pluginsDir");
  const safeMuPluginsDir = assertPathWithinRoot(wpRoot, muPluginsDir, "muPluginsDir");
  const contentRelativePrefix = toPosixRelative(path.resolve(wpRoot), safeContentDir);

  return {
    resolution,
    contentDir: safeContentDir,
    themesDir: safeThemesDir,
    pluginsDir: safePluginsDir,
    muPluginsDir: safeMuPluginsDir,
    contentRelativePrefix
  };
}

function resolveContentPathsFilesystemFallback(wpRoot: string): WordPressContentPaths {
  const normalizedRoot = normalizeWpRoot(wpRoot);

  const classicContentDir = path.join(normalizedRoot, "wp-content");
  const bedrockContentDir = path.join(normalizedRoot, "app");

  if (dirExists(path.join(classicContentDir, "themes"))) {
    return buildContentPaths(
      normalizedRoot,
      "filesystem-fallback",
      classicContentDir,
      path.join(classicContentDir, "themes"),
      path.join(classicContentDir, "plugins"),
      path.join(classicContentDir, "mu-plugins")
    );
  }

  if (dirExists(path.join(bedrockContentDir, "themes"))) {
    return buildContentPaths(
      normalizedRoot,
      "filesystem-fallback",
      bedrockContentDir,
      path.join(bedrockContentDir, "themes"),
      path.join(bedrockContentDir, "plugins"),
      path.join(bedrockContentDir, "mu-plugins")
    );
  }

  return buildContentPaths(
    normalizedRoot,
    "filesystem-fallback",
    classicContentDir,
    path.join(classicContentDir, "themes"),
    path.join(classicContentDir, "plugins"),
    path.join(classicContentDir, "mu-plugins")
  );
}

function resolveContentPathsViaWpCli(wpRoot: string, wpCli?: string): WordPressContentPaths {
  const normalizedRoot = normalizeWpRoot(wpRoot);
  const php = [
    "echo json_encode([",
    "  'contentDir' => WP_CONTENT_DIR,",
    "  'pluginsDir' => WP_PLUGIN_DIR,",
    "  'themesDir' => get_theme_root(),",
    "  'muPluginsDir' => defined('WPMU_PLUGIN_DIR') ? WPMU_PLUGIN_DIR : WP_CONTENT_DIR . '/mu-plugins',",
    "]);"
  ].join("\n");

  const raw = runWpCli(normalizedRoot, ["eval", php], wpCli);
  let parsed: WpCliContentPathsPayload;
  try {
    parsed = JSON.parse(raw) as WpCliContentPathsPayload;
  } catch {
    throw new AppError(
      "WPCLI_FAILED",
      "Unable to parse WordPress content paths from wp eval.",
      400,
      { stdout: raw }
    );
  }

  const contentDir = typeof parsed.contentDir === "string" ? parsed.contentDir.trim() : "";
  const pluginsDir = typeof parsed.pluginsDir === "string" ? parsed.pluginsDir.trim() : "";
  const themesDir = typeof parsed.themesDir === "string" ? parsed.themesDir.trim() : "";
  const muPluginsDir = typeof parsed.muPluginsDir === "string" ? parsed.muPluginsDir.trim() : "";

  if (!contentDir || !pluginsDir || !themesDir || !muPluginsDir) {
    throw new AppError(
      "WPCLI_FAILED",
      "WordPress content path resolution returned incomplete paths.",
      400,
      { parsed }
    );
  }

  return buildContentPaths(
    normalizedRoot,
    "wp-cli",
    contentDir,
    themesDir,
    pluginsDir,
    muPluginsDir
  );
}

export function resolveWordPressContentPaths(
  wpRoot: string,
  wpCli?: string,
  options: { allowFilesystemFallback?: boolean; preferFilesystemFallback?: boolean } = {}
): WordPressContentPaths {
  const normalizedRoot = normalizeWpRoot(wpRoot);
  const cached = contentPathsCache.get(normalizedRoot);
  if (cached) {
    return cached;
  }

  const allowFilesystemFallback = options.allowFilesystemFallback !== false;
  const preferFilesystemFallback = options.preferFilesystemFallback === true;

  if (!preferFilesystemFallback) {
    try {
      const resolved = resolveContentPathsViaWpCli(normalizedRoot, wpCli);
      contentPathsCache.set(normalizedRoot, resolved);
      return resolved;
    } catch (error) {
      if (!allowFilesystemFallback) {
        throw error;
      }
      if (
        error instanceof AppError
        && error.code !== "WPCLI_FAILED"
        && error.code !== "WP_ROOT_INVALID"
        && error.code !== "DB_UNREACHABLE"
      ) {
        throw error;
      }
    }
  }

  const resolved = resolveContentPathsFilesystemFallback(normalizedRoot);
  contentPathsCache.set(normalizedRoot, resolved);
  return resolved;
}

export function clearWordPressContentPathsCache(): void {
  contentPathsCache.clear();
}

export function clearWordPressContentPathsCacheForRoot(wpRoot: string): void {
  contentPathsCache.delete(normalizeWpRoot(wpRoot));
}

export function getFilesystemScanRoots(contentPaths: WordPressContentPaths): string[] {
  return [contentPaths.themesDir, contentPaths.pluginsDir, contentPaths.muPluginsDir];
}

export function getBlockAndPatternScanRoots(contentPaths: WordPressContentPaths): string[] {
  return getFilesystemScanRoots(contentPaths);
}

export function toFilesystemRootsSummary(
  wpRoot: string,
  contentPaths: WordPressContentPaths
): FilesystemRootsSummary {
  const normalizedRoot = normalizeWpRoot(wpRoot);
  return {
    resolution: contentPaths.resolution,
    contentRelativePrefix: contentPaths.contentRelativePrefix,
    themesDir: toPosixRelative(normalizedRoot, contentPaths.themesDir),
    pluginsDir: toPosixRelative(normalizedRoot, contentPaths.pluginsDir),
    muPluginsDir: toPosixRelative(normalizedRoot, contentPaths.muPluginsDir),
    scanRootsExist: {
      themes: dirExists(contentPaths.themesDir),
      plugins: dirExists(contentPaths.pluginsDir),
      muPlugins: dirExists(contentPaths.muPluginsDir)
    }
  };
}

export function isThemeRelativePath(relativePath: string): boolean {
  return relativePath.toLowerCase().includes("/themes/");
}

export function isPluginRelativePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return lower.includes("/plugins/") || lower.includes("/mu-plugins/");
}

export function deduceSourceType(relativePath: string): "theme" | "plugin" {
  return isThemeRelativePath(relativePath) ? "theme" : "plugin";
}

export function isClassicTemplateCandidate(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (!isThemeRelativePath(relativePath) || !lower.endsWith(".php")) {
    return false;
  }

  const fileName = path.basename(lower);
  if (fileName === "header.php" || fileName === "footer.php" || fileName === "single.php" || fileName === "page.php") {
    return true;
  }

  if (lower.includes("/template-parts/")) {
    return true;
  }

  return lower.includes("/templates/");
}

export function formatContentHint(contentPaths: WordPressContentPaths, subpath: string): string {
  const normalizedSubpath = subpath.replace(/^\/+/u, "");
  return `${contentPaths.contentRelativePrefix}/${normalizedSubpath}`;
}

export function parseStoredContentPaths(raw: string | null | undefined): WordPressContentPaths | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WordPressContentPaths>;
    if (
      typeof parsed.contentDir !== "string"
      || typeof parsed.themesDir !== "string"
      || typeof parsed.pluginsDir !== "string"
      || typeof parsed.muPluginsDir !== "string"
      || typeof parsed.contentRelativePrefix !== "string"
      || (parsed.resolution !== "wp-cli" && parsed.resolution !== "filesystem-fallback")
    ) {
      return null;
    }
    return parsed as WordPressContentPaths;
  } catch {
    return null;
  }
}
