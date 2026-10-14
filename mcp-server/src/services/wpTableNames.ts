/**
 * Maps logical WordPress table names onto the live `$wpdb` names.
 * Core tables are rewritten from their conventional `wp_*` identifiers.
 * Any other table is addressed with the `{prefix}` token.
 */

export const WP_TABLE_PREFIX_TOKEN = "{prefix}";
export const WP_AGENT_TABLES_MARKER = "WP_AGENT_TABLES:";

/** Blog-scoped `$wpdb` tables. Multisite uses `$wpdb->prefix`. */
export const WP_BLOG_TABLES = [
  "posts",
  "comments",
  "links",
  "options",
  "postmeta",
  "terms",
  "term_taxonomy",
  "term_relationships",
  "termmeta",
  "commentmeta"
] as const;

/** Network-scoped `$wpdb` tables. Multisite uses `$wpdb->base_prefix`. */
export const WP_GLOBAL_TABLES = [
  "users",
  "usermeta",
  "blogs",
  "blogmeta",
  "signups",
  "site",
  "sitemeta",
  "sitecategories",
  "registration_log",
  "blog_versions"
] as const;

export const WP_CORE_TABLES = [...WP_BLOG_TABLES, ...WP_GLOBAL_TABLES];

const CORE_TABLE_PATTERN = new RegExp(
  `\\bwp_(${[...WP_CORE_TABLES].sort((left, right) => right.length - left.length).join("|")})\\b`,
  "giu"
);

const PREFIX_TOKEN_PATTERN = /[A-Za-z0-9_]*\{prefix\}[A-Za-z0-9_]*/gu;

export type WpTableContext = {
  tablePrefix: string;
  basePrefix: string;
  tables: Record<string, string>;
};

export function isPlausibleTablePrefix(value: string): boolean {
  return value.length <= 64 && /^[A-Za-z0-9_]*$/u.test(value);
}

/** Non-empty prefix from a bare `wp eval` or `wp config get` line. */
export function isBareTablePrefix(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_]+$/u.test(value);
}

export function isSafeSqlIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_]+$/u.test(value);
}

export function synthesizeWpTableContext(basePrefix: string, blogPrefix: string): WpTableContext {
  const tables: Record<string, string> = {};
  for (const name of WP_BLOG_TABLES) {
    tables[name] = `${blogPrefix}${name}`;
  }
  for (const name of WP_GLOBAL_TABLES) {
    tables[name] = `${basePrefix}${name}`;
  }
  return {
    tablePrefix: blogPrefix,
    basePrefix,
    tables
  };
}

export function contextFromConfigPrefix(basePrefix: string, blogId: number | undefined): WpTableContext {
  const blogPrefix = blogId !== undefined && blogId > 1
    ? `${basePrefix}${String(blogId)}_`
    : basePrefix;
  return synthesizeWpTableContext(basePrefix, blogPrefix);
}

export function parseWpTableContext(raw: string): WpTableContext | null {
  const markerAt = raw.lastIndexOf(WP_AGENT_TABLES_MARKER);
  if (markerAt >= 0) {
    return parseTableContextJson(raw.slice(markerAt + WP_AGENT_TABLES_MARKER.length));
  }
  const bare = raw.trim();
  if (!isBareTablePrefix(bare)) {
    return null;
  }
  return synthesizeWpTableContext(bare, bare);
}

function parseTableContextJson(payload: string): WpTableContext | null {
  const start = payload.indexOf("{");
  const end = payload.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.prefix !== "string" || !isPlausibleTablePrefix(record.prefix)) {
    return null;
  }
  const basePrefix = typeof record.basePrefix === "string" && isPlausibleTablePrefix(record.basePrefix)
    ? record.basePrefix
    : record.prefix;
  const synthesized = synthesizeWpTableContext(basePrefix, record.prefix);
  const tablesRaw = record.tables;
  if (!tablesRaw || typeof tablesRaw !== "object") {
    return synthesized;
  }
  const tables = { ...synthesized.tables };
  const provided = tablesRaw as Record<string, unknown>;
  for (const name of WP_CORE_TABLES) {
    const value = provided[name];
    if (typeof value === "string" && isSafeSqlIdentifier(value)) {
      tables[name] = value;
    }
  }
  return {
    tablePrefix: record.prefix,
    basePrefix,
    tables
  };
}

type SqlSpan = {
  start: number;
  end: number;
  logical: string;
  physical: string;
};

/**
 * Replaces logical core table names and `{prefix}` tokens that sit outside
 * strings and comments. `tablesRewritten` lists only identifiers that changed.
 */
export function rewriteSqlTableNames(
  sql: string,
  context: WpTableContext
): { sql: string; tablesRewritten: Record<string, string> } {
  const exposed = exposureMask(sql);
  const spans: SqlSpan[] = [];

  for (const match of sql.matchAll(CORE_TABLE_PATTERN)) {
    const logical = match[0] ?? "";
    const start = match.index ?? 0;
    const end = start + logical.length;
    if (!isFullyExposed(sql, exposed, start, end)) {
      continue;
    }
    const suffix = (match[1] ?? "").toLowerCase();
    const physical = context.tables[suffix];
    if (!physical || !isSafeSqlIdentifier(physical) || physical === logical) {
      continue;
    }
    spans.push({ start, end, logical, physical });
  }

  for (const match of sql.matchAll(PREFIX_TOKEN_PATTERN)) {
    const logical = match[0] ?? "";
    const start = match.index ?? 0;
    const end = start + logical.length;
    if (!isFullyExposed(sql, exposed, start, end)) {
      continue;
    }
    const physical = logical.split(WP_TABLE_PREFIX_TOKEN).join(context.tablePrefix);
    if (!isSafeSqlIdentifier(physical) || physical === logical) {
      continue;
    }
    spans.push({ start, end, logical, physical });
  }

  spans.sort((left, right) => left.start - right.start || right.end - left.end);
  const chosen: SqlSpan[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) {
      continue;
    }
    chosen.push(span);
    cursor = span.end;
  }

  let rewritten = "";
  let last = 0;
  const tablesRewritten: Record<string, string> = {};
  for (const span of chosen) {
    rewritten += sql.slice(last, span.start) + span.physical;
    last = span.end;
    tablesRewritten[span.logical] = span.physical;
  }
  rewritten += sql.slice(last);
  return { sql: rewritten, tablesRewritten };
}

function isFullyExposed(sql: string, mask: string, start: number, end: number): boolean {
  return mask.slice(start, end) === sql.slice(start, end);
}

/** Same literal and comment masking as the read-only SQL gate, indexed by code unit. */
function exposureMask(sql: string): string {
  const out: string[] = new Array(sql.length);
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") {
      out[i] = "-";
      out[i + 1] = "-";
      i += 2;
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      out[i] = "/";
      out[i + 1] = "*";
      i += 2;
      while (i + 1 < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out[i] = " ";
        i += 1;
      }
      if (i + 1 < sql.length && sql[i] === "*" && sql[i + 1] === "/") {
        out[i] = "*";
        out[i + 1] = "/";
        i += 2;
      }
      continue;
    }
    if (c === "'" || c === "\"") {
      const quote = c;
      out[i] = quote;
      i += 1;
      while (i < sql.length) {
        const ch = sql[i]!;
        if (ch === "\\") {
          out[i] = " ";
          i += 1;
          if (i < sql.length) {
            out[i] = " ";
            i += 1;
          }
          continue;
        }
        if (ch === quote) {
          if (quote === "'" && sql[i + 1] === "'") {
            out[i] = "'";
            out[i + 1] = "'";
            i += 2;
            continue;
          }
          out[i] = quote;
          i += 1;
          break;
        }
        out[i] = " ";
        i += 1;
      }
      continue;
    }
    out[i] = c;
    i += 1;
  }
  return out.join("");
}
