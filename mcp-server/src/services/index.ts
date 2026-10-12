import { createConfigService, type ConfigService } from "./configService";
import { createIndexService, type IndexService } from "./indexService";
import { createAuditService, type AuditService } from "./auditService";
import { createPatchServiceNotImplemented, type PatchService } from "./patchService";
import { createSimilarityService, type SimilarityService } from "./similarityService";
import { createLocalDbSyncService, type LocalDbSyncService } from "./localDbSyncService";
import { createWhereIsUsedService, type WhereIsUsedService } from "./whereUsedService";
import { createWordpressService, type WordpressService } from "./wordpressService";
import { createWpDbReadService, type WpDbReadService } from "./wpDbReadService";
import { createThemeProfileService, type ThemeProfileService } from "./themeProfileService";
import { createDesignBridgeService, type DesignBridgeService } from "./designBridgeService";
import { createDesignBridgeReadinessService, type DesignBridgeReadinessService } from "./designBridgeReadinessService";
import type { ServiceRuntimeDeps } from "./types";

export type ProjectServices = {
  config: ConfigService;
  wordpress: WordpressService;
  index: IndexService;
  audit: AuditService;
  similarity: SimilarityService;
  localDbSync: LocalDbSyncService;
  whereUsed: WhereIsUsedService;
  wpDbRead: WpDbReadService;
  patch: PatchService;
  theme: ThemeProfileService;
  designBridge: DesignBridgeService;
  designBridgeReadiness: DesignBridgeReadinessService;
};

export function createProjectServices(deps: ServiceRuntimeDeps): ProjectServices {
  const config = createConfigService(deps.configuredWpRoot);

  const theme = createThemeProfileService({
    wpCli: deps.wpCli,
    config
  });

  const audit = createAuditService({
    configuredWpRoot: deps.configuredWpRoot,
    wpCli: deps.wpCli
  });

  return {
    config,
    wordpress: createWordpressService({
      wpCli: deps.wpCli,
      config
    }),
    index: createIndexService(config, deps.wpCli),
    audit,
    similarity: createSimilarityService({
      configuredWpRoot: deps.configuredWpRoot,
      wpCli: deps.wpCli
    }),
    localDbSync: createLocalDbSyncService({
      wpCli: deps.wpCli,
      config
    }),
    whereUsed: createWhereIsUsedService({
      configuredWpRoot: deps.configuredWpRoot,
      wpCli: deps.wpCli
    }),
    wpDbRead: createWpDbReadService({
      wpCli: deps.wpCli,
      config
    }),
    patch: createPatchServiceNotImplemented(),
    theme,
    designBridge: createDesignBridgeService({
      config,
      theme,
      audit
    }),
    designBridgeReadiness: createDesignBridgeReadinessService({
      config,
      theme
    })
  };
}
