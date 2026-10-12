import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearWordPressContentPathsCache,
  clearWordPressContentPathsCacheForRoot,
  deduceSourceType,
  formatContentHint,
  isClassicTemplateCandidate,
  resolveWordPressContentPaths,
  toFilesystemRootsSummary
} from "./wordpressContentPaths";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

test("filesystem fallback picks app/ layout for Bedrock fixture", () => {
  clearWordPressContentPathsCache();
  const wpRoot = createTempDir("wp-agent-bedrock-");
  mkdirp(path.join(wpRoot, "app", "themes", "my-theme"));
  mkdirp(path.join(wpRoot, "app", "plugins", "my-plugin"));

  const resolved = resolveWordPressContentPaths(wpRoot, undefined, {
    allowFilesystemFallback: true,
    preferFilesystemFallback: true
  });

  assert.equal(resolved.resolution, "filesystem-fallback");
  assert.equal(resolved.contentRelativePrefix, "app");
  assert.equal(path.basename(resolved.themesDir), "themes");
  assert.ok(resolved.themesDir.endsWith(`${path.sep}app${path.sep}themes`));
  assert.ok(resolved.pluginsDir.endsWith(`${path.sep}app${path.sep}plugins`));
  assert.ok(resolved.muPluginsDir.endsWith(`${path.sep}app${path.sep}mu-plugins`));
});

test("filesystem fallback picks wp-content/ layout for classic fixture", () => {
  clearWordPressContentPathsCache();
  const wpRoot = createTempDir("wp-agent-classic-");
  mkdirp(path.join(wpRoot, "wp-content", "themes", "my-theme"));
  mkdirp(path.join(wpRoot, "wp-content", "plugins", "my-plugin"));

  const resolved = resolveWordPressContentPaths(wpRoot, undefined, {
    allowFilesystemFallback: true,
    preferFilesystemFallback: true
  });

  assert.equal(resolved.resolution, "filesystem-fallback");
  assert.equal(resolved.contentRelativePrefix, "wp-content");
  assert.ok(resolved.themesDir.endsWith(`${path.sep}wp-content${path.sep}themes`));
});

test("deduceSourceType classifies theme and plugin paths", () => {
  assert.equal(deduceSourceType("app/themes/foo/block.json"), "theme");
  assert.equal(deduceSourceType("app/plugins/bar/block.json"), "plugin");
  assert.equal(deduceSourceType("app/mu-plugins/baz/block.json"), "plugin");
  assert.equal(deduceSourceType("wp-content/themes/foo/block.json"), "theme");
});

test("isClassicTemplateCandidate supports app/ and wp-content/ theme paths", () => {
  assert.equal(isClassicTemplateCandidate("app/themes/t/page.php"), true);
  assert.equal(isClassicTemplateCandidate("wp-content/themes/t/page.php"), true);
  assert.equal(isClassicTemplateCandidate("app/plugins/t/page.php"), false);
});

test("formatContentHint uses resolved content prefix", () => {
  clearWordPressContentPathsCache();
  const wpRoot = createTempDir("wp-agent-hint-");
  mkdirp(path.join(wpRoot, "app", "themes", "my-theme"));

  const resolved = resolveWordPressContentPaths(wpRoot, undefined, {
    allowFilesystemFallback: true,
    preferFilesystemFallback: true
  });
  assert.equal(
    formatContentHint(resolved, "themes/<active-theme>/patterns/*.php"),
    "app/themes/<active-theme>/patterns/*.php"
  );
});

test("toFilesystemRootsSummary reports scan root existence", () => {
  clearWordPressContentPathsCache();
  const wpRoot = createTempDir("wp-agent-summary-");
  mkdirp(path.join(wpRoot, "app", "themes", "my-theme"));
  mkdirp(path.join(wpRoot, "app", "plugins", "my-plugin"));

  const resolved = resolveWordPressContentPaths(wpRoot, undefined, {
    allowFilesystemFallback: true,
    preferFilesystemFallback: true
  });
  const summary = toFilesystemRootsSummary(wpRoot, resolved);

  assert.equal(summary.contentRelativePrefix, "app");
  assert.equal(summary.scanRootsExist.themes, true);
  assert.equal(summary.scanRootsExist.plugins, true);
  assert.equal(summary.scanRootsExist.muPlugins, false);
  assert.equal(summary.themesDir, "app/themes");
});

test("clearWordPressContentPathsCacheForRoot forces re-resolution", () => {
  clearWordPressContentPathsCache();
  const wpRoot = createTempDir("wp-agent-cache-");
  mkdirp(path.join(wpRoot, "app", "themes", "my-theme"));

  const first = resolveWordPressContentPaths(wpRoot, undefined, {
    allowFilesystemFallback: true,
    preferFilesystemFallback: true
  });
  clearWordPressContentPathsCacheForRoot(wpRoot);
  const second = resolveWordPressContentPaths(wpRoot, undefined, {
    allowFilesystemFallback: true,
    preferFilesystemFallback: true
  });

  assert.equal(first.contentRelativePrefix, "app");
  assert.equal(second.contentRelativePrefix, "app");
});
