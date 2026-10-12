import type { Response } from "express";

export type ErrorCode =
  | "WP_ROOT_INVALID"
  | "WPCLI_NOT_FOUND"
  | "WPCLI_FAILED"
  | "INVALID_DUMP_FILE"
  | "DUMP_PATH_NOT_ALLOWED"
  | "DB_BACKUP_FAILED"
  | "DB_IMPORT_FAILED"
  | "DB_URL_REPLACE_FAILED"
  | "MULTISITE_UPDATE_FAILED"
  | "MYSQL_CLIENT_NOT_FOUND"
  | "SYNC_PREFLIGHT_FAILED"
  | "DB_UNREACHABLE"
  | "DB_SYNC_REQUIRES_ELEVATED_CONTEXT"
  | "DB_SYNC_ASSERTION_FAILED"
  | "IMPORT_METHOD_FAILED"
  | "INDEX_NOT_READY"
  | "TOOL_NOT_FOUND"
  | "TOOL_INPUT_INVALID"
  | "INVALID_INDEX_LIMIT"
  | "INVALID_INDEX_MODE"
  | "INVALID_SEARCH_INPUT"
  | "INVALID_FS_READ_INPUT"
  | "FS_READ_NOT_FOUND"
  | "FS_SEARCH_PATH_NOT_FOUND"
  | "INVALID_AUDIT_QUERY"
  | "BRIDGE_INTENT_TOO_RAW"
  | "INVALID_READONLY_SQL"
  | "INVALID_PATCH_FORMAT"
  | "PATCH_PATH_OUTSIDE_ROOT"
  | "PATCH_APPLY_FAILED"
  | "PHP_LINT_FAILED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function sendError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const errorPayload: {
      code: ErrorCode;
      message: string;
      details?: unknown;
    } = {
      code: err.code,
      message: err.message
    };
    if (err.details !== undefined) {
      errorPayload.details = err.details;
    }

    res.status(err.status).json({
      ok: false,
      error: errorPayload
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Unexpected server error";
  res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message
    }
  });
}
