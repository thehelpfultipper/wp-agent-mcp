import { AppError } from "../errors";
import { initializeIndexAndGetStatus } from "../indexStore";
import type { AuditService } from "./auditService";
import type { ConfigService } from "./configService";
import type { ThemeProfileService, ThemeCandidate, ThemeResolution } from "./themeProfileService";
import { buildComponentQuerySpec } from "./designBridge/componentQueryBuilder";
import {
  discoverBlockSlugsFromIndex,
  mergeDiscoveredBlockSlugs
} from "./designBridge/blockSlugDiscovery";
import { reconcileAllTokens } from "./designBridge/tokenMatcher";
import {
  collectRawValuesToAvoid,
  resolveBridgeVisualIntent,
  summarizeVisualIntent,
  type VisualIntent
} from "./designBridge/visualIntentSchema";
import { buildVerificationChecks } from "./designBridge/verificationChecks";

export type BridgeDesignInput = {
  wpRoot?: string;
  visualIntent?: unknown;
  figmaCapture?: unknown;
  themeSlug?: string;
  themePath?: string;
  siteUrl?: string;
  blogId?: number;
  componentHint?: string;
  targetSurface?: "block" | "pattern" | "template-part" | "page-section";
};

export type ImplementationSpec = {
  queryEcho: {
    visualIntentSummary: string;
    themeResolution: ThemeResolution | { mode: "pending_selection" };
    targetSurface?: string;
  };
  interpretedIntent: {
    hierarchy: string[];
    componentRoles: string[];
    responsiveBehavior: string;
  };
  themeContext: Record<string, unknown>;
  tokenReconciliation: ReturnType<typeof reconcileAllTokens>;
  componentPlan: {
    audit: Record<string, unknown>;
    suggestedStructure: {
      approach: "reuse" | "extend" | "create";
      blockSequence?: string[];
      patternSlug?: string;
      templatePart?: string;
      classNaming?: string[];
    };
    variantMechanism: { id: string; reason: string };
    filesToInspect: string[];
  };
  implementationGuidance: {
    useTokens: string[];
    avoidRawValues: string[];
    markupConventions: string[];
    scssConventions: string[];
    phpConventions: string[];
    responsiveRules: string[];
  };
  verificationChecks: ReturnType<typeof buildVerificationChecks>;
  openQuestions: string[];
  requiresThemeSelection?: boolean;
  themeCandidates?: ThemeCandidate[];
};

function requireReadyIndex(wpRoot: string): void {
  const status = initializeIndexAndGetStatus(wpRoot);
  const hasExistingBuild = typeof status.lastBuildAt === "string" && status.lastBuildAt.trim().length > 0;
  if (hasExistingBuild) {
    return;
  }
  throw new AppError(
    "INDEX_NOT_READY",
    "Index is not built yet. Run `build_wp_index` before using this tool.",
    409,
    {
      nextStep: {
        tool: "build_wp_index",
        input: { mode: "full" }
      },
      indexStatus: status
    }
  );
}

function buildInterpretedIntent(intent: VisualIntent): ImplementationSpec["interpretedIntent"] {
  const hierarchy = [
    intent.layout.structure,
    ...intent.layout.regions.map((region) => `${region.role}${region.notes ? `: ${region.notes}` : ""}`)
  ].filter(Boolean);

  const componentRoles = (intent.components ?? []).map((component) => {
    return component.kind ? `${component.kind}:${component.label}` : component.label;
  });

  const responsiveParts = [
    intent.responsive?.mobile ? `mobile: ${intent.responsive.mobile}` : "",
    intent.responsive?.tablet ? `tablet: ${intent.responsive.tablet}` : "",
    intent.responsive?.desktop ? `desktop: ${intent.responsive.desktop}` : ""
  ].filter(Boolean);

  return {
    hierarchy,
    componentRoles,
    responsiveBehavior: responsiveParts.join(" | ") || "Use theme breakpoints and block layout conventions."
  };
}

function buildImplementationGuidance(input: {
  intent: VisualIntent;
  tokenReconciliation: ReturnType<typeof reconcileAllTokens>;
  themeContext: Record<string, unknown>;
}): ImplementationSpec["implementationGuidance"] {
  const conventions = input.themeContext.conventions as {
    naming?: { dominantFileCase?: string; phpFunctionPrefixes?: string[] };
    cssVarPrefixes?: string[];
    directories?: string[];
  } | undefined;

  const useTokens = [
    ...input.tokenReconciliation.colors.map((token) => token.cssVar),
    ...input.tokenReconciliation.typography.map((token) => token.cssVar),
    ...input.tokenReconciliation.spacing.map((token) => token.cssVar)
  ];
  const scssSpacingSuggestions = input.tokenReconciliation.spacing
    .map((token) => token.scssSuggestion)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const dominantCase = conventions?.naming?.dominantFileCase ?? "kebab-case";
  const phpPrefixes = conventions?.naming?.phpFunctionPrefixes ?? [];
  const cssPrefixes = conventions?.cssVarPrefixes ?? [];

  return {
    useTokens: Array.from(new Set(useTokens)),
    avoidRawValues: collectRawValuesToAvoid(input.intent),
    markupConventions: [
      "Prefer block markup and existing patterns before bespoke HTML.",
      `Follow ${dominantCase} file naming for new assets.`
    ],
    scssConventions: [
      "Use theme preset CSS variables instead of literal color/spacing values.",
      cssPrefixes.length > 0 ? `Observed CSS var prefixes: ${cssPrefixes.join(", ")}` : "Align custom properties with theme.json presets.",
      ...scssSpacingSuggestions
    ],
    phpConventions: phpPrefixes.length > 0
      ? [`Use existing helper prefixes where applicable: ${phpPrefixes.join(", ")}`]
      : ["Reuse theme helper functions before adding new PHP utilities."],
    responsiveRules: [
      input.intent.responsive?.mobile ? `Mobile: ${input.intent.responsive.mobile}` : "Mobile: stack sections using theme spacing presets.",
      input.intent.responsive?.tablet ? `Tablet: ${input.intent.responsive.tablet}` : "Tablet: reduce gutters using spacing presets.",
      input.intent.responsive?.desktop ? `Desktop: ${input.intent.responsive.desktop}` : "Desktop: honor layout.structure proportions with theme layout blocks."
    ]
  };
}

export type DesignBridgeServiceDeps = {
  config: ConfigService;
  theme: ThemeProfileService;
  audit: AuditService;
};

export function createDesignBridgeService(deps: DesignBridgeServiceDeps) {
  function bridgeDesignToImplementation(input: BridgeDesignInput): ImplementationSpec {
    const wpRoot = deps.config.resolveValidWpRoot(input.wpRoot);
    requireReadyIndex(wpRoot);

    const intent = resolveBridgeVisualIntent({
      visualIntent: input.visualIntent,
      figmaCapture: input.figmaCapture
    });
    const themeResolutionResult = deps.theme.resolveThemeForBridge({
      wpRoot,
      themeSlug: input.themeSlug,
      themePath: input.themePath,
      siteUrl: input.siteUrl,
      blogId: input.blogId,
      visualIntent: intent,
      componentHint: input.componentHint
    });

    if (themeResolutionResult.requiresThemeSelection) {
      return {
        queryEcho: {
          visualIntentSummary: summarizeVisualIntent(intent),
          themeResolution: themeResolutionResult.resolution,
          targetSurface: input.targetSurface
        },
        interpretedIntent: buildInterpretedIntent(intent),
        themeContext: {},
        tokenReconciliation: {
          colors: [],
          typography: [],
          spacing: [],
          unresolved: [{
            intentRole: "theme",
            remediation: "Ask the user which theme to target, then retry the bridge with that choice reflected in the request context."
          }]
        },
        componentPlan: {
          audit: {},
          suggestedStructure: { approach: "create" },
          variantMechanism: { id: "pattern_variants", reason: "Deferred until theme is selected." },
          filesToInspect: []
        },
        implementationGuidance: {
          useTokens: [],
          avoidRawValues: collectRawValuesToAvoid(intent),
          markupConventions: [],
          scssConventions: [],
          phpConventions: [],
          responsiveRules: []
        },
        verificationChecks: [],
        openQuestions: [
          "Which theme should this implementation target?",
          ...themeResolutionResult.themeCandidates.map(
            (candidate) => `Candidate ${candidate.slug} (score ${candidate.score.toFixed(2)}): ${candidate.reasons.join("; ")}`
          )
        ],
        requiresThemeSelection: true,
        themeCandidates: themeResolutionResult.themeCandidates
      };
    }

    const profile = themeResolutionResult.profile;
    if (!profile) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Theme profile could not be resolved for the design bridge.",
        500
      );
    }
    const tokenReconciliation = reconcileAllTokens(intent, profile.tokensStructured, {
      scssSpacing: profile.conventions.scssSpacing
    });
    let querySpec = buildComponentQuerySpec(intent, input.componentHint);
    const discoveredBlocks = discoverBlockSlugsFromIndex(
      wpRoot,
      [querySpec.name, intent.layout.structure, input.componentHint ?? ""].join(" ")
    );
    querySpec = mergeDiscoveredBlockSlugs(querySpec, discoveredBlocks);
    const audit = deps.audit.auditComponent({
      wpRoot,
      componentQuerySpec: querySpec,
      limit: 20
    });

    const recommendation = audit.recommendation as { action?: "reuse" | "extend" | "create" } | undefined;
    const variants = audit.variants as {
      recommendedMechanism?: { id?: string; reason?: string };
    } | undefined;
    const bestMatch = audit.bestMatch as { path?: string | null; id?: string; type?: string } | null;
    const approach = recommendation?.action ?? "create";

    const filesToInspect = Array.from(new Set([
      ...(bestMatch?.path ? [bestMatch.path] : []),
      ...profile.helpers.files.slice(0, 5),
      ...profile.conventions.directories.slice(0, 5)
    ])).filter(Boolean);

    const suggestedStructure: ImplementationSpec["componentPlan"]["suggestedStructure"] = {
      approach,
      classNaming: profile.conventions.naming.dominantFileCase
        ? [`${profile.conventions.naming.dominantFileCase}-component`]
        : []
    };

    if (bestMatch?.type === "pattern") {
      suggestedStructure.patternSlug = bestMatch.id;
    }
    if (bestMatch?.type === "template") {
      suggestedStructure.templatePart = bestMatch.id;
    }

    const implementationGuidance = buildImplementationGuidance({
      intent,
      tokenReconciliation,
      themeContext: profile as unknown as Record<string, unknown>
    });

    const openQuestions: string[] = [];
    for (const unresolved of tokenReconciliation.unresolved) {
      openQuestions.push(`${unresolved.intentRole}: ${unresolved.remediation}`);
    }

    return {
      queryEcho: {
        visualIntentSummary: summarizeVisualIntent(intent),
        themeResolution: themeResolutionResult.resolution,
        targetSurface: input.targetSurface
      },
      interpretedIntent: buildInterpretedIntent(intent),
      themeContext: profile as unknown as Record<string, unknown>,
      tokenReconciliation,
      componentPlan: {
        audit,
        suggestedStructure,
        variantMechanism: {
          id: variants?.recommendedMechanism?.id ?? "pattern_variants",
          reason: variants?.recommendedMechanism?.reason ?? "Default variant mechanism for new layout work."
        },
        filesToInspect
      },
      implementationGuidance,
      verificationChecks: buildVerificationChecks({
        intent,
        reconciledColors: tokenReconciliation.colors,
        auditVerdict: String(audit.verdict ?? "missing"),
        bestMatchPath: bestMatch?.path ?? null
      }),
      openQuestions,
      requiresThemeSelection: false,
      themeCandidates: themeResolutionResult.themeCandidates
    };
  }

  return {
    bridgeDesignToImplementation
  };
}

export type DesignBridgeService = ReturnType<typeof createDesignBridgeService>;
