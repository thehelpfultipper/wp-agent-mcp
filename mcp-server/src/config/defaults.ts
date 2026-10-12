export type IndexDefaults = {
  indexDirName: string;
  indexDbFilename: string;
  defaultContentLimit: number;
  maxContentLimit: number;
  debugExportFiles: {
    blocks: string;
    patterns: string;
    templates: string;
  };
};

export type PatchDefaults = {
  tempFilePrefix: string;
  backupFilePrefix: string;
  phpLintEnabled: boolean;
  protectedPaths: string[];
};

export type HelperPluginDefaults = {
  enabled: boolean;
  directHelperFiles: string[];
  helperDirectories: string[];
  helperPhpMaxFiles: number;
};

export type SecurityDefaults = {
  wpCliAllowlist: string[][];
  wpCliBlocklistTokens: string[];
};

export type LoggingDefaults = {
  level: "debug" | "info" | "warn" | "error";
  redactSecrets: boolean;
};

export type GitDefaults = {
  defaultBranch: string;
  autoCommit: boolean;
};

export type InternalDefaults = {
  index: IndexDefaults;
  patch: PatchDefaults;
  helperPlugin: HelperPluginDefaults;
  security: SecurityDefaults;
  logging: LoggingDefaults;
  git: GitDefaults;
};

export const INTERNAL_DEFAULTS: InternalDefaults = {
  index: {
    indexDirName: ".cursor-wp-index",
    indexDbFilename: "index.sqlite",
    defaultContentLimit: 1000,
    maxContentLimit: 5000,
    debugExportFiles: {
      blocks: "blocks.json",
      patterns: "patterns.json",
      templates: "templates.json"
    }
  },
  patch: {
    tempFilePrefix: ".wp-agent-patch-",
    backupFilePrefix: ".wp-agent-backup-",
    phpLintEnabled: true,
    protectedPaths: ["wp-config.php"]
  },
  helperPlugin: {
    enabled: true,
    directHelperFiles: ["template-tags.php", "helpers.php"],
    helperDirectories: ["inc", "includes"],
    helperPhpMaxFiles: 300
  },
  security: {
    // Empty allowlist means all wp-cli subcommands are permitted (default for local dev).
    // When tightening this for production, include at minimum the following prefixes so
    // the built-in tools continue to function:
    //   ["--info"]                     — connect_wordpress health probe
    //   ["core", "version"]            — connect_wordpress WP version
    //   ["eval"]                       — connect_wordpress / theme-profile / query_wp_db_readonly fallback
    //   ["db", "query"]                — query_wp_db_readonly primary path
    //   ["post", "list"]               — build_wp_index content scan
    //   ["post", "meta", "get"]        — build_wp_index postmeta scan
    // A misconfigured allowlist surfaces as WPCLI_FAILED with code "not in the allowlist".
    wpCliAllowlist: [],
    wpCliBlocklistTokens: []
  },
  logging: {
    level: "info",
    redactSecrets: true
  },
  git: {
    defaultBranch: "master",
    autoCommit: false
  }
};
