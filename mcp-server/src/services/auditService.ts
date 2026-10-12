import { executeAuditComponentLogic } from "../routes/project";

export type AuditComponentInput = {
  wpRoot?: string;
  component_query?: unknown;
  componentQuerySpec?: unknown;
  query?: unknown;
  limit?: unknown;
};

export type AuditService = {
  auditComponent: (input: AuditComponentInput) => Record<string, unknown>;
};

type AuditServiceDeps = {
  configuredWpRoot: string;
  wpCli: string;
};

export function createAuditService(deps: AuditServiceDeps): AuditService {
  return {
    auditComponent: (input) => {
      return executeAuditComponentLogic(input, {
        configuredWpRoot: deps.configuredWpRoot,
        wpCli: deps.wpCli
      });
    }
  };
}

