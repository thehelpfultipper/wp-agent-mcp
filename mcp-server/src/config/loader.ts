import { internalDefaultsResolution, internalDefaults } from "./runtime";
import { parsePort, resolvePhpBin, resolveWpCli, validateWpRoot } from "./validation";
import { type InternalDefaults } from "./defaults";

export type ResolvedAppConfig = {
  mcpPort: number;
  wpRoot: string;
  wpCli: string;
  phpBin: string;
  internalDefaults: InternalDefaults;
};

function warnIfUsingDeprecatedConfigSections(): void {
  if (internalDefaultsResolution.deprecatedSections.length === 0) {
    return;
  }

  const source = internalDefaultsResolution.legacyConfigPath ?? "<unknown>";
  const sections = internalDefaultsResolution.deprecatedSections.join(", ");
  console.warn(
    `[deprecated-config] Loaded legacy advanced config from ${source}. Deprecated sections (${sections}) are still honored for compatibility, but should be removed from user-facing config.`
  );
}

export function loadResolvedConfig(env: NodeJS.ProcessEnv = process.env): ResolvedAppConfig {
  warnIfUsingDeprecatedConfigSections();

  return {
    mcpPort: parsePort(env.MCP_PORT),
    wpRoot: validateWpRoot(env.WP_ROOT),
    wpCli: resolveWpCli(env.WP_CLI, env.PATH),
    phpBin: resolvePhpBin(env.PHP_BIN, env.PATH),
    internalDefaults
  };
}
