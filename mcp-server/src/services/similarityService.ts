import { executeSearchSimilarLogic } from "../routes/project";

export type SimilarityInput = {
  wpRoot?: string;
  query?: unknown;
  componentName?: unknown;
  className?: unknown;
  classNames?: unknown;
  blockNames?: unknown;
  snippet?: unknown;
  limit?: unknown;
};

export type SimilarityService = {
  findSimilar: (input: SimilarityInput) => Record<string, unknown>;
};

type SimilarityServiceDeps = {
  configuredWpRoot: string;
  wpCli: string;
};

export function createSimilarityService(deps: SimilarityServiceDeps): SimilarityService {
  return {
    findSimilar: (input) => {
      return executeSearchSimilarLogic(input, {
        configuredWpRoot: deps.configuredWpRoot,
        wpCli: deps.wpCli
      });
    }
  };
}

