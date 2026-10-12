import type { ServiceRuntimeDeps } from "./types";
import { createProjectServices } from "./index";
import type { ConnectWordpressInput, ConnectWordpressResult } from "./wordpressService";

export type ProjectServiceDeps = ServiceRuntimeDeps;

export type { ConnectWordpressInput, ConnectWordpressResult };

export function connectWordpress(
  input: ConnectWordpressInput,
  deps: ProjectServiceDeps
): ConnectWordpressResult {
  const services = createProjectServices(deps);
  return services.wordpress.connectWordpress(input);
}
