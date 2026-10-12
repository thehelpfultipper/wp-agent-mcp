import { executeWhereIsUsedLogic } from "../routes/project";

export type WhereIsUsedInput = {
  wpRoot?: string;
  query?: unknown;
  kind?: unknown;
  scope?: unknown;
  limitPerGroup?: unknown;
};

export type WhereIsUsedService = {
  whereIsUsed: (input: WhereIsUsedInput) => Record<string, unknown>;
};

type WhereIsUsedServiceDeps = {
  configuredWpRoot: string;
  wpCli: string;
};

export function createWhereIsUsedService(deps: WhereIsUsedServiceDeps): WhereIsUsedService {
  return {
    whereIsUsed: (input) => {
      return executeWhereIsUsedLogic(input, {
        configuredWpRoot: deps.configuredWpRoot,
        wpCli: deps.wpCli
      });
    }
  };
}
