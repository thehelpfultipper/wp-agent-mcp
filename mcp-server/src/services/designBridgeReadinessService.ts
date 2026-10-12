import { wpRootLooksValid } from "../sandbox";
import { initializeIndexAndGetStatus } from "../indexStore";
import type { ConfigService } from "./configService";
import type { ThemeProfileService } from "./themeProfileService";

export type DesignBridgeReadinessInput = {
  wpRoot?: string;
  themeSlug?: string;
};

export type DesignBridgeReadinessResult = {
  wpRoot: {
    configured: boolean;
    valid: boolean;
    path?: string;
  };
  index: {
    ready: boolean;
    schemaVersion?: number;
    lastBuildAt?: string | null;
  };
  theme: {
    resolvable: boolean;
    activeTheme?: string;
    themeSlugProvided?: boolean;
  };
  companionMcps: {
    figma: {
      detectableByWpAgent: false;
      requiredFor: string[];
      notRequiredFor: string[];
      setupHint: string;
      agentCheck: string;
    };
    playwright: {
      detectableByWpAgent: false;
      requiredFor: string[];
      optional: true;
      setupHint: string;
    };
  };
  readyForBridge: boolean;
  blockers: Array<{ code: string; message: string; remediation: string }>;
  assistantMessage?: string;
};

export type DesignBridgeReadinessServiceDeps = {
  config: ConfigService;
  theme: ThemeProfileService;
};

export function createDesignBridgeReadinessService(deps: DesignBridgeReadinessServiceDeps) {
  function getDesignBridgeReadiness(input: DesignBridgeReadinessInput): DesignBridgeReadinessResult {
    const configuredRoot = deps.config.getConfiguredWpRoot();
    const requestedRoot = typeof input.wpRoot === "string" && input.wpRoot.trim().length > 0
      ? input.wpRoot.trim()
      : configuredRoot;
    const wpRootConfigured = Boolean(requestedRoot && requestedRoot.trim().length > 0);
    const wpRootValid = wpRootConfigured && wpRootLooksValid(requestedRoot);

    const blockers: DesignBridgeReadinessResult["blockers"] = [];
    let indexReady = false;
    let indexSchemaVersion: number | undefined;
    let indexLastBuildAt: string | null | undefined;

    if (!wpRootConfigured) {
      blockers.push({
        code: "WP_ROOT_NOT_CONFIGURED",
        message: "WordPress root is not configured.",
        remediation: "Set WP_ROOT in the MCP server env or pass wpRoot after connecting to a local WordPress project."
      });
    } else if (!wpRootValid) {
      blockers.push({
        code: "WP_ROOT_INVALID",
        message: "Configured WordPress root does not look valid.",
        remediation: "Point WP_ROOT at a directory containing wp-config.php or wp-includes."
      });
    } else {
      const status = initializeIndexAndGetStatus(requestedRoot);
      indexSchemaVersion = status.schemaVersion;
      indexLastBuildAt = status.lastBuildAt;
      indexReady = typeof status.lastBuildAt === "string" && status.lastBuildAt.trim().length > 0;
      if (!indexReady) {
        blockers.push({
          code: "INDEX_NOT_READY",
          message: "The local WordPress index has not been built yet.",
          remediation: "Ask to build the index for this project before running a design bridge."
        });
      }
    }

    let themeResolvable = false;
    let activeTheme: string | undefined;
    const themeSlugProvided = typeof input.themeSlug === "string" && input.themeSlug.trim().length > 0;

    if (wpRootValid) {
      try {
        const profile = deps.theme.getThemeProfile({
          wpRoot: requestedRoot,
          themeSlug: input.themeSlug
        });
        themeResolvable = true;
        activeTheme = profile.activeTheme.name;
      } catch {
        blockers.push({
          code: "THEME_PROFILE_UNAVAILABLE",
          message: "Unable to resolve the active or requested theme profile.",
          remediation: "Verify wp-cli can run against the project and the theme exists."
        });
      }
    }

    const readyForBridge = blockers.length === 0;
    const workflowSteps = [
      "1) Capture design (Figma get_design_context or screenshot).",
      "2) Structure visualIntent with layout roles and component labels (include block slugs like namespace/block-name).",
      "3) Call bridge_design_to_implementation (figmaCapture passthrough is supported).",
      "4) Implement from implementationSpec; do not paste raw Figma values into theme files.",
      "5) Verify with Playwright MCP or manual checks."
    ].join(" ");
    const assistantMessage = readyForBridge
      ? `WordPress project is ready for design bridge reconciliation. ${workflowSteps} If you share a Figma link, ensure Figma MCP is enabled in Cursor; agent should verify via GetDynamicTools pattern figma. Screenshots work without Figma MCP.`
      : blockers.map((blocker) => blocker.message).join(" ");

    return {
      wpRoot: {
        configured: wpRootConfigured,
        valid: wpRootValid,
        path: wpRootValid ? requestedRoot : undefined
      },
      index: {
        ready: indexReady,
        schemaVersion: indexSchemaVersion,
        lastBuildAt: indexLastBuildAt
      },
      theme: {
        resolvable: themeResolvable,
        activeTheme,
        themeSlugProvided
      },
      companionMcps: {
        figma: {
          detectableByWpAgent: false,
          requiredFor: ["figma-url", "figma-node-selection"],
          notRequiredFor: ["screenshot", "manual-description"],
          setupHint: "Enable the Figma MCP server in Cursor Settings → MCP. Screenshot or mock inputs do not require Figma MCP.",
          agentCheck: "Agent should verify Figma MCP availability via GetDynamicTools before calling Figma capture tools."
        },
        playwright: {
          detectableByWpAgent: false,
          requiredFor: ["automated-verification"],
          optional: true,
          setupHint: "Enable Playwright MCP for automated post-implementation checks. Manual verification is available from implementationSpec.verificationChecks."
        }
      },
      readyForBridge,
      blockers,
      assistantMessage
    };
  }

  return {
    getDesignBridgeReadiness
  };
}

export type DesignBridgeReadinessService = ReturnType<typeof createDesignBridgeReadinessService>;
