import { AppError } from "../errors";
import { buildIndexFromFilesystem, initializeIndexAndGetStatus } from "../indexStore";
import type { ConfigService } from "./configService";

export type BuildIndexMode = "full" | "filesystem-only" | "content-only";

export type BuildIndexInput = {
  wpRoot?: string;
  limit?: number;
  mode?: BuildIndexMode;
};

export type IndexService = {
  getIndexStatus: (input: { wpRoot?: string }) => ReturnType<typeof initializeIndexAndGetStatus>;
  buildIndex: (input: BuildIndexInput) => ReturnType<typeof buildIndexFromFilesystem>;
};

export function createIndexService(config: ConfigService, wpCli: string): IndexService {
  const getIndexStatus: IndexService["getIndexStatus"] = (input) => {
    const wpRoot = config.resolveValidWpRoot(input.wpRoot);
    return initializeIndexAndGetStatus(wpRoot);
  };

  const buildIndex: IndexService["buildIndex"] = (input) => {
    const wpRoot = config.resolveValidWpRoot(input.wpRoot);
    const requestedLimit = input.limit;
    const requestedMode = input.mode ?? "full";

    if (requestedLimit !== undefined) {
      const isValidLimit =
        typeof requestedLimit === "number"
        && Number.isFinite(requestedLimit)
        && Number.isInteger(requestedLimit)
        && requestedLimit > 0;
      if (!isValidLimit) {
        throw new AppError(
          "INVALID_INDEX_LIMIT",
          "Invalid `limit`. Provide a positive integer.",
          400,
          { limit: requestedLimit }
        );
      }
    }

    const isValidMode =
      requestedMode === "full"
      || requestedMode === "filesystem-only"
      || requestedMode === "content-only";
    if (!isValidMode) {
      throw new AppError(
        "INVALID_INDEX_MODE",
        "Invalid `mode`. Use one of: `full`, `filesystem-only`, `content-only`.",
        400,
        { mode: requestedMode }
      );
    }

    return buildIndexFromFilesystem(wpRoot, {
      contentLimit: requestedLimit,
      mode: requestedMode,
      wpCli
    });
  };

  return {
    getIndexStatus,
    buildIndex
  };
}

