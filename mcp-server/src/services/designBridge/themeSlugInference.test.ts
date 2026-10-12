import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { AppError } from "../../errors";
import { jsonSchemaToZod } from "../../tools/jsonSchemaToZod";
import { publicToolDefinitionsByName } from "../../toolDefinitions";
import { buildComponentQuerySpec } from "./componentQueryBuilder";
import {
  discoverBlockSlugsFromIndex,
  mergeDiscoveredBlockSlugs
} from "./blockSlugDiscovery";
import { normalizeVisualIntent, resolveBridgeVisualIntent } from "./visualIntentSchema";
import {
  collectRequestCorpus,
  inferThemeSlugFromText
} from "./themeSlugInference";

test("inferThemeSlugFromText matches tht theme slug", () => {
  const match = inferThemeSlugFromText(
    "implement this card hero in our tht theme",
    ["tht", "twentytwentyfive", "twentytwentyfive-child"]
  );
  assert.ok(match);
  assert.equal(match?.slug, "tht");
  assert.equal(match?.confidence, "high");
});

test("collectRequestCorpus merges componentHint and visual intent", () => {
  const intent = normalizeVisualIntent({
    layout: { structure: "card hero", regions: [] },
    typography: [{ role: "heading", emphasis: "primary" }],
    colors: [{ role: "text", emphasis: "primary" }],
    spacing: { rhythm: "normal" },
    components: [{ label: "hero", kind: "hero" }]
  });
  const corpus = collectRequestCorpus(intent, "implement hero in tht theme");
  assert.match(corpus, /tht theme/iu);
  assert.match(corpus, /card hero/iu);
});

test("inferThemeSlugFromText returns null for ambiguous matches", () => {
  const match = inferThemeSlugFromText(
    "use theme",
    ["tht", "tht-child"]
  );
  assert.equal(match, null);
});

test("resolveBridgeVisualIntent rejects invalid figmaCapture with TOOL_INPUT_INVALID", () => {
  assert.throws(
    () => resolveBridgeVisualIntent({ figmaCapture: "not-an-object" }),
    (err: unknown) => err instanceof AppError && err.code === "TOOL_INPUT_INVALID"
  );
});

test("mergeDiscoveredBlockSlugs adds namespace block ids", () => {
  const merged = mergeDiscoveredBlockSlugs({
    name: "card hero",
    variantHints: [],
    typeHints: ["block", "pattern", "template", "content"],
    blockNames: [],
    classNames: [],
    componentLabels: [],
    snippet: "card hero"
  }, [{ slug: "tht/card-hero" }]);

  assert.ok(merged.blockNames.some((slug) => slug === "tht/card-hero"));
  assert.ok(merged.componentLabels.some((label) => label === "tht/card-hero"));
});

test("discoverBlockSlugsFromIndex finds block slug in sqlite index", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-bridge-index-"));
  const indexDir = path.join(tempDir, ".cursor-wp-index");
  fs.mkdirSync(indexDir, { recursive: true });
  const dbPath = path.join(indexDir, "index.sqlite");
  const db = new BetterSqlite3(dbPath);
  db.exec(`
    CREATE TABLE blocks (
      id TEXT PRIMARY KEY,
      name TEXT,
      sourceType TEXT,
      path TEXT,
      attrsJson TEXT,
      stylesJson TEXT,
      variationsJson TEXT
    );
    INSERT INTO blocks (id, name, sourceType, path, attrsJson, stylesJson, variationsJson)
    VALUES ('tht/card-hero', 'Card Hero', 'plugin', 'wp-content/plugins/tht/blocks/card-hero', '{}', '{}', '{}');
  `);
  db.close();

  try {
    const discovered = discoverBlockSlugsFromIndex(tempDir, "card hero layout");
    assert.ok(discovered.some((entry) => entry.slug === "tht/card-hero"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildComponentQuerySpec adds layout vocabulary block terms", () => {
  const intent = normalizeVisualIntent({
    layout: { structure: "two column card hero", regions: [] },
    typography: [{ role: "heading", emphasis: "primary" }],
    colors: [{ role: "text", emphasis: "primary" }],
    spacing: { rhythm: "normal" }
  });
  const spec = buildComponentQuerySpec(intent);
  assert.ok(spec.blockNames.includes("hero"));
  assert.ok(spec.blockNames.includes("card"));
});

test("bridge tool jsonSchemaToZod publishes visualIntent object shape", () => {
  const zod = jsonSchemaToZod(publicToolDefinitionsByName.bridge_design_to_implementation.inputSchema);
  assert.equal(zod.constructor.name, "ZodObject");
  const parsed = zod.safeParse({
    visualIntent: {
      layout: { structure: "hero", regions: [] },
      typography: [{ role: "heading" }],
      colors: [{ role: "text" }],
      spacing: { rhythm: "normal" }
    },
    componentHint: "implement hero in tht theme"
  });
  assert.equal(parsed.success, true);
});
