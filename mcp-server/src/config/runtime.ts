import { INTERNAL_DEFAULTS, type InternalDefaults } from "./defaults";
import { loadLegacyAdvancedConfig, mergeInternalDefaults } from "./legacy";

type InternalDefaultsResolution = {
  defaults: InternalDefaults;
  legacyConfigPath?: string;
  deprecatedSections: string[];
};

function resolveInternalDefaults(): InternalDefaultsResolution {
  const legacy = loadLegacyAdvancedConfig();
  return {
    defaults: mergeInternalDefaults(INTERNAL_DEFAULTS, legacy.overrides),
    legacyConfigPath: legacy.configPath,
    deprecatedSections: legacy.deprecatedSections
  };
}

export const internalDefaultsResolution = resolveInternalDefaults();
export const internalDefaults = internalDefaultsResolution.defaults;
