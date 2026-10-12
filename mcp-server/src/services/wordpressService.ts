import { AppError } from "../errors";
import { detectWpCliPath, runWpCli } from "../wpCli";
import type { ConfigService } from "./configService";

export type ConnectWordpressInput = {
  wpRoot?: string;
};

export type ConnectWordpressResult = {
  wpRoot: string;
  wpCliPath: string;
  phpVersion: string;
  wpVersion: string;
  isMultisite: boolean;
  tablePrefix: string;
};

export type WordpressConnectPublicResponse = {
  health: {
    status: "ok";
    wordpressVersion: string;
    phpVersion: string;
    isMultisite: boolean;
  };
  config: {
    wpRoot: string;
    wpCliPath: string;
    tablePrefix: string;
  };
};

export function formatWordpressConnectResponse(result: ConnectWordpressResult): WordpressConnectPublicResponse {
  return {
    health: {
      status: "ok",
      wordpressVersion: result.wpVersion,
      phpVersion: result.phpVersion,
      isMultisite: result.isMultisite
    },
    config: {
      wpRoot: result.wpRoot,
      wpCliPath: result.wpCliPath,
      tablePrefix: result.tablePrefix
    }
  };
}

export type WordpressService = {
  connectWordpress: (input: ConnectWordpressInput) => ConnectWordpressResult;
};

export type WordpressServiceDeps = {
  wpCli: string;
  config: ConfigService;
};

export function createWordpressService(deps: WordpressServiceDeps): WordpressService {
  const connectWordpress = (input: ConnectWordpressInput): ConnectWordpressResult => {
    const wpRoot = deps.config.resolveValidWpRoot(input.wpRoot);
    const wpCliPath = detectWpCliPath(deps.wpCli);

    // Required probe to validate wp-cli can run against the root.
    runWpCli(wpRoot, ["--info"], deps.wpCli);

    const wpVersion = runWpCli(wpRoot, ["core", "version"], deps.wpCli);
    const phpVersion = runWpCli(wpRoot, ["eval", "echo PHP_VERSION;"], deps.wpCli);
    const multisiteRaw = runWpCli(wpRoot, ["eval", "echo is_multisite() ? '1' : '0';"], deps.wpCli);
    const tablePrefix = runWpCli(wpRoot, ["eval", "global $wpdb; echo $wpdb->prefix;"], deps.wpCli).trim();

    return {
      wpRoot,
      wpCliPath,
      phpVersion,
      wpVersion,
      isMultisite: multisiteRaw.trim() === "1",
      tablePrefix
    };
  };

  return {
    connectWordpress
  };
}

export type ThemeProfileResult = import("./themeProfileService").ThemeProfileResult;

export type ThemeProfileService = import("./themeProfileService").ThemeProfileService;

export { createThemeProfileService } from "./themeProfileService";

