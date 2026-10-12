/**
 * Minimal read-only SQL gate for `wp db query`.
 * Validates a masked copy of the query (literals + comments removed) so
 * obvious injection / multi-statement / exfil patterns are rejected.
 */

import { AppError } from "../errors";

export const READONLY_SQL_MAX_LENGTH = 12_000;
export const READONLY_SQL_DEFAULT_MAX_ROWS = 200;
export const READONLY_SQL_ABS_MAX_ROWS = 2_000;
export const READONLY_SQL_MAX_STDOUT_CHARS = 400_000;

const FORBIDDEN_SCHEMA_DOT = /\b(information_schema|mysql|performance_schema|sys)\s*\./i;

const FORBIDDEN_SUBSTRINGS: Array<{ needle: string; message: string }> = [
  { needle: " into ", message: "INTO is not allowed in read-only SELECT." },
  { needle: " outfile", message: "OUTFILE / dump paths are not allowed." },
  { needle: " dumpfile", message: "DUMPFILE is not allowed." },
  { needle: "load_file", message: "LOAD_FILE is not allowed." },
  { needle: "benchmark(", message: "BENCHMARK() is not allowed." },
  { needle: "sleep(", message: "SLEEP() is not allowed." }
];

/** Matched against the collapsed, literal-masked probe (lowercased). */
const FORBIDDEN_SQL_REGEXES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bdelete\b/i, message: "DELETE is not allowed." },
  { pattern: /\binsert\b/i, message: "INSERT is not allowed." },
  { pattern: /\bupdate\b/i, message: "UPDATE is not allowed." },
  { pattern: /\bdrop\b/i, message: "DROP is not allowed." },
  { pattern: /\bcreate\b/i, message: "CREATE is not allowed." },
  { pattern: /\balter\b/i, message: "ALTER is not allowed." },
  { pattern: /\btruncate\b/i, message: "TRUNCATE is not allowed." },
  { pattern: /\breplace\b/i, message: "REPLACE is not allowed." },
  { pattern: /\bgrant\b/i, message: "GRANT is not allowed." },
  { pattern: /\brevoke\b/i, message: "REVOKE is not allowed." },
  { pattern: /\bcall\b/i, message: "CALL is not allowed." },
  { pattern: /\bhandler\b/i, message: "HANDLER is not allowed." },
  { pattern: /\bload\s+data\b/i, message: "LOAD DATA is not allowed." },
  { pattern: /\block\s+tables\b/i, message: "LOCK TABLES is not allowed." },
  { pattern: /\boptimize\s+table\b/i, message: "OPTIMIZE TABLE is not allowed." },
  { pattern: /\brepair\s+table\b/i, message: "REPAIR TABLE is not allowed." },
  { pattern: /\bcheck\s+table\b/i, message: "CHECK TABLE is not allowed." },
  { pattern: /\banalyze\s+table\b/i, message: "ANALYZE TABLE is not allowed." },
  { pattern: /\bflush\b/i, message: "FLUSH is not allowed." },
  { pattern: /\bkill\b/i, message: "KILL is not allowed." },
  { pattern: /\bshutdown\b/i, message: "SHUTDOWN is not allowed." },
  { pattern: /\bset\s+global\b/i, message: "SET GLOBAL is not allowed." },
  { pattern: /\bset\s+persist\b/i, message: "SET PERSIST is not allowed." }
];

/**
 * Masks single-quoted literals (handles '' escapes), SQL line comments (two hyphens), and block comments (slash-star form).
 * Double-quoted string literals are masked the same way (common in ANSI_QUOTES off mode for identifiers only,
 * but masking avoids keyword false negatives inside double quotes).
 */
export function maskSqlForReadonlyProbe(sql: string): string {
  const chars = [...sql];
  const out = chars.map(() => " ");

  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;

    if (c === "-" && chars[i + 1] === "-") {
      out[i] = "-";
      out[i + 1] = "-";
      i += 2;
      while (i < chars.length && chars[i] !== "\n" && chars[i] !== "\r") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }

    if (c === "/" && chars[i + 1] === "*") {
      out[i] = "/";
      out[i + 1] = "*";
      i += 2;
      while (i + 1 < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) {
        out[i] = " ";
        i += 1;
      }
      if (i + 1 < chars.length && chars[i] === "*" && chars[i + 1] === "/") {
        out[i] = "*";
        out[i + 1] = "/";
        i += 2;
      }
      continue;
    }

    if (c === "'" || c === '"') {
      const quote = c;
      out[i] = quote;
      i += 1;
      while (i < chars.length) {
        const ch = chars[i]!;
        if (ch === "\\") {
          out[i] = " ";
          i += 1;
          if (i < chars.length) {
            out[i] = " ";
            i += 1;
          }
          continue;
        }
        if (ch === quote) {
          if (quote === "'" && chars[i + 1] === "'") {
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

function collapseWhitespace(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function assertSingleStatement(sql: string): void {
  const trimmed = sql.trim().replace(/;\s*$/u, "").trim();
  const masked = maskSqlForReadonlyProbe(trimmed);
  if (masked.includes(";")) {
    throw new AppError(
      "INVALID_READONLY_SQL",
      "Only a single SQL statement is allowed (no multiple statements separated by `;`).",
      400
    );
  }
}

function assertSelectOnly(probeCollapsed: string): void {
  if (!/^select\b/iu.test(probeCollapsed)) {
    throw new AppError(
      "INVALID_READONLY_SQL",
      "Only read-only `SELECT` statements are allowed.",
      400
    );
  }
}

function assertNoForbiddenProbe(probeCollapsed: string): void {
  const lowered = probeCollapsed.toLowerCase();
  for (const { needle, message } of FORBIDDEN_SUBSTRINGS) {
    if (lowered.includes(needle)) {
      throw new AppError("INVALID_READONLY_SQL", message, 400, { pattern: needle });
    }
  }
  if (FORBIDDEN_SCHEMA_DOT.test(lowered)) {
    throw new AppError(
      "INVALID_READONLY_SQL",
      "Cross-schema reads (information_schema / mysql / sys / performance_schema) are not allowed.",
      400
    );
  }

  for (const { pattern, message } of FORBIDDEN_SQL_REGEXES) {
    if (pattern.test(lowered)) {
      throw new AppError("INVALID_READONLY_SQL", message, 400);
    }
  }
}

function parseTrailingLimit(sqlTrimmed: string): { limit: number; offset?: number } | null {
  // MySQL short-form: LIMIT offset, count  (first arg is offset, second is the row count).
  // Must be checked before the ANSI form so the comma is not silently ignored,
  // which would cause the row-count cap to be applied against the offset value instead.
  const mComma = /\blimit\s+(\d+)\s*,\s*(\d+)\s*;?\s*$/iu.exec(sqlTrimmed);
  if (mComma) {
    return {
      limit: Number.parseInt(mComma[2] ?? "0", 10), // [2] is the row count
      offset: Number.parseInt(mComma[1] ?? "0", 10) // [1] is the offset
    };
  }
  // ANSI form: LIMIT count [OFFSET offset]
  const m = /\blimit\s+(\d+)(?:\s+offset\s+(\d+))?\s*;?\s*$/iu.exec(sqlTrimmed);
  if (!m) {
    return null;
  }
  return {
    limit: Number.parseInt(m[1] ?? "0", 10),
    offset: m[2] !== undefined ? Number.parseInt(m[2] ?? "0", 10) : undefined
  };
}

/**
 * Returns SQL safe to pass to `wp db query` (trailing semicolon stripped, LIMIT enforced).
 */
export function assertAndFinalizeReadonlySelect(sqlInput: string, maxRows: number): string {
  const sql = sqlInput.trim();
  if (!sql) {
    throw new AppError("INVALID_READONLY_SQL", "SQL must not be empty.", 400);
  }
  if (sql.length > READONLY_SQL_MAX_LENGTH) {
    throw new AppError(
      "INVALID_READONLY_SQL",
      `SQL exceeds maximum length (${String(READONLY_SQL_MAX_LENGTH)} characters).`,
      400
    );
  }

  assertSingleStatement(sql);

  const withoutTrailingSemi = sql.trim().replace(/;\s*$/u, "").trim();
  const probe = maskSqlForReadonlyProbe(withoutTrailingSemi);
  const probeCollapsed = collapseWhitespace(probe);

  assertSelectOnly(probeCollapsed);
  assertNoForbiddenProbe(probeCollapsed);

  const parsed = parseTrailingLimit(withoutTrailingSemi);
  if (!parsed) {
    return `${withoutTrailingSemi} LIMIT ${String(maxRows)}`;
  }
  if (!Number.isFinite(parsed.limit) || parsed.limit < 1) {
    throw new AppError("INVALID_READONLY_SQL", "LIMIT must be a positive integer.", 400);
  }
  if (parsed.limit > maxRows) {
    throw new AppError(
      "INVALID_READONLY_SQL",
      `LIMIT ${String(parsed.limit)} exceeds the allowed maxRows (${String(maxRows)}). Lower LIMIT or raise maxRows within the server cap.`,
      400,
      { limit: parsed.limit, maxRows }
    );
  }
  if (parsed.offset !== undefined && (!Number.isFinite(parsed.offset) || parsed.offset < 0)) {
    throw new AppError("INVALID_READONLY_SQL", "OFFSET must be a non-negative integer.", 400);
  }
  return withoutTrailingSemi;
}
