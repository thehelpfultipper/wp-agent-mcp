import type { ToolHandler, ToolInvokeInput } from "../registry";
import { AppError, type ErrorCode } from "../../errors";
import { parsePort } from "../../config/validation";
import type { ProjectServices } from "../../services";
import { assertWithinRoot } from "../../sandbox";
import path from "node:path";

type HttpMethod = "GET" | "POST";

type EndpointInvokeConfig = {
  method: HttpMethod;
  path: string;
  mapInput?: (input: ToolInvokeInput) => Record<string, unknown>;
};

type ErrorEnvelope = {
  ok: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type SuccessEnvelope = {
  ok: true;
  data: Record<string, unknown>;
};

type PathErrorCode = "INVALID_FS_READ_INPUT" | "INVALID_SEARCH_INPUT";

const knownErrorCodes: Set<ErrorCode> = new Set([
  "WP_ROOT_INVALID",
  "WPCLI_NOT_FOUND",
  "WPCLI_FAILED",
  "INVALID_DUMP_FILE",
  "DUMP_PATH_NOT_ALLOWED",
  "DB_BACKUP_FAILED",
  "DB_IMPORT_FAILED",
  "MYSQL_CLIENT_NOT_FOUND",
  "SYNC_PREFLIGHT_FAILED",
  "DB_UNREACHABLE",
  "DB_SYNC_REQUIRES_ELEVATED_CONTEXT",
  "DB_SYNC_ASSERTION_FAILED",
  "IMPORT_METHOD_FAILED",
  "DB_URL_REPLACE_FAILED",
  "MULTISITE_UPDATE_FAILED",
  "INDEX_NOT_READY",
  "TOOL_NOT_FOUND",
  "TOOL_INPUT_INVALID",
  "INVALID_INDEX_LIMIT",
  "INVALID_INDEX_MODE",
  "INVALID_SEARCH_INPUT",
  "INVALID_FS_READ_INPUT",
  "FS_READ_NOT_FOUND",
  "FS_SEARCH_PATH_NOT_FOUND",
  "INVALID_AUDIT_QUERY",
  "BRIDGE_INTENT_TOO_RAW",
  "INVALID_READONLY_SQL",
  "INVALID_PATCH_FORMAT",
  "PATCH_PATH_OUTSIDE_ROOT",
  "PATCH_APPLY_FAILED",
  "PHP_LINT_FAILED",
  "INTERNAL_ERROR"
]);

function resolveServerBaseUrl(): string {
  const port = parsePort(process.env.MCP_PORT);
  return `http://127.0.0.1:${String(port)}`;
}

// Transitional bridge: these adapters keep public MCP tools working while some
// behavior still lives in HTTP handlers. Endpoint paths here are internal
// transport details, not the preferred public integration interface.
async function invokeEndpoint(config: EndpointInvokeConfig, input: ToolInvokeInput): Promise<Record<string, unknown>> {
  const payload = config.mapInput ? config.mapInput(input) : input;
  const baseUrl = resolveServerBaseUrl();
  const url = new URL(config.path, baseUrl);
  const requestInit: RequestInit = { method: config.method };

  if (config.method === "GET") {
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  } else {
    requestInit.headers = {
      "content-type": "application/json"
    };
    requestInit.body = JSON.stringify(payload);
  }

  const response = await fetch(url, requestInit);
  const body = (await response.json()) as SuccessEnvelope | ErrorEnvelope | Record<string, unknown>;
  if (!response.ok || !isOkEnvelope(body)) {
    const fallbackMessage = `Endpoint ${config.path} failed with status ${String(response.status)}.`;
    if (isErrorEnvelope(body)) {
      throw new AppError(resolveErrorCode(body.error?.code), body.error?.message ?? fallbackMessage, response.status, {
        details: body.error?.details
      });
    }
    throw new AppError("INTERNAL_ERROR", fallbackMessage, response.status);
  }

  return body.data;
}

function resolveErrorCode(rawCode: string | undefined): ErrorCode {
  if (!rawCode) {
    return "INTERNAL_ERROR";
  }
  return knownErrorCodes.has(rawCode as ErrorCode) ? (rawCode as ErrorCode) : "INTERNAL_ERROR";
}

function isOkEnvelope(value: unknown): value is SuccessEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybe = value as { ok?: unknown; data?: unknown };
  return maybe.ok === true && Boolean(maybe.data) && typeof maybe.data === "object" && !Array.isArray(maybe.data);
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybe = value as { ok?: unknown; error?: unknown };
  return maybe.ok === false && (maybe.error === undefined || typeof maybe.error === "object");
}

function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeNonEmptyString(entry);
    if (normalized) {
      deduped.add(normalized);
    }
  }
  return [...deduped];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWpRoot(value: unknown): string | undefined {
  return normalizeNonEmptyString(value);
}

function normalizeLimit(
  rawLimit: unknown,
  defaults: { fallback: number; min: number; max: number; field: string }
): number {
  const numeric = toNumberOrUndefined(rawLimit);
  if (numeric === undefined) {
    return defaults.fallback;
  }
  const floored = Math.floor(numeric);
  if (!Number.isFinite(floored)) {
    return defaults.fallback;
  }
  if (floored < defaults.min || floored > defaults.max) {
    throw new AppError(
      "TOOL_INPUT_INVALID",
      `Invalid \`${defaults.field}\`. Provide a number between ${defaults.min} and ${defaults.max}.`,
      400,
      {
        field: defaults.field,
        min: defaults.min,
        max: defaults.max,
        received: rawLimit
      }
    );
  }
  return floored;
}

function resolveValidatedWpRoot(rawWpRoot: unknown, services: ProjectServices): string {
  const wpRoot = normalizeWpRoot(rawWpRoot);
  return services.config.resolveValidWpRoot(wpRoot);
}

function normalizeSafeProjectPath(
  rawPath: unknown,
  fieldName: string,
  wpRoot: string,
  errorCode: PathErrorCode
): string {
  const value = normalizeNonEmptyString(rawPath);
  if (!value) {
    throw new AppError(errorCode, `Invalid \`${fieldName}\`. Provide a non-empty string.`, 400, {
      field: fieldName
    });
  }
  if (value.includes("\u0000")) {
    throw new AppError(errorCode, `Invalid \`${fieldName}\`. Path must not contain null bytes.`, 400, {
      field: fieldName
    });
  }
  const absoluteCandidate = path.isAbsolute(value) ? value : path.join(wpRoot, value);
  try {
    assertWithinRoot(wpRoot, absoluteCandidate, fieldName);
  } catch (error) {
    if (error instanceof AppError && error.code === "WP_ROOT_INVALID") {
      throw new AppError(errorCode, `Invalid \`${fieldName}\`. Path must stay within wpRoot.`, 400, {
        field: fieldName,
        path: value
      });
    }
    throw error;
  }
  return value;
}

function normalizePatchDiffPath(rawPath: string): string | null {
  const trimmed = rawPath.split("\t")[0]?.trim() ?? "";
  if (!trimmed) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid unified diff: missing file path in header.", 400);
  }
  if (trimmed === "/dev/null") {
    return null;
  }
  const withoutPrefix = trimmed.startsWith("a/") || trimmed.startsWith("b/")
    ? trimmed.slice(2)
    : trimmed;
  const normalized = withoutPrefix.replace(/^\.\/+/u, "");
  if (!normalized || path.isAbsolute(normalized)) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid unified diff: patch paths must be relative.", 400, {
      path: trimmed
    });
  }
  if (normalized.split(/[\\/]+/u).some((segment) => segment === "..")) {
    throw new AppError("PATCH_PATH_OUTSIDE_ROOT", "Patch file path must stay within wpRoot.", 400, {
      path: trimmed
    });
  }
  return normalized;
}

function validatePatchPreflight(rawPatch: unknown, wpRoot: string): string {
  const patch = typeof rawPatch === "string" ? rawPatch : "";
  if (patch.trim().length === 0) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid `patch`. Provide a non-empty unified diff.", 400);
  }
  if (patch.includes("\u0000")) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid `patch`. Patch must not contain null bytes.", 400);
  }
  if (patch.length > 1_000_000) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid `patch`. Patch payload is too large.", 400, {
      maxBytes: 1_000_000
    });
  }
  if (!patch.includes("--- ") || !patch.includes("+++ ") || !patch.includes("@@ ")) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid `patch`. Provide a unified diff with file headers and hunks.", 400);
  }

  const patchLines = patch.replace(/\r\n/gu, "\n").split("\n");
  const headerPaths: string[] = [];
  for (const line of patchLines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const normalized = normalizePatchDiffPath(line.slice(4));
      if (normalized) {
        headerPaths.push(normalized);
      }
    }
  }

  if (headerPaths.length === 0) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid `patch`. No patch file headers were detected.", 400);
  }

  for (const relativePath of headerPaths) {
    try {
      assertWithinRoot(wpRoot, path.join(wpRoot, relativePath), "patch path");
    } catch (error) {
      if (error instanceof AppError && error.code === "WP_ROOT_INVALID") {
        throw new AppError("PATCH_PATH_OUTSIDE_ROOT", "Patch file path must stay within wpRoot.", 400, {
          path: relativePath
        });
      }
      throw error;
    }
  }

  return patch;
}

export function createGetThemeProfileToolAdapter(services: ProjectServices): ToolHandler {
  return (input) =>
    invokeEndpoint(
      {
        method: "GET",
        path: "/wp/theme/profile",
        mapInput: (rawInput) => ({
          wpRoot: resolveValidatedWpRoot(rawInput.wpRoot, services)
        })
      },
      input
    );
}

export function createAuditComponentToolAdapter(services: ProjectServices): ToolHandler {
  return (input) => {
    const queryFromInput = normalizeNonEmptyString(input.query)
      ?? normalizeNonEmptyString(input.component_query);
    const structuredQuery = isPlainObject(input.query)
      ? input.query
      : isPlainObject(input.componentQuerySpec)
        ? input.componentQuerySpec
        : undefined;
    const normalizedQuery = queryFromInput ?? structuredQuery;
    if (!normalizedQuery) {
      throw new AppError(
        "INVALID_AUDIT_QUERY",
        "Invalid `query`. Provide a natural-language query string or a structured query object.",
        400,
        {
          acceptedInput: ["query", "component_query", "componentQuerySpec"]
        }
      );
    }

    return services.audit.auditComponent({
      query: normalizedQuery,
      wpRoot: resolveValidatedWpRoot(input.wpRoot, services),
      limit: normalizeLimit(input.limit, {
        fallback: 20,
        min: 1,
        max: 100,
        field: "limit"
      })
    });
  };
}

export function createFindSimilarContentToolAdapter(services: ProjectServices): ToolHandler {
  return (input) => {
    const query = normalizeNonEmptyString(input.query)
      ?? normalizeNonEmptyString(input.componentName);
    const classNames = normalizeStringList(input.classNames);
    const legacyClassName = normalizeNonEmptyString(input.className);
    if (legacyClassName && !classNames.includes(legacyClassName)) {
      classNames.push(legacyClassName);
    }
    const blockNames = normalizeStringList(input.blockNames);
    const snippet = typeof input.snippet === "string" ? input.snippet.trim() : "";
    const componentName = query
      ?? blockNames[0]
      ?? classNames[0]
      ?? (snippet ? "snippet" : "");

    if (!componentName) {
      throw new AppError(
        "INVALID_SEARCH_INPUT",
        "Invalid similarity query. Provide `query` (preferred) or an advanced field such as `classNames`, `blockNames`, or `snippet`.",
        400
      );
    }

    return services.similarity.findSimilar({
      componentName,
      classNames,
      blockNames,
      snippet,
      wpRoot: resolveValidatedWpRoot(input.wpRoot, services),
      limit: normalizeLimit(input.limit, {
        fallback: 25,
        min: 1,
        max: 100,
        field: "limit"
      })
    });
  };
}

export function createWhereIsUsedToolAdapter(services: ProjectServices): ToolHandler {
  return (input) => {
    const query = normalizeNonEmptyString(input.query);
    if (!query) {
      throw new AppError(
        "INVALID_SEARCH_INPUT",
        "Invalid usage query. Provide `query` with the fragment you want to locate.",
        400
      );
    }

    const scope = isPlainObject(input.scope) ? input.scope : undefined;
    const normalizedScope = scope
      ? {
        files: typeof scope.files === "boolean" ? scope.files : undefined,
        content: typeof scope.content === "boolean" ? scope.content : undefined,
        postmeta: typeof scope.postmeta === "boolean" ? scope.postmeta : undefined,
        options: typeof scope.options === "boolean" ? scope.options : undefined,
        menus: typeof scope.menus === "boolean" ? scope.menus : undefined,
        customTables: typeof scope.customTables === "boolean" ? scope.customTables : undefined
      }
      : undefined;

    return services.whereUsed.whereIsUsed({
      query,
      kind: normalizeNonEmptyString(input.kind),
      scope: normalizedScope,
      wpRoot: resolveValidatedWpRoot(input.wpRoot, services),
      limitPerGroup: normalizeLimit(input.limitPerGroup, {
        fallback: 10,
        min: 1,
        max: 50,
        field: "limitPerGroup"
      })
    });
  };
}

export function createApplyPatchToolAdapter(services: ProjectServices): ToolHandler {
  return (input) =>
    invokeEndpoint(
      {
        method: "POST",
        path: "/fs/applyPatch",
        mapInput: (rawInput) => {
          const wpRoot = resolveValidatedWpRoot(rawInput.wpRoot, services);
          return {
            patch: validatePatchPreflight(rawInput.patch, wpRoot),
            wpRoot
          };
        }
      },
      input
    );
}

export function createReadProjectFileToolAdapter(services: ProjectServices): ToolHandler {
  return (input) =>
    invokeEndpoint(
      {
        method: "GET",
        path: "/fs/read",
        mapInput: (rawInput) => {
          const wpRoot = resolveValidatedWpRoot(rawInput.wpRoot, services);
          return {
            path: normalizeSafeProjectPath(rawInput.path, "path", wpRoot, "INVALID_FS_READ_INPUT"),
            wpRoot,
            maxBytes: normalizeLimit(rawInput.maxBytes, {
              fallback: 1024 * 1024,
              min: 1,
              max: 5 * 1024 * 1024,
              field: "maxBytes"
            })
          };
        }
      },
      input
    );
}

export function createSearchProjectFilesToolAdapter(services: ProjectServices): ToolHandler {
  return (input) =>
    invokeEndpoint(
      {
        method: "POST",
        path: "/fs/search",
        mapInput: (rawInput) => {
          const wpRoot = resolveValidatedWpRoot(rawInput.wpRoot, services);
          const query = normalizeNonEmptyString(rawInput.query);
          if (!query) {
            throw new AppError("INVALID_SEARCH_INPUT", "Invalid `query`. Provide a non-empty string.", 400);
          }

          const searchPathRaw =
            normalizeNonEmptyString(rawInput.path) ?? normalizeNonEmptyString(rawInput.scope);
          return {
            query,
            wpRoot,
            path: searchPathRaw
              ? normalizeSafeProjectPath(searchPathRaw, "path", wpRoot, "INVALID_SEARCH_INPUT")
              : undefined,
            glob: normalizeNonEmptyString(rawInput.glob),
            isRegex: typeof rawInput.isRegex === "boolean" ? rawInput.isRegex : undefined,
            limit: normalizeLimit(rawInput.limit, {
              fallback: 50,
              min: 1,
              max: 200,
              field: "limit"
            })
          };
        }
      },
      input
    );
}

export function createQueryWpDbReadonlyToolAdapter(services: ProjectServices): ToolHandler {
  return (input) =>
    services.wpDbRead.queryReadonlySelect({
      sql: input.sql,
      wpRoot: typeof input.wpRoot === "string" ? input.wpRoot : undefined,
      tablePrefix: typeof input.tablePrefix === "string" ? input.tablePrefix : undefined,
      maxRows: typeof input.maxRows === "number" ? input.maxRows : undefined,
      siteUrl: typeof input.siteUrl === "string" ? input.siteUrl : undefined,
      blogId: (typeof input.blogId === "number" || typeof input.blogId === "string")
        ? input.blogId
        : undefined
    });
}
