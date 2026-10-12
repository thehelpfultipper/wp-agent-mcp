import { AppError } from "../errors";
import { resolveWpRoot, wpRootLooksValid } from "../sandbox";

export type ConfigService = {
  resolveValidWpRoot: (wpRoot?: string) => string;
  getConfiguredWpRoot: () => string;
};

export function createConfigService(configuredWpRoot: string): ConfigService {
  const resolveValidWpRoot = (wpRootInput?: string): string => {
    const wpRoot = resolveWpRoot(wpRootInput ?? configuredWpRoot, configuredWpRoot);
    if (!wpRootLooksValid(wpRoot)) {
      throw new AppError(
        "WP_ROOT_INVALID",
        "Invalid WP root. Expected `wp-includes` in wpRoot or `wp-config.php` in wpRoot (or its parent).",
        400,
        { wpRoot }
      );
    }
    return wpRoot;
  };

  return {
    resolveValidWpRoot,
    getConfiguredWpRoot: () => configuredWpRoot
  };
}

