import { AppError } from "../errors";
import { isMissingMysqlClientMessage } from "../mysqlUnixSocket";
import { runWpCli } from "../wpCli";
import type { ConfigService } from "./configService";
import {
  assertAndFinalizeReadonlySelect,
  READONLY_SQL_ABS_MAX_ROWS,
  READONLY_SQL_DEFAULT_MAX_ROWS,
  READONLY_SQL_MAX_STDOUT_CHARS
} from "./readonlyWpDbSql";
import {
  contextFromConfigPrefix,
  isBareTablePrefix,
  parseWpTableContext,
  rewriteSqlTableNames,
  WP_AGENT_TABLES_MARKER,
  WP_CORE_TABLES,
  type WpTableContext
} from "./wpTableNames";

export type WpDbReadInput = {
  wpRoot?: string;
  sql?: unknown;
  maxRows?: unknown;
  siteUrl?: unknown;
  blogId?: unknown;
  /**
   * Optional prefix hint from a prior `connect_wordpress` call.
   * The live `$wpdb->prefix` is used when this disagrees with WordPress.
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

const BASE64_CELL = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function decodeReadonlyEvalCell(cell: string): string {
  if (cell.length === 0) {
    return "";
  }
  if (!BASE64_CELL.test(cell)) {
    throw new AppError(
      "DB_UNREACHABLE",
      "wp eval did not return base64-encoded query cells. The database connection failed, so this result was discarded.",
      400,
      { sample: cell.slice(0, 180) }
    );
  }
  return Buffer.from(cell, "base64").toString("utf8");
}

export function createWpDbReadService(deps: WpDbReadServiceDeps): WpDbReadService {
  // Cache live `$wpdb` table maps keyed by root, site URL, and blog id.
  const tableContextCache = new Map<string, WpTableContext>();

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
   * Eval fallback is only for a missing mysql binary. WP-CLI also prefixes socket,
   * auth, and server failures with "Failed to get current SQL modes".
   */
  function isMissingMysqlClientForWpDbQuery(err: unknown): boolean {
    if (!(err instanceof AppError) || err.code !== "WPCLI_FAILED") {
      return false;
    }
    const details = err.details as { stderr?: unknown } | undefined;
    const stderr = typeof details?.stderr === "string" ? details.stderr : "";
    return isMissingMysqlClientMessage(stderr);
  }

  function buildTableContextPhp(blogId: number | undefined): string {
    const encodedBlogId = blogId ? String(blogId) : "";
    const keyList = WP_CORE_TABLES.map((key) => `'${key}'`).join(",");
    return [
      "global $wpdb;",
      `$blogIdRaw = '${encodedBlogId.replace(/'/gu, "\\'")}';`,
      "$blogId = (int) $blogIdRaw;",
      "if ($blogId > 0 && function_exists('switch_to_blog')) { switch_to_blog($blogId); }",
      `$keys = array(${keyList});`,
      "$tables = array();",
      "foreach ($keys as $key) { $tables[$key] = isset($wpdb->$key) ? (string) $wpdb->$key : ''; }",
      `$encoded = function_exists('wp_json_encode') ? wp_json_encode(array('prefix' => (string) $wpdb->prefix, 'basePrefix' => (string) $wpdb->base_prefix, 'tables' => $tables)) : json_encode(array('prefix' => (string) $wpdb->prefix, 'basePrefix' => (string) $wpdb->base_prefix, 'tables' => $tables));`,
      `echo '${WP_AGENT_TABLES_MARKER}' . $encoded;`
    ].join(" ");
  }

  function resolveTableContextDirect(
    wpRoot: string,
    siteUrl: string | undefined,
    blogId: number | undefined
  ): WpTableContext {
    try {
      const raw = runWpCli(
        wpRoot,
        [...contextArgs(siteUrl), "eval", buildTableContextPhp(blogId)],
        deps.wpCli
      );
      const parsed = parseWpTableContext(raw);
      if (parsed) {
        return parsed;
      }
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== "DB_UNREACHABLE") {
        throw err;
      }
    }

    const fromConfig = runWpCli(
      wpRoot,
      [...contextArgs(siteUrl), "config", "get", "table_prefix"],
      deps.wpCli
    ).trim();
    if (!isBareTablePrefix(fromConfig)) {
      throw new AppError(
        "DB_UNREACHABLE",
        "Could not resolve the WordPress table prefix because the database connection failed.",
        400,
        { tablePrefix: fromConfig.slice(0, 180) }
      );
    }
    return contextFromConfigPrefix(fromConfig, blogId);
  }

  /**
   * Live `$wpdb` names for this root and blog. A caller-supplied prefix is not
   * stored here; when it disagrees with WordPress, the live map still wins.
   */
  function resolveTableContext(
    wpRoot: string,
    siteUrl: string | undefined,
    blogId: number | undefined
  ): WpTableContext {
    const cacheKey = `${wpRoot}::${siteUrl ?? ""}::${String(blogId ?? "")}`;
    const cached = tableContextCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const resolved = resolveTableContextDirect(wpRoot, siteUrl, blogId);
    tableContextCache.set(cacheKey, resolved);
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
      return decodeReadonlyEvalCell(cell);
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
      // `input.tablePrefix` is a hint only. SQL is rewritten from the live `$wpdb` map.
      const tableContext = resolveTableContext(wpRoot, siteUrl, blogId);
      const rewritten = rewriteSqlTableNames(finalized, tableContext);

      let result: QueryResult;
      try {
        result = runReadonlyViaWpDbQuery(wpRoot, rewritten.sql, siteUrl);
      } catch (err) {
        if (!isMissingMysqlClientForWpDbQuery(err)) {
          throw err;
        }
        result = runReadonlySqlViaEval(wpRoot, rewritten.sql, siteUrl, blogId);
      }

      const { columns, dataRows } = result;
      const truncated = dataRows.length > READONLY_SQL_MAX_STDOUT_CHARS;
      const stdout = truncated ? dataRows.slice(0, READONLY_SQL_MAX_STDOUT_CHARS) : dataRows;

      return {
        wpRoot,
        tablePrefix: tableContext.tablePrefix,
        tablesRewritten: rewritten.tablesRewritten,
        context: {
          siteUrl: siteUrl ?? null,
          blogId: blogId ?? null
        },
        sqlExecuted: rewritten.sql,
        columns,
        stdout,
        stdoutTruncated: truncated,
        stdoutCharCount: stdout.length
      };
    }
  };
}
