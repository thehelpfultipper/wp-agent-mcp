import type { ProjectServices } from "../../services";
import { formatWordpressConnectResponse } from "../../services/wordpressService";
import type { ToolHandler, ToolInvokeInput } from "../registry";

export function createConnectWordpressToolAdapter(services: ProjectServices): ToolHandler {
  return (input: ToolInvokeInput) => {
    const wpRoot = typeof input.wpRoot === "string" ? input.wpRoot : undefined;
    return formatWordpressConnectResponse(services.wordpress.connectWordpress({ wpRoot }));
  };
}

