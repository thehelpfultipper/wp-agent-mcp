import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import { AppError } from "./errors";
import { internalDefaults } from "./config/runtime";
import { isMissingMysqlClientMessage } from "./mysqlUnixSocket";
import { runWpCli } from "./wpCli";
import {
  deduceSourceType,
  isClassicTemplateCandidate,
  parseStoredContentPaths,
  resolveWordPressContentPaths,
  toFilesystemRootsSummary,
  clearWordPressContentPathsCacheForRoot,
  type FilesystemRootsSummary,
  type WordPressContentPaths
} from "./wordpressContentPaths";

export const INDEX_SCHEMA_VERSION = 3;
const INDEX_DIRNAME = internalDefaults.index.indexDirName;
const INDEX_DB_FILENAME = internalDefaults.index.indexDbFilename;

const REQUIRED_TABLES = [
  "blocks",
  "patterns",
  "templates",
  "content",
  "postmeta_index",
  "options_index",
  "menus_index"
] as const;
type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

type TableCounts = Record<(typeof REQUIRED_TABLES)[number], number>;

export type IndexStatus = {
  schemaVersion: number;
  lastBuildAt: string | null;
  counts: TableCounts;
  lastFilesystemRoots: FilesystemRootsSummary | null;
};

type BuildSummary = {
  discovered: {
    blocks: number;
    patterns: number;
    templates: number;
    content: number;
    postmeta: number;
    options: number;
    menus: number;
  };
  indexed: TableCounts;
  debugExports: {
    blocks: string;
    patterns: string;
    templates: string;
  };
  filesystemRoots: FilesystemRootsSummary;
  warnings: string[];
  rebuiltAt: string;
};

export type IndexBuildResult = {
  status: IndexStatus;
  summary: BuildSummary;
};

export type BuildIndexOptions = {
  contentLimit?: number;
  mode?: "full" | "filesystem-only" | "content-only";
  wpCli?: string;
};

export type IndexPaths = {
  indexDir: string;
  dbPath: string;
};

export function getIndexPaths(wpRoot: string): IndexPaths {
  const indexDir = path.join(wpRoot, INDEX_DIRNAME);
  return {
    indexDir,
    dbPath: path.join(indexDir, INDEX_DB_FILENAME)
  };
}

function openDatabase(dbPath: string): SqliteDatabase {
  return new BetterSqlite3(dbPath);
}

function migrateContentSearchTextColumn(db: SqliteDatabase): void {
  const exists = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'content' LIMIT 1")
    .get() as { ok?: number } | undefined;
  if (!exists?.ok) {
    return;
  }
  const columns = db.prepare("PRAGMA table_info(content)").all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === "contentSearchText")) {
    return;
  }
  db.exec("ALTER TABLE content ADD COLUMN contentSearchText TEXT NOT NULL DEFAULT ''");
}

function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      path TEXT NOT NULL,
      attrsJson TEXT,
      stylesJson TEXT,
      variationsJson TEXT
    );

    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      blockFingerprint TEXT,
      markerSignature TEXT
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      blockFingerprint TEXT,
      includesJson TEXT
    );

    CREATE TABLE IF NOT EXISTS content (
      postId INTEGER PRIMARY KEY,
      postType TEXT NOT NULL,
      title TEXT,
      blockFingerprint TEXT,
      markerSignature TEXT,
      contentSearchText TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS postmeta_index (
      id TEXT PRIMARY KEY,
      postId INTEGER NOT NULL,
      metaKey TEXT NOT NULL,
      content TEXT NOT NULL,
      markerSignature TEXT
    );

    CREATE TABLE IF NOT EXISTS options_index (
      id TEXT PRIMARY KEY,
      optionName TEXT NOT NULL,
      content TEXT NOT NULL,
      markerSignature TEXT
    );

    CREATE TABLE IF NOT EXISTS menus_index (
      id TEXT PRIMARY KEY,
      postId INTEGER NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      markerSignature TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_postmeta_index_postId ON postmeta_index(postId);
    CREATE INDEX IF NOT EXISTS idx_postmeta_index_metaKey ON postmeta_index(metaKey);
    CREATE INDEX IF NOT EXISTS idx_options_index_optionName ON options_index(optionName);
    CREATE INDEX IF NOT EXISTS idx_menus_index_postId ON menus_index(postId);
  `);

  migrateContentSearchTextColumn(db);

  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(INDEX_SCHEMA_VERSION));

  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('lastBuildAt', NULL) ON CONFLICT(key) DO NOTHING"
  ).run();
}

type BlockRow = {
  id: string;
  name: string;
  sourceType: "theme" | "plugin";
  path: string;
  attrsJson: string | null;
  stylesJson: string | null;
  variationsJson: string | null;
  markerSignature: string;
  blockFingerprint: string | null;
};

type PatternRow = {
  id: string;
  slug: string;
  title: string;
  path: string;
  markerSignature: string;
  blockFingerprint: string | null;
};

type TemplateRow = {
  id: string;
  type: string;
  path: string;
  includesJson: string;
  markerSignature: string;
  blockFingerprint: string | null;
};

type ContentRow = {
  postId: number;
  postType: string;
  title: string;
  blockFingerprint: string | null;
  markerSignature: string;
  contentSearchText: string;
};

type PostmetaIndexRow = {
  id: string;
  postId: number;
  metaKey: string;
  content: string;
  markerSignature: string | null;
};

type OptionIndexRow = {
  id: string;
  optionName: string;
  content: string;
  markerSignature: string | null;
};

type MenuIndexRow = {
  id: string;
  postId: number;
  title: string;
  content: string;
  markerSignature: string | null;
};

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function toPosixRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [];
  }

  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        found.push(fullPath);
      }
    }
  }

  return found;
}

function readTextIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function extractMarkers(content: string): {
  classes: string[];
  dataAttrs: string[];
  selectors: string[];
} {
  const classNames = new Set<string>();
  const dataAttrs = new Set<string>();
  const selectors = new Set<string>();

  const classRegex = /\bclass(?:Name)?\s*=\s*["']([^"']+)["']/g;
  for (const match of content.matchAll(classRegex)) {
    const raw = match[1] ?? "";
    for (const name of raw.split(/\s+/)) {
      const trimmed = name.trim();
      if (!trimmed) {
        continue;
      }
      classNames.add(trimmed);
      selectors.add(`.${trimmed}`);
    }
  }

  const dataRegex = /\b(data-[a-zA-Z0-9_-]+)\s*=/g;
  for (const match of content.matchAll(dataRegex)) {
    const attrName = (match[1] ?? "").trim();
    if (!attrName) {
      continue;
    }
    dataAttrs.add(attrName);
    selectors.add(`[${attrName}]`);
  }

  const idRegex = /\bid\s*=\s*["']([^"']+)["']/g;
  for (const match of content.matchAll(idRegex)) {
    const raw = match[1] ?? "";
    for (const idValue of raw.split(/\s+/)) {
      const trimmed = idValue.trim();
      if (!trimmed) {
        continue;
      }
      selectors.add(`#${trimmed}`);
    }
  }

  return {
    classes: [...classNames].sort(),
    dataAttrs: [...dataAttrs].sort(),
    selectors: [...selectors].sort()
  };
}

function computeMarkerSignature(content: string): string {
  const markers = extractMarkers(content);
  return sha256(JSON.stringify(markers));
}

function extractBlockSequence(content: string): string[] {
  const sequence: string[] = [];
  const blockRegex = /<!--\s*wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)\b/gi;
  for (const match of content.matchAll(blockRegex)) {
    const blockName = (match[1] ?? "").trim().toLowerCase();
    if (blockName) {
      sequence.push(blockName);
    }
  }
  return sequence;
}

function computeBlockFingerprint(content: string): string | null {
  const sequence = extractBlockSequence(content);
  if (sequence.length === 0) {
    return null;
  }
  return sha256(JSON.stringify(sequence));
}

function stripHtml(content: string): string {
  return content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ");
}

function flattenToString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => flattenToString(item)).filter((item) => item.length > 0).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value)
      .map((item) => flattenToString(item))
      .filter((item) => item.length > 0)
      .join(" ");
  }
  return "";
}

function extractSerializedStrings(raw: string): string[] {
  if (!raw || !/[aObisCdN]:\d+/u.test(raw)) {
    return [];
  }
  const extracted: string[] = [];
  const stringTokenRegex = /s:\d+:"((?:\\.|[^"\\])*)";/gu;
  for (const match of raw.matchAll(stringTokenRegex)) {
    const value = (match[1] ?? "")
      .replace(/\\"/gu, "\"")
      .replace(/\\n/gu, " ")
      .replace(/\\r/gu, " ")
      .replace(/\\t/gu, " ");
    if (value.trim().length > 0) {
      extracted.push(value);
    }
  }
  return extracted;
}

function normalizeContentText(raw: string): string {
  if (!raw) {
    return "";
  }

  const parts = new Set<string>();
  const direct = stripHtml(raw);
  if (direct.trim().length > 0) {
    parts.add(direct);
  }

  try {
    const parsedJson = JSON.parse(raw) as unknown;
    const flattened = flattenToString(parsedJson);
    if (flattened.trim().length > 0) {
      parts.add(flattened);
    }
  } catch {
    // Not JSON; continue.
  }

  for (const serializedChunk of extractSerializedStrings(raw)) {
    const cleaned = stripHtml(serializedChunk);
    if (cleaned.trim().length > 0) {
      parts.add(cleaned);
    }
  }

  const joined = [...parts].join(" ");
  return joined
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function computeMarkerSignatureIfAny(content: string): string | null {
  const markers = extractMarkers(content);
  if (markers.classes.length === 0 && markers.dataAttrs.length === 0 && markers.selectors.length === 0) {
    return null;
  }
  return sha256(JSON.stringify(markers));
}

function discoverBlockRows(wpRoot: string, contentPaths: WordPressContentPaths): BlockRow[] {
  const scanRoots = [contentPaths.themesDir, contentPaths.pluginsDir, contentPaths.muPluginsDir];
  const files = scanRoots.flatMap((root) => walkFiles(root));

  const rows: BlockRow[] = [];
  for (const filePath of files) {
    if (path.basename(filePath) !== "block.json") {
      continue;
    }

    const relativePath = toPosixRelative(wpRoot, filePath);
    const raw = readTextIfExists(filePath);
    const markerSignature = computeMarkerSignature(raw);
    const blockFingerprint = computeBlockFingerprint(raw);

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    const fallbackName = relativePath;
    const name =
      typeof parsed?.name === "string" && parsed.name.trim().length > 0
        ? parsed.name.trim()
        : fallbackName;

    const attrs = parsed && typeof parsed.attributes === "object" ? parsed.attributes : null;
    const styles = parsed && Array.isArray(parsed.styles) ? parsed.styles : null;
    const variations = parsed && Array.isArray(parsed.variations) ? parsed.variations : null;

    rows.push({
      id: sha256(`block:${relativePath}`),
      name,
      sourceType: deduceSourceType(relativePath),
      path: relativePath,
      attrsJson: attrs ? JSON.stringify(attrs) : null,
      stylesJson: styles ? JSON.stringify(styles) : null,
      variationsJson: variations ? JSON.stringify(variations) : null,
      markerSignature,
      blockFingerprint
    });
  }

  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function discoverPatternRows(wpRoot: string, contentPaths: WordPressContentPaths): PatternRow[] {
  const scanRoots = [contentPaths.themesDir, contentPaths.pluginsDir, contentPaths.muPluginsDir];
  const files = scanRoots.flatMap((root) => walkFiles(root));

  const rows: PatternRow[] = [];
  for (const filePath of files) {
    const relativePath = toPosixRelative(wpRoot, filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (!(extension === ".php" || extension === ".html")) {
      continue;
    }

    const parts = relativePath.split("/");
    const patternsIndex = parts.indexOf("patterns");
    if (patternsIndex === -1) {
      continue;
    }

    const content = readTextIfExists(filePath);
    const baseName = path.basename(filePath, extension);
    rows.push({
      id: sha256(`pattern:${relativePath}`),
      slug: baseName,
      title: baseName.replace(/[-_]/g, " "),
      path: relativePath,
      markerSignature: computeMarkerSignature(content),
      blockFingerprint: computeBlockFingerprint(content)
    });
  }

  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function detectTemplateType(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".html") && lower.includes("/parts/")) {
    return "template_part";
  }
  if (lower.endsWith(".html") && lower.includes("/templates/")) {
    return "template";
  }
  if (lower.includes("/template-parts/")) {
    return "classic_template_part";
  }
  return "classic_template";
}

function extractTemplateIncludes(content: string): string[] {
  const includes = new Set<string>();
  const htmlPartRegex = /<!--\s*wp:template-part\s+\{"slug":"([^"]+)"/g;
  for (const match of content.matchAll(htmlPartRegex)) {
    const slug = (match[1] ?? "").trim();
    if (slug) {
      includes.add(`template-part:${slug}`);
    }
  }

  const phpPartRegex = /get_template_part\s*\(\s*["']([^"']+)["']/g;
  for (const match of content.matchAll(phpPartRegex)) {
    const ref = (match[1] ?? "").trim();
    if (ref) {
      includes.add(`php-part:${ref}`);
    }
  }

  return [...includes].sort();
}

function discoverTemplateRows(wpRoot: string, contentPaths: WordPressContentPaths): TemplateRow[] {
  const files = walkFiles(contentPaths.themesDir);

  const rows: TemplateRow[] = [];
  for (const filePath of files) {
    const relativePath = toPosixRelative(wpRoot, filePath);
    const lower = relativePath.toLowerCase();
    const extension = path.extname(lower);
    const isBlockThemeTemplate = extension === ".html" && (lower.includes("/templates/") || lower.includes("/parts/"));
    const isClassicTemplate = isClassicTemplateCandidate(relativePath);

    if (!isBlockThemeTemplate && !isClassicTemplate) {
      continue;
    }

    const content = readTextIfExists(filePath);
    const markerSignature = computeMarkerSignature(content);
    const includes = extractTemplateIncludes(content);

    rows.push({
      id: sha256(`template:${relativePath}`),
      type: detectTemplateType(relativePath),
      path: relativePath,
      blockFingerprint: computeBlockFingerprint(content),
      markerSignature,
      includesJson: JSON.stringify({
        includes,
        markerSignature
      })
    });
  }

  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function decodeBase64(value: string): string {
  if (!value) {
    return "";
  }
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function resolvePostsTableName(wpRoot: string): string {
  const postsTable = runWpCli(wpRoot, [
    "eval",
    "global $wpdb; echo $wpdb->posts;"
  ]).trim();
  if (!postsTable || !/^[a-zA-Z0-9_]+$/.test(postsTable)) {
    throw new Error("Unable to resolve a safe posts table name from WordPress.");
  }
  return postsTable;
}

function parseContentRowsFromTabSeparated(output: string): ContentRow[] {
  const rows: ContentRow[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const columns = trimmed.split("\t");
    if (columns.length < 4) {
      continue;
    }

    const postId = Number.parseInt(columns[0] ?? "", 10);
    if (!Number.isFinite(postId)) {
      continue;
    }

    const postType = decodeBase64(columns[1] ?? "");
    const title = decodeBase64(columns[2] ?? "");
    const postContent = decodeBase64(columns[3] ?? "");

    rows.push({
      postId,
      postType,
      title,
      blockFingerprint: computeBlockFingerprint(postContent),
      markerSignature: computeMarkerSignature(postContent),
      contentSearchText: normalizeContentText(postContent)
    });
  }
  return rows;
}

function parsePostmetaRowsFromTabSeparated(
  output: string,
  options: { includesMetaId?: boolean } = {}
): Array<{ metaId?: number; postId: number; metaKey: string; metaValue: string }> {
  const rows: Array<{ metaId?: number; postId: number; metaKey: string; metaValue: string }> = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const columns = trimmed.split("\t");
    const includesMetaId = options.includesMetaId === true;
    if (includesMetaId && columns.length < 4) {
      continue;
    }
    if (!includesMetaId && columns.length < 3) {
      continue;
    }
    const postIdColumn = includesMetaId ? 1 : 0;
    const metaKeyColumn = includesMetaId ? 2 : 1;
    const metaValueColumn = includesMetaId ? 3 : 2;
    const metaId = includesMetaId ? Number.parseInt(columns[0] ?? "", 10) : undefined;
    const postId = Number.parseInt(columns[postIdColumn] ?? "", 10);
    if (!Number.isInteger(postId) || postId <= 0) {
      continue;
    }
    if (includesMetaId && (!Number.isInteger(metaId) || (metaId ?? 0) <= 0)) {
      continue;
    }
    rows.push({
      metaId,
      postId,
      metaKey: decodeBase64(columns[metaKeyColumn] ?? ""),
      metaValue: decodeBase64(columns[metaValueColumn] ?? "")
    });
  }
  return rows;
}

function parseOptionsRowsFromTabSeparated(output: string): Array<{ optionName: string; optionValue: string }> {
  const rows: Array<{ optionName: string; optionValue: string }> = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const columns = trimmed.split("\t");
    if (columns.length < 2) {
      continue;
    }
    rows.push({
      optionName: decodeBase64(columns[0] ?? ""),
      optionValue: decodeBase64(columns[1] ?? "")
    });
  }
  return rows;
}

function parseMenuRowsFromTabSeparated(output: string): Array<{ postId: number; title: string; content: string }> {
  const rows: Array<{ postId: number; title: string; content: string }> = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const columns = trimmed.split("\t");
    if (columns.length < 3) {
      continue;
    }
    const postId = Number.parseInt(columns[0] ?? "", 10);
    if (!Number.isInteger(postId) || postId <= 0) {
      continue;
    }
    rows.push({
      postId,
      title: decodeBase64(columns[1] ?? ""),
      content: decodeBase64(columns[2] ?? "")
    });
  }
  return rows;
}

function resolvePostmetaTableName(wpRoot: string): string {
  const postmetaTable = runWpCli(wpRoot, [
    "eval",
    "global $wpdb; echo $wpdb->postmeta;"
  ]).trim();
  if (!postmetaTable || !/^[a-zA-Z0-9_]+$/.test(postmetaTable)) {
    throw new Error("Unable to resolve a safe postmeta table name from WordPress.");
  }
  return postmetaTable;
}

function resolveOptionsTableName(wpRoot: string): string {
  const optionsTable = runWpCli(wpRoot, [
    "eval",
    "global $wpdb; echo $wpdb->options;"
  ]).trim();
  if (!optionsTable || !/^[a-zA-Z0-9_]+$/.test(optionsTable)) {
    throw new Error("Unable to resolve a safe options table name from WordPress.");
  }
  return optionsTable;
}

const SKIPPED_POSTMETA_PREFIXES = [
  "_edit_",
  "_wp_old_",
  "_wp_trash_",
  "_wp_desired_post_slug",
  "_pingme",
  "_encloseme"
];

const SKIPPED_POSTMETA_EXACT = new Set([
  "_edit_lock",
  "_edit_last",
  "_wp_page_template",
  "_thumbnail_id",
  "_menu_item_menu_item_parent"
]);

function shouldSkipPostmetaKey(metaKey: string): boolean {
  if (!metaKey) {
    return true;
  }
  const normalized = metaKey.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (SKIPPED_POSTMETA_EXACT.has(normalized)) {
    return true;
  }
  return SKIPPED_POSTMETA_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function discoverPostmetaRows(wpRoot: string, contentLimit: number): PostmetaIndexRow[] {
  const postmetaTable = resolvePostmetaTableName(wpRoot);
  const sql = [
    "SELECT",
    "  meta_id,",
    "  post_id,",
    "  TO_BASE64(COALESCE(meta_key, '')) AS meta_key_b64,",
    "  TO_BASE64(COALESCE(meta_value, '')) AS meta_value_b64",
    `FROM \`${postmetaTable}\``,
    "ORDER BY meta_id DESC",
    `LIMIT ${contentLimit};`
  ].join("\n");

  const output = runWpCli(wpRoot, ["db", "query", sql, "--skip-column-names"]);
  const rawRows = parsePostmetaRowsFromTabSeparated(output, { includesMetaId: true });
  const rows: PostmetaIndexRow[] = [];
  for (const rawRow of rawRows) {
    if (shouldSkipPostmetaKey(rawRow.metaKey)) {
      continue;
    }
    const normalizedContent = normalizeContentText(rawRow.metaValue);
    if (normalizedContent.length < 3) {
      continue;
    }
    rows.push({
      id: sha256(`postmeta:${rawRow.metaId ?? `${rawRow.postId}:${rawRow.metaKey}`}`),
      postId: rawRow.postId,
      metaKey: rawRow.metaKey,
      content: normalizedContent,
      markerSignature: computeMarkerSignatureIfAny(rawRow.metaValue)
    });
  }
  return rows;
}

function discoverOptionRows(wpRoot: string, contentLimit: number): OptionIndexRow[] {
  const optionsTable = resolveOptionsTableName(wpRoot);
  const sql = [
    "SELECT",
    "  TO_BASE64(option_name) AS option_name_b64,",
    "  TO_BASE64(COALESCE(option_value, '')) AS option_value_b64",
    `FROM \`${optionsTable}\``,
    "WHERE option_name LIKE 'theme_mods_%'",
    "   OR option_name LIKE 'widget_%'",
    "   OR CHAR_LENGTH(COALESCE(option_value, '')) >= 512",
    "ORDER BY option_name ASC",
    `LIMIT ${contentLimit};`
  ].join("\n");

  const output = runWpCli(wpRoot, ["db", "query", sql, "--skip-column-names"]);
  const rawRows = parseOptionsRowsFromTabSeparated(output);
  const rows: OptionIndexRow[] = [];
  for (const rawRow of rawRows) {
    const normalizedContent = normalizeContentText(rawRow.optionValue);
    if (normalizedContent.length < 20) {
      continue;
    }
    rows.push({
      id: sha256(`option:${rawRow.optionName}`),
      optionName: rawRow.optionName,
      content: normalizedContent,
      markerSignature: computeMarkerSignatureIfAny(rawRow.optionValue)
    });
  }
  return rows;
}

function discoverMenuRows(wpRoot: string, contentLimit: number): MenuIndexRow[] {
  const postsTable = resolvePostsTableName(wpRoot);
  const postmetaTable = resolvePostmetaTableName(wpRoot);
  const menuSql = [
    "SELECT",
    "  ID,",
    "  TO_BASE64(COALESCE(post_title, '')) AS post_title_b64,",
    "  TO_BASE64(COALESCE(post_content, '')) AS post_content_b64",
    `FROM \`${postsTable}\``,
    "WHERE post_type = 'nav_menu_item'",
    "ORDER BY ID ASC",
    `LIMIT ${contentLimit};`
  ].join("\n");
  const output = runWpCli(wpRoot, ["db", "query", menuSql, "--skip-column-names"]);
  const menuRows = parseMenuRowsFromTabSeparated(output);
  if (menuRows.length === 0) {
    return [];
  }

  const menuPostIds = menuRows.map((row) => row.postId);
  const menuMetaSql = [
    "SELECT",
    "  post_id,",
    "  TO_BASE64(COALESCE(meta_key, '')) AS meta_key_b64,",
    "  TO_BASE64(COALESCE(meta_value, '')) AS meta_value_b64",
    `FROM \`${postmetaTable}\``,
    `WHERE post_id IN (${menuPostIds.join(",")})`,
    "  AND meta_key IN ('_menu_item_url', '_menu_item_title', '_menu_item_type', '_menu_item_object')"
  ].join("\n");
  const menuMetaOutput = runWpCli(wpRoot, ["db", "query", menuMetaSql, "--skip-column-names"]);
  const menuMetaRows = parsePostmetaRowsFromTabSeparated(menuMetaOutput);
  const menuMetaByPostId = new Map<number, string[]>();
  for (const row of menuMetaRows) {
    const normalized = normalizeContentText(row.metaValue);
    if (normalized.length === 0) {
      continue;
    }
    const existing = menuMetaByPostId.get(row.postId) ?? [];
    existing.push(normalized);
    menuMetaByPostId.set(row.postId, existing);
  }

  return menuRows
    .map((row) => {
      const normalizedTitle = normalizeContentText(row.title);
      const normalizedContent = normalizeContentText(row.content);
      const metaContent = (menuMetaByPostId.get(row.postId) ?? []).join(" ");
      const combined = [normalizedTitle, normalizedContent, metaContent]
        .filter((part) => part.length > 0)
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      if (!combined) {
        return null;
      }
      return {
        id: sha256(`menu:${row.postId}`),
        postId: row.postId,
        title: normalizedTitle,
        content: combined,
        markerSignature: computeMarkerSignatureIfAny(`${row.title}\n${row.content}`)
      };
    })
    .filter((row): row is MenuIndexRow => row !== null);
}

function isMissingMysqlClientForWpDbQuery(err: unknown): boolean {
  if (!(err instanceof AppError) || err.code !== "WPCLI_FAILED") {
    return false;
  }
  const details = err.details as { stderr?: unknown } | undefined;
  const stderr = typeof details?.stderr === "string" ? details.stderr : "";
  return isMissingMysqlClientMessage(stderr);
}

function buildContentIndexSql(postsTable: string, contentLimit: number): string {
  return [
    "SELECT",
    "  ID,",
    "  TO_BASE64(post_type) AS post_type_b64,",
    "  TO_BASE64(COALESCE(post_title, '')) AS post_title_b64,",
    "  TO_BASE64(COALESCE(post_content, '')) AS post_content_b64",
    `FROM \`${postsTable}\``,
    "WHERE post_status IN ('publish', 'draft')",
    "ORDER BY ID ASC",
    `LIMIT ${contentLimit};`
  ].join("\n");
}

function queryContentRowsWithWpEval(
  wpRoot: string,
  postsTable: string,
  contentLimit: number
): ContentRow[] {
  const php = [
    "global $wpdb;",
    `$table = '${postsTable}';`,
    `$limit = ${contentLimit};`,
    "$sql = \"SELECT ID, post_type, post_title, post_content FROM `{$table}` WHERE post_status IN ('publish', 'draft') ORDER BY ID ASC LIMIT {$limit}\";",
    "$rows = $wpdb->get_results($sql, ARRAY_A);",
    "if (!is_array($rows)) {",
    "  $rows = [];",
    "}",
    "foreach ($rows as $row) {",
    "  $id = isset($row['ID']) ? (string) $row['ID'] : '';",
    "  $postType = isset($row['post_type']) ? base64_encode((string) $row['post_type']) : '';",
    "  $postTitle = isset($row['post_title']) ? base64_encode((string) $row['post_title']) : '';",
    "  $postContent = isset($row['post_content']) ? base64_encode((string) $row['post_content']) : '';",
    "  echo $id . \"\\t\" . $postType . \"\\t\" . $postTitle . \"\\t\" . $postContent . PHP_EOL;",
    "}"
  ].join(" ");

  const output = runWpCli(wpRoot, ["eval", php]);
  return parseContentRowsFromTabSeparated(output);
}

function discoverContentRows(wpRoot: string, contentLimit: number): ContentRow[] {
  const postsTable = resolvePostsTableName(wpRoot);
  const sql = buildContentIndexSql(postsTable, contentLimit);

  try {
    const output = runWpCli(wpRoot, ["db", "query", sql, "--skip-column-names"]);
    return parseContentRowsFromTabSeparated(output);
  } catch (err) {
    if (!isMissingMysqlClientForWpDbQuery(err)) {
      throw err;
    }
    return queryContentRowsWithWpEval(wpRoot, postsTable, contentLimit);
  }
}

function writeDebugExport(indexDir: string, fileName: string, data: unknown): string {
  const outputPath = path.join(indexDir, fileName);
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
  return outputPath;
}

function wipeSelectedIndexTables(
  db: SqliteDatabase,
  options: {
    includeFilesystem: boolean;
    includeContent: boolean;
  }
): void {
  if (options.includeFilesystem) {
    db.exec(`
      DELETE FROM blocks;
      DELETE FROM patterns;
      DELETE FROM templates;
    `);
  }

  if (options.includeContent) {
    db.exec(`
      DELETE FROM content;
      DELETE FROM postmeta_index;
      DELETE FROM options_index;
      DELETE FROM menus_index;
    `);
  }
}

function insertRows(
  db: SqliteDatabase,
  blocks: BlockRow[],
  patterns: PatternRow[],
  templates: TemplateRow[],
  contentRows: ContentRow[],
  postmetaRows: PostmetaIndexRow[],
  optionRows: OptionIndexRow[],
  menuRows: MenuIndexRow[]
): void {
  const insertBlock = db.prepare(
    "INSERT INTO blocks (id, name, sourceType, path, attrsJson, stylesJson, variationsJson) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const block of blocks) {
    insertBlock.run(
      block.id,
      block.name,
      block.sourceType,
      block.path,
      block.attrsJson,
      block.stylesJson,
      block.variationsJson
    );
  }

  const insertPattern = db.prepare(
    "INSERT INTO patterns (id, slug, title, path, blockFingerprint, markerSignature) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const pattern of patterns) {
    insertPattern.run(
      pattern.id,
      pattern.slug,
      pattern.title,
      pattern.path,
      pattern.blockFingerprint,
      pattern.markerSignature
    );
  }

  const insertTemplate = db.prepare(
    "INSERT INTO templates (id, type, path, blockFingerprint, includesJson) VALUES (?, ?, ?, ?, ?)"
  );
  for (const template of templates) {
    insertTemplate.run(
      template.id,
      template.type,
      template.path,
      template.blockFingerprint,
      template.includesJson
    );
  }

  const insertContent = db.prepare(
    "INSERT INTO content (postId, postType, title, blockFingerprint, markerSignature, contentSearchText) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const contentRow of contentRows) {
    insertContent.run(
      contentRow.postId,
      contentRow.postType,
      contentRow.title,
      contentRow.blockFingerprint,
      contentRow.markerSignature,
      contentRow.contentSearchText
    );
  }

  const insertPostmeta = db.prepare(
    "INSERT INTO postmeta_index (id, postId, metaKey, content, markerSignature) VALUES (?, ?, ?, ?, ?)"
  );
  for (const postmetaRow of postmetaRows) {
    insertPostmeta.run(
      postmetaRow.id,
      postmetaRow.postId,
      postmetaRow.metaKey,
      postmetaRow.content,
      postmetaRow.markerSignature
    );
  }

  const insertOptions = db.prepare(
    "INSERT INTO options_index (id, optionName, content, markerSignature) VALUES (?, ?, ?, ?)"
  );
  for (const optionRow of optionRows) {
    insertOptions.run(
      optionRow.id,
      optionRow.optionName,
      optionRow.content,
      optionRow.markerSignature
    );
  }

  const insertMenus = db.prepare(
    "INSERT INTO menus_index (id, postId, title, content, markerSignature) VALUES (?, ?, ?, ?, ?)"
  );
  for (const menuRow of menuRows) {
    insertMenus.run(
      menuRow.id,
      menuRow.postId,
      menuRow.title,
      menuRow.content,
      menuRow.markerSignature
    );
  }
}

function readStatus(db: SqliteDatabase, wpRoot: string): IndexStatus {
  const schemaVersionRow = db
    .prepare("SELECT value FROM meta WHERE key = 'schemaVersion'")
    .get() as { value?: string } | undefined;
  const lastBuildAtRow = db
    .prepare("SELECT value FROM meta WHERE key = 'lastBuildAt'")
    .get() as { value?: string | null } | undefined;
  const contentPathsRow = db
    .prepare("SELECT value FROM meta WHERE key = 'contentPathsJson'")
    .get() as { value?: string | null } | undefined;

  const counts = REQUIRED_TABLES.reduce((acc, table) => {
    const result = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    acc[table] = result.count;
    return acc;
  }, {} as TableCounts);

  const storedContentPaths = parseStoredContentPaths(contentPathsRow?.value ?? null);
  const lastFilesystemRoots = storedContentPaths
    ? toFilesystemRootsSummary(wpRoot, storedContentPaths)
    : null;

  return {
    schemaVersion: Number.parseInt(schemaVersionRow?.value ?? String(INDEX_SCHEMA_VERSION), 10),
    lastBuildAt: lastBuildAtRow?.value ?? null,
    counts,
    lastFilesystemRoots
  };
}

export function initializeIndexAndGetStatus(wpRoot: string): IndexStatus {
  const paths = getIndexPaths(wpRoot);
  fs.mkdirSync(paths.indexDir, { recursive: true });

  const db = openDatabase(paths.dbPath);
  try {
    initializeSchema(db);
    return readStatus(db, wpRoot);
  } finally {
    db.close();
  }
}

export function buildIndexFromFilesystem(
  wpRoot: string,
  options: BuildIndexOptions = {}
): IndexBuildResult {
  clearWordPressContentPathsCacheForRoot(wpRoot);
  const paths = getIndexPaths(wpRoot);
  fs.mkdirSync(paths.indexDir, { recursive: true });

  const DEFAULT_CONTENT_LIMIT = internalDefaults.index.defaultContentLimit;
  const MAX_CONTENT_LIMIT = internalDefaults.index.maxContentLimit;
  const rawLimit = options.contentLimit ?? DEFAULT_CONTENT_LIMIT;
  const contentLimit = Math.max(1, Math.min(MAX_CONTENT_LIMIT, Math.floor(rawLimit)));
  const mode = options.mode ?? "full";
  const includeFilesystem = mode === "full" || mode === "filesystem-only";
  const includeContent = mode === "full" || mode === "content-only";
  const wpCli = options.wpCli;

  function runBuildStep<T>(step: string, callback: () => T): T {
    try {
      return callback();
    } catch (err) {
      if (err instanceof AppError && err.code === "WPCLI_FAILED") {
        const details = (err.details ?? {}) as Record<string, unknown>;
        const subcommand = typeof details.subcommand === "string"
          ? details.subcommand
          : typeof details.command === "string"
            ? details.command
            : "unknown wp-cli command";
        throw new AppError(
          "WPCLI_FAILED",
          `build_wp_index failed during "${step}" (${subcommand}).`,
          err.status,
          {
            step,
            ...details
          }
        );
      }
      throw err;
    }
  }

  const contentPaths = includeFilesystem
    ? runBuildStep("resolve content paths", () => resolveWordPressContentPaths(wpRoot, wpCli))
    : null;
  const filesystemRoots = contentPaths
    ? toFilesystemRootsSummary(wpRoot, contentPaths)
    : null;

  const blocks = includeFilesystem && contentPaths
    ? runBuildStep("discover blocks", () => discoverBlockRows(wpRoot, contentPaths))
    : [];
  const patterns = includeFilesystem && contentPaths
    ? runBuildStep("discover patterns", () => discoverPatternRows(wpRoot, contentPaths))
    : [];
  const templates = includeFilesystem && contentPaths
    ? runBuildStep("discover templates", () => discoverTemplateRows(wpRoot, contentPaths))
    : [];
  const contentRows = includeContent
    ? runBuildStep("discover content rows", () => discoverContentRows(wpRoot, contentLimit))
    : [];
  const postmetaRows = includeContent
    ? runBuildStep("discover postmeta rows", () => discoverPostmetaRows(wpRoot, contentLimit))
    : [];
  const optionRows = includeContent
    ? runBuildStep("discover option rows", () => discoverOptionRows(wpRoot, contentLimit))
    : [];
  const menuRows = includeContent
    ? runBuildStep("discover menu rows", () => discoverMenuRows(wpRoot, contentLimit))
    : [];
  const rebuiltAt = new Date().toISOString();

  const db = openDatabase(paths.dbPath);
  try {
    initializeSchema(db);
    db.exec("BEGIN");
    try {
      wipeSelectedIndexTables(db, {
        includeFilesystem,
        includeContent
      });
      insertRows(db, blocks, patterns, templates, contentRows, postmetaRows, optionRows, menuRows);
      db.prepare(
        "INSERT INTO meta (key, value) VALUES ('lastBuildAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(rebuiltAt);
      if (contentPaths) {
        db.prepare(
          "INSERT INTO meta (key, value) VALUES ('contentPathsJson', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(JSON.stringify(contentPaths));
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    const blockExportPath = writeDebugExport(
      paths.indexDir,
      internalDefaults.index.debugExportFiles.blocks,
      blocks
    );
    const patternExportPath = writeDebugExport(
      paths.indexDir,
      internalDefaults.index.debugExportFiles.patterns,
      patterns
    );
    const templateExportPath = writeDebugExport(
      paths.indexDir,
      internalDefaults.index.debugExportFiles.templates,
      templates
    );
    const status = readStatus(db, wpRoot);

    const resolvedFilesystemRoots = filesystemRoots
      ?? status.lastFilesystemRoots
      ?? toFilesystemRootsSummary(
        wpRoot,
        resolveWordPressContentPaths(wpRoot, wpCli, { allowFilesystemFallback: true })
      );

    const warnings: string[] = [];
    if (
      includeFilesystem
      && resolvedFilesystemRoots.scanRootsExist.themes
      && blocks.length === 0
    ) {
      warnings.push(
        "Themes directory exists but no block.json files were discovered. Confirm blocks are registered under the active theme or plugins."
      );
    }

    return {
      status,
      summary: {
        discovered: {
          blocks: blocks.length,
          patterns: patterns.length,
          templates: templates.length,
          content: contentRows.length,
          postmeta: postmetaRows.length,
          options: optionRows.length,
          menus: menuRows.length
        },
        indexed: status.counts,
        debugExports: {
          blocks: blockExportPath,
          patterns: patternExportPath,
          templates: templateExportPath
        },
        filesystemRoots: resolvedFilesystemRoots,
        warnings,
        rebuiltAt
      }
    };
  } finally {
    db.close();
  }
}

export function getSchemaTables(wpRoot: string): string[] {
  const paths = getIndexPaths(wpRoot);
  const db = openDatabase(paths.dbPath);
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}
