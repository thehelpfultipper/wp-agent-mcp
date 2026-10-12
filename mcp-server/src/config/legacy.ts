import fs from "node:fs";
import path from "node:path";
import { INTERNAL_DEFAULTS, type InternalDefaults } from "./defaults";

type LegacyAdvancedConfigLoadResult = {
  overrides: Partial<InternalDefaults>;
  configPath?: string;
  deprecatedSections: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return normalized.length > 0 ? normalized : [];
}

function asStringPairArray(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const pairs: string[][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const pair = entry
      .map((item) => asString(item))
      .filter((item): item is string => Boolean(item));
    if (pair.length > 0) {
      pairs.push(pair);
    }
  }
  return pairs;
}

function readLegacyConfig(cwd: string): { parsed: Record<string, unknown>; configPath: string } | null {
  const configuredPath = asString(process.env.WP_AGENT_CONFIG);
  const candidates = configuredPath
    ? [path.resolve(configuredPath)]
    : [path.resolve(cwd, "wp-agent.config.json"), path.resolve(cwd, ".wp-agent.json")];

  for (const candidatePath of candidates) {
    if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
      continue;
    }
    try {
      const raw = fs.readFileSync(candidatePath, "utf8");
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        return { parsed, configPath: candidatePath };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function mergeInternalDefaults(
  base: InternalDefaults,
  overrides: Partial<InternalDefaults>
): InternalDefaults {
  return {
    index: {
      ...base.index,
      ...overrides.index,
      debugExportFiles: {
        ...base.index.debugExportFiles,
        ...overrides.index?.debugExportFiles
      }
    },
    patch: {
      ...base.patch,
      ...overrides.patch
    },
    helperPlugin: {
      ...base.helperPlugin,
      ...overrides.helperPlugin
    },
    security: {
      ...base.security,
      ...overrides.security
    },
    logging: {
      ...base.logging,
      ...overrides.logging
    },
    git: {
      ...base.git,
      ...overrides.git
    }
  };
}

export function loadLegacyAdvancedConfig(cwd = process.cwd()): LegacyAdvancedConfigLoadResult {
  const loaded = readLegacyConfig(cwd);
  if (!loaded) {
    return { overrides: {}, deprecatedSections: [] };
  }

  const sourceRoot = isPlainObject(loaded.parsed.defaults) ? loaded.parsed.defaults : loaded.parsed;
  const deprecatedSections: string[] = [];
  const overrides: Partial<InternalDefaults> = {};

  const indexSource = isPlainObject(sourceRoot.index) ? sourceRoot.index : null;
  if (indexSource) {
    deprecatedSections.push("index");
    overrides.index = {
      indexDirName: asString(indexSource.indexDirName) ?? INTERNAL_DEFAULTS.index.indexDirName,
      indexDbFilename: asString(indexSource.indexDbFilename) ?? INTERNAL_DEFAULTS.index.indexDbFilename,
      defaultContentLimit:
        asPositiveInteger(indexSource.defaultContentLimit) ?? INTERNAL_DEFAULTS.index.defaultContentLimit,
      maxContentLimit: asPositiveInteger(indexSource.maxContentLimit) ?? INTERNAL_DEFAULTS.index.maxContentLimit,
      debugExportFiles: {
        blocks:
          asString((indexSource.debugExportFiles as Record<string, unknown> | undefined)?.blocks)
          ?? INTERNAL_DEFAULTS.index.debugExportFiles.blocks,
        patterns:
          asString((indexSource.debugExportFiles as Record<string, unknown> | undefined)?.patterns)
          ?? INTERNAL_DEFAULTS.index.debugExportFiles.patterns,
        templates:
          asString((indexSource.debugExportFiles as Record<string, unknown> | undefined)?.templates)
          ?? INTERNAL_DEFAULTS.index.debugExportFiles.templates
      }
    };
  }

  const patchSource = isPlainObject(sourceRoot.patch) ? sourceRoot.patch : null;
  if (patchSource) {
    deprecatedSections.push("patch");
    overrides.patch = {
      tempFilePrefix: asString(patchSource.tempFilePrefix) ?? INTERNAL_DEFAULTS.patch.tempFilePrefix,
      backupFilePrefix: asString(patchSource.backupFilePrefix) ?? INTERNAL_DEFAULTS.patch.backupFilePrefix,
      phpLintEnabled: asBoolean(patchSource.phpLintEnabled) ?? INTERNAL_DEFAULTS.patch.phpLintEnabled,
      protectedPaths: asStringArray(patchSource.protectedPaths) ?? INTERNAL_DEFAULTS.patch.protectedPaths
    };
  }

  const helperSource = isPlainObject(sourceRoot.helperPlugin)
    ? sourceRoot.helperPlugin
    : (isPlainObject(sourceRoot.helper) ? sourceRoot.helper : null);
  if (helperSource) {
    deprecatedSections.push("helperPlugin");
    overrides.helperPlugin = {
      enabled: asBoolean(helperSource.enabled) ?? INTERNAL_DEFAULTS.helperPlugin.enabled,
      directHelperFiles:
        asStringArray(helperSource.directHelperFiles) ?? INTERNAL_DEFAULTS.helperPlugin.directHelperFiles,
      helperDirectories:
        asStringArray(helperSource.helperDirectories) ?? INTERNAL_DEFAULTS.helperPlugin.helperDirectories,
      helperPhpMaxFiles:
        asPositiveInteger(helperSource.helperPhpMaxFiles) ?? INTERNAL_DEFAULTS.helperPlugin.helperPhpMaxFiles
    };
  }

  const securitySource = isPlainObject(sourceRoot.security) ? sourceRoot.security : null;
  if (securitySource) {
    deprecatedSections.push("security");
    overrides.security = {
      wpCliAllowlist: asStringPairArray(securitySource.wpCliAllowlist) ?? INTERNAL_DEFAULTS.security.wpCliAllowlist,
      wpCliBlocklistTokens:
        asStringArray(securitySource.wpCliBlocklistTokens) ?? INTERNAL_DEFAULTS.security.wpCliBlocklistTokens
    };
  }

  const loggingSource = isPlainObject(sourceRoot.logging) ? sourceRoot.logging : null;
  if (loggingSource) {
    deprecatedSections.push("logging");
    const level = asString(loggingSource.level);
    overrides.logging = {
      level:
        level === "debug" || level === "info" || level === "warn" || level === "error"
          ? level
          : INTERNAL_DEFAULTS.logging.level,
      redactSecrets: asBoolean(loggingSource.redactSecrets) ?? INTERNAL_DEFAULTS.logging.redactSecrets
    };
  }

  const gitSource = isPlainObject(sourceRoot.git) ? sourceRoot.git : null;
  if (gitSource) {
    deprecatedSections.push("git");
    overrides.git = {
      defaultBranch: asString(gitSource.defaultBranch) ?? INTERNAL_DEFAULTS.git.defaultBranch,
      autoCommit: asBoolean(gitSource.autoCommit) ?? INTERNAL_DEFAULTS.git.autoCommit
    };
  }

  return {
    overrides,
    configPath: loaded.configPath,
    deprecatedSections: Array.from(new Set(deprecatedSections))
  };
}
