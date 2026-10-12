import type { ProjectServices } from "../../services";
import type { ToolHandler, ToolInvokeInput } from "../registry";

export function createBuildWpIndexToolAdapter(services: ProjectServices): ToolHandler {
  return (input: ToolInvokeInput) => {
    const wpRoot = typeof input.wpRoot === "string" ? input.wpRoot : undefined;
    const limit = typeof input.limit === "number" ? input.limit : undefined;
    const mode =
      input.mode === "full" || input.mode === "filesystem-only" || input.mode === "content-only"
        ? input.mode
        : undefined;

    return services.index.buildIndex({
      wpRoot,
      limit,
      mode
    });
  };
}

export function createGetIndexStatusToolAdapter(services: ProjectServices): ToolHandler {
  return (input: ToolInvokeInput) => {
    const wpRoot = typeof input.wpRoot === "string" ? input.wpRoot : undefined;
    return services.index.getIndexStatus({ wpRoot });
  };
}

