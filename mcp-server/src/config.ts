import { loadResolvedConfig, type ResolvedAppConfig } from "./config/loader";

export type AppConfig = ResolvedAppConfig;

export { loadResolvedConfig };
export { internalDefaults } from "./config/runtime";
export { ConfigValidationError } from "./config/validation";
