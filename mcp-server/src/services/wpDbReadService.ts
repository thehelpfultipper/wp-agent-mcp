import { AppError } from "../errors";
import { runWpCli } from "../wpCli";
import type { ConfigService } from "./configService";
import {
  assertAndFinalizeReadonlySelect,
  READONLY_SQL_ABS_MAX_ROWS,
  READONLY_SQL_DEFAULT_MAX_ROWS,
  READONLY_SQL_MAX_STDOUT_CHARS
} from "./readonlyWpDbSql";

export type WpDbReadInput = {
  wpRoot?: string;
  sql?: unknown;
  maxRows?: unknown;
  siteUrl?: unknown;
  blogId?: unknown;
  /**
   * Optional pre-resolved table prefix (e.g. from a prior `connect_wordpress` call).
   * When supplied, the service skips the `wp eval` round-trip used to resolve it.
   */
  tablePrefix?: unknown;
};

export type WpDbReadService = {
  queryReadonlySelect: (input: WpDbReadInput) => Record<string, unknown>;
};

type WpDbReadServiceDeps = {
  wpCli: string;
  config: ConfigService;
};

type QueryResult = {
  columns: string[];
  dataRows: string;
};

export function createWpDbReadService(deps: WpDbReadServiceDeps): WpDbReadService {
  // Cache resolved table prefixes keyed by `${wpRoot}::${blogId}` to avoid
  // an extra `wp eval` round-trip on repeated calls with the same context.
  const prefixCache = new Map<string, string>();

  function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  function normalizeOptionalBlogId(value: unknown): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      throw new AppError("TOOL_INPUT_INVALID", "Invalid `blogId`. Provide a positive integer.", 400, {
        blogId: value
      });
    }
    const parsed = Math.floor(numeric);
    if (parsed < 1) {
      throw new AppError("TOOL_INPUT_INVALID", "Invalid `blogId`. Provide a positive integer.", 400, {
        blogId: value
      });
    }
    return parsed;
  }

  function contextArgs(siteUrl: string | undefined): string[] {
    return siteUrl ? [`--url=${siteUrl}`] : [];
  }

  /**
   * Fix 2: broadened detection — covers macOS (`env: mysql: No such file or directory`),
   * Linux (`mysql: command not found`), and WP-CLI's own wrapper message for any of them.
   */
  function isMissingMysqlClientForWpDbQuery(err: unknown): boolean {
    if (!(err instanceof AppError) || err.code !== "WPCLI_FAILED") {
      return false;
    }
    const details = err.details as { stderr?: unknown } | undefined;
    const stderr = typeof details?.stderr === "string" ? details.stderr : "";
    return (
      stderr.includes("mysql: No such file or directory") ||
      stderr.includes("mysql: command not found") ||
      stderr.includes("env: mysql:") ||
      stderr.includes("Failed to get current SQL modes")
    );
  }

  function resolveTablePrefixDirect(
    wpRoot: string,
    siteUrl: string | undefined,
    blogId: number | undefined
  ): string {
    const encodedBlogId = blogId ? String(blogId) : "";
    const php = [
      "global $wpdb;",
      `$blogIdRaw = '${encodedBlogId.replace(/'/gu, "\\'")}';`,
      "$blogId = (int) $blogIdRaw;",
      "if ($blogId > 0 && function_exists('switch_to_blog')) {",
      "  switch_to_blog($blogId);",
      "}",
      "echo (string) $wpdb->prefix;"
    ].join(" ");
    return runWpCli(wpRoot, [...contextArgs(siteUrl), "eval", php], deps.wpCli).trim();
  }

  /**
   * Fix 4: resolve with in-process cache so repeated calls in the same server session
   * (same wpRoot + blogId) skip the extra `wp eval` round-trip.
   */
  function resolveTablePrefix(
    wpRoot: string,
    siteUrl: string | undefined,
    blogId: number | undefined
  ): string {
    const cacheKey = `${wpRoot}::${String(blogId ?? "")}`;
    const cached = prefixCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = resolveTablePrefixDirect(wpRoot, siteUrl, blogId);
    prefixCache.set(cacheKey, resolved);
    return resolved;
  }

  /**
   * Fix 3 (primary path): run without `--skip-column-names` so MySQL emits the header
   * row first. Split that row out as `columns`; everything else is the data payload.
   */
  function runReadonlyViaWpDbQuery(
    wpRoot: string,
    sql: string,
    siteUrl: string | undefined
  ): QueryResult {
    const raw = runWpCli(
      wpRoot,
      [...contextArgs(siteUrl), "db", "query", sql],
      deps.wpCli
    );
    const lines = raw.split("\n");
    const headerLine = lines[0] ?? "";
    const columns = headerLine ? headerLine.split("\t") : [];
    const dataRows = lines.slice(1).join("\n");
    return { columns, dataRows };
  }

  /**
   * Fix 3 (eval fallback): outputs base64-encoded column names on the first line,
   * then base64-encoded data rows — mirrors the header/data split of the primary path.
   */
  function runReadonlySqlViaEval(
    wpRoot: string,
    sql: string,
    siteUrl: string | undefined,
    blogId: number | undefined
  ): QueryResult {
    const sqlB64 = Buffer.from(sql, "utf8").toString("base64");
    const encodedBlogId = blogId ? String(blogId) : "";
    const php = [
      "global $wpdb;",
      `$blogIdRaw = '${encodedBlogId.replace(/'/gu, "\\'")}';`,
      "$blogId = (int) $blogIdRaw;",
      "if ($blogId > 0 && function_exists('switch_to_blog')) {",
      "  switch_to_blog($blogId);",
      "}",
      `$sql = base64_decode('${sqlB64}');`,
      "$rows = $wpdb->get_results($sql, ARRAY_N);",
      "if (!is_array($rows)) {",
      "  $rows = [];",
      "}",
      "$colNames = $wpdb->get_col_info('name');",
      "if (!is_array($colNames)) {",
      "  $colNames = count($rows) > 0 ? array_fill(0, count($rows[0]), '') : [];",
      "}",
      "$headerEncoded = [];",
      "foreach ($colNames as $col) {",
      "  $headerEncoded[] = base64_encode((string)($col ?? ''));",
      "}",
      "echo implode(\"\\t\", $headerEncoded) . PHP_EOL;",
      "foreach ($rows as $row) {",
      "  $encoded = [];",
      "  foreach ($row as $cell) {",
      "    $encoded[] = base64_encode((string)($cell ?? ''));",
      "  }",
      "  echo implode(\"\\t\", $encoded) . PHP_EOL;",
      "}"
    ].join(" ");

    const raw = runWpCli(wpRoot, [...contextArgs(siteUrl), "eval", php], deps.wpCli);
    const allLines = raw.length > 0 ? raw.split("\n") : [""];

    function decodeCell(cell: string): string {
      if (!cell) return "";
      try {
        return Buffer.from(cell, "base64").toString("utf8");
      } catch {
        return "";
      }
    }

    const headerLine = allLines[0] ?? "";
    const columns = headerLine ? headerLine.split("\t").map(decodeCell) : [];

    const decodedDataLines = allLines.slice(1).map((line) =>
      line.split("\t").map(decodeCell).join("\t")
    );

    return { columns, dataRows: decodedDataLines.join("\n") };
  }

  return {
    queryReadonlySelect: (input) => {
      if (typeof input.sql !== "string" || !input.sql.trim()) {
        throw new AppError("TOOL_INPUT_INVALID", "Provide a non-empty `sql` string (single SELECT only).", 400);
      }

      const wpRoot = deps.config.resolveValidWpRoot(
        typeof input.wpRoot === "string" && input.wpRoot.trim() ? input.wpRoot : undefined
      );

      const rawMax =
        typeof input.maxRows === "number" && Number.isFinite(input.maxRows)
          ? Math.floor(input.maxRows)
          : READONLY_SQL_DEFAULT_MAX_ROWS;
      const maxRows = Math.max(1, Math.min(READONLY_SQL_ABS_MAX_ROWS, rawMax));
      const siteUrl = normalizeOptionalString(input.siteUrl);
      const blogId = normalizeOptionalBlogId(input.blogId);

      const finalized = assertAndFinalizeReadonlySelect(input.sql, maxRows);

      // Fix 4: accept a caller-supplied prefix (e.g. from connect_wordpress) to avoid
      // an extra wp eval round-trip; otherwise use the per-context cache then resolve.
      const tablePrefix =
        normalizeOptionalString(input.tablePrefix) ??
        resolveTablePrefix(wpRoot, siteUrl, blogId);

      let result: QueryResult;
      try {
        result = runReadonlyViaWpDbQuery(wpRoot, finalized, siteUrl);
      } catch (err) {
        if (!isMissingMysqlClientForWpDbQuery(err)) {
          throw err;
        }
        result = runReadonlySqlViaEval(wpRoot, finalized, siteUrl, blogId);
      }

      const { columns, dataRows } = result;
      const truncated = dataRows.length > READONLY_SQL_MAX_STDOUT_CHARS;
      const stdout = truncated ? dataRows.slice(0, READONLY_SQL_MAX_STDOUT_CHARS) : dataRows;

      return {
        wpRoot,
        tablePrefix,
        context: {
          siteUrl: siteUrl ?? null,
          blogId: blogId ?? null
        },
        sqlExecuted: finalized,
        columns,
        stdout,
        stdoutTruncated: truncated,
        stdoutCharCount: stdout.length
      };
    }
  };
}
