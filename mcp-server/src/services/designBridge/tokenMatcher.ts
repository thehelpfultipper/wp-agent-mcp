import type { StructuredThemeTokens } from "../../theme/themeProfileHelpers";
import type { ScssSpacingConventions } from "../../theme/themeProfileHelpers";
import type { VisualIntent, VisualIntentColorRole } from "./visualIntentSchema";
import { nearestColorToken } from "./colorDistance";
import { pickDefaultColorToken } from "./themeMatcher";

export type ReconciledToken = {
  intentRole: string;
  mappedToken: string;
  cssVar: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  scssSuggestion?: string;
};

export type UnresolvedToken = {
  intentRole: string;
  rawValue?: string;
  remediation: string;
};

const COLOR_ROLE_HINTS: Record<VisualIntentColorRole, string[]> = {
  background: ["background", "base", "white", "light"],
  surface: ["surface", "neutral", "gray", "grey", "base"],
  text: ["foreground", "text", "contrast", "body"],
  heading: ["heading", "foreground", "contrast", "primary"],
  accent: ["accent", "primary", "brand", "highlight"],
  border: ["border", "neutral", "gray", "grey"],
  interactive: ["interactive", "primary", "accent", "link"]
};

function confidenceFromDistance(distance: number): "high" | "medium" | "low" {
  if (distance <= 25) {
    return "high";
  }
  if (distance <= 60) {
    return "medium";
  }
  return "low";
}

export function reconcileColorTokens(
  intent: VisualIntent,
  tokens: StructuredThemeTokens
): { reconciled: ReconciledToken[]; unresolved: UnresolvedToken[] } {
  const reconciled: ReconciledToken[] = [];
  const unresolved: UnresolvedToken[] = [];
  const usedSlugs = new Set<string>();

  for (const entry of intent.colors) {
    const roleKey = `${entry.role}${entry.emphasis ? `:${entry.emphasis}` : ""}`;
    const raw = entry.raw?.hex ?? entry.raw?.rgba;
    const hints = COLOR_ROLE_HINTS[entry.role] ?? [];

    let token = raw ? nearestColorToken(raw, tokens.colors).token : null;
    let distance = raw ? nearestColorToken(raw, tokens.colors).distance : Number.POSITIVE_INFINITY;
    let reasons: string[] = [];

    if (!token) {
      token = pickDefaultColorToken(tokens, hints);
      if (token) {
        reasons.push(`Mapped ${entry.role} to theme preset by role convention`);
      }
    } else {
      reasons.push(`Nearest palette match for raw color hint`);
    }

    if (!token) {
      unresolved.push({
        intentRole: roleKey,
        rawValue: raw,
        remediation: "Add a theme.json color preset or specify themeSlug with a richer palette."
      });
      continue;
    }

    if (usedSlugs.has(token.slug) && raw) {
      const alternate = tokens.colors.find((candidate) => !usedSlugs.has(candidate.slug));
      if (alternate) {
        token = alternate;
        reasons = [`Secondary mapping for repeated role ${entry.role}`];
      }
    }

    usedSlugs.add(token.slug);
    reconciled.push({
      intentRole: roleKey,
      mappedToken: `${token.slug}|${token.name}|${token.value}`,
      cssVar: token.cssVar,
      confidence: raw ? confidenceFromDistance(distance) : "medium",
      reasons
    });
  }

  return { reconciled, unresolved };
}

export function reconcileAllTokens(
  intent: VisualIntent,
  tokens: StructuredThemeTokens,
  options?: { scssSpacing?: ScssSpacingConventions }
): {
  colors: ReconciledToken[];
  typography: ReconciledToken[];
  spacing: ReconciledToken[];
  unresolved: UnresolvedToken[];
} {
  const colors = reconcileColorTokens(intent, tokens);
  const typography = reconcileTypographyTokens(intent, tokens);
  const spacing = reconcileSpacingTokens(intent, tokens, options?.scssSpacing);

  return {
    colors: colors.reconciled,
    typography: typography.reconciled,
    spacing: spacing.reconciled,
    unresolved: [...colors.unresolved, ...typography.unresolved, ...spacing.unresolved]
  };
}

function reconcileTypographyTokens(
  intent: VisualIntent,
  tokens: StructuredThemeTokens
): { reconciled: ReconciledToken[]; unresolved: UnresolvedToken[] } {
  const reconciled: ReconciledToken[] = [];
  const unresolved: UnresolvedToken[] = [];

  const roleToSizeHints: Record<string, string[]> = {
    display: ["xx-large", "x-large", "huge", "display"],
    heading: ["x-large", "large", "h1", "heading"],
    subheading: ["large", "medium", "h2", "subheading"],
    body: ["medium", "normal", "base", "body"],
    caption: ["small", "caption"],
    label: ["small", "label", "xs"]
  };

  for (const entry of intent.typography) {
    const roleKey = `${entry.role}${entry.emphasis ? `:${entry.emphasis}` : ""}`;
    const hints = roleToSizeHints[entry.role] ?? ["medium"];
    let sizeToken = tokens.fontSizes.find((token) => hints.some((hint) => token.slug.includes(hint)));
    let confidence: "high" | "medium" | "low" = "medium";
    const reasons: string[] = [];

    if (entry.raw?.fontSize) {
      const px = Number.parseFloat(entry.raw.fontSize);
      if (Number.isFinite(px)) {
        let best: (typeof tokens.fontSizes)[number] | null = null;
        let bestDelta = Number.POSITIVE_INFINITY;
        for (const token of tokens.fontSizes) {
          const tokenPx = Number.parseFloat(token.size);
          if (!Number.isFinite(tokenPx)) {
            continue;
          }
          const delta = Math.abs(tokenPx - px);
          if (delta < bestDelta) {
            bestDelta = delta;
            best = token;
          }
        }
        if (best) {
          sizeToken = best;
          confidence = bestDelta <= 4 ? "high" : bestDelta <= 12 ? "medium" : "low";
          reasons.push(`Mapped raw font size to nearest theme preset`);
        }
      }
    } else if (sizeToken) {
      reasons.push(`Mapped typography role to theme preset`);
    }

    if (!sizeToken) {
      unresolved.push({
        intentRole: roleKey,
        rawValue: entry.raw?.fontSize,
        remediation: "Add font size presets to theme.json or extend the child theme typography scale."
      });
      continue;
    }

    reconciled.push({
      intentRole: roleKey,
      mappedToken: `${sizeToken.slug}|${sizeToken.name}|${sizeToken.size}`,
      cssVar: sizeToken.cssVar,
      confidence,
      reasons: reasons.length > 0 ? reasons : ["Role-based typography mapping"]
    });
  }

  return { reconciled, unresolved };
}

function parsePxValue(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  const pxMatch = trimmed.match(/^([\d.]+)\s*px$/iu);
  if (pxMatch) {
    const parsed = Number.parseFloat(pxMatch[1] ?? "");
    return Number.isFinite(parsed) ? parsed : null;
  }
  const remMatch = trimmed.match(/^([\d.]+)\s*rem$/iu);
  if (remMatch) {
    const parsed = Number.parseFloat(remMatch[1] ?? "");
    return Number.isFinite(parsed) ? parsed * 16 : null;
  }
  return null;
}

function spacingTokenToPx(value: string): number | null {
  return parsePxValue(value) ?? (Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) * 16 : null);
}

function buildScssSpacingSuggestion(px: number, scssSpacing?: ScssSpacingConventions): string | undefined {
  const suggestions: string[] = [];
  if (scssSpacing?.usesRfsValue) {
    suggestions.push(`rfs-value(${px}px)`);
  }
  if (scssSpacing?.spacerBasePx && scssSpacing.spacerBasePx > 0) {
    const multiplier = Number.parseFloat((px / scssSpacing.spacerBasePx).toFixed(2));
    suggestions.push(`$spacer * ${multiplier}`);
  }
  if (scssSpacing?.globalLayoutSelectors.includes("#content-wrapper")) {
    suggestions.push("Prefer theme spacing tokens before overriding #content-wrapper padding.");
  }
  return suggestions.length > 0 ? suggestions.join(" | ") : undefined;
}

function reconcileSpacingTokens(
  intent: VisualIntent,
  tokens: StructuredThemeTokens,
  scssSpacing?: ScssSpacingConventions
): { reconciled: ReconciledToken[]; unresolved: UnresolvedToken[] } {
  const reconciled: ReconciledToken[] = [];
  const unresolved: UnresolvedToken[] = [];

  const rhythmToHints: Record<string, string[]> = {
    tight: ["20", "30", "40", "sm", "small"],
    normal: ["40", "50", "md", "medium"],
    loose: ["60", "70", "80", "lg", "large"]
  };
  const paddingToHints: Record<string, string[]> = {
    sm: ["30", "40", "sm"],
    md: ["40", "50", "md"],
    lg: ["60", "70", "lg"],
    xl: ["80", "90", "xl"]
  };

  const entries: Array<{ role: string; hints: string[]; raw?: string }> = [];
  if (intent.spacing.rhythm) {
    entries.push({ role: `rhythm:${intent.spacing.rhythm}`, hints: rhythmToHints[intent.spacing.rhythm] ?? [] });
  }
  if (intent.spacing.sectionPadding) {
    entries.push({
      role: `sectionPadding:${intent.spacing.sectionPadding}`,
      hints: paddingToHints[intent.spacing.sectionPadding] ?? []
    });
  }
  if (intent.spacing.gaps) {
    entries.push({ role: `gaps:${intent.spacing.gaps}`, hints: paddingToHints[intent.spacing.gaps] ?? [] });
  }
  if (intent.spacing.raw?.padding) {
    entries.push({
      role: `rawPadding:${intent.spacing.raw.padding}`,
      hints: [],
      raw: intent.spacing.raw.padding
    });
  }
  if (intent.spacing.raw?.gap) {
    entries.push({
      role: `rawGap:${intent.spacing.raw.gap}`,
      hints: [],
      raw: intent.spacing.raw.gap
    });
  }

  for (const entry of entries) {
    const rawPx = parsePxValue(entry.raw);
    let token = tokens.spacing.find((candidate) => entry.hints.some((hint) => candidate.slug.includes(hint)));

    if (!token && rawPx !== null) {
      let best: (typeof tokens.spacing)[number] | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const candidate of tokens.spacing) {
        const candidatePx = spacingTokenToPx(candidate.value);
        if (candidatePx === null) {
          continue;
        }
        const delta = Math.abs(candidatePx - rawPx);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = candidate;
        }
      }
      token = best ?? undefined;
    }

    if (!token && tokens.spacing.length > 0) {
      token = tokens.spacing[Math.min(tokens.spacing.length - 1, 2)];
    }
    if (!token) {
      unresolved.push({
        intentRole: entry.role,
        rawValue: entry.raw,
        remediation: "Define spacing presets in theme.json spacing.spacingSizes or spacingScale."
      });
      continue;
    }

    const scssSuggestion = rawPx !== null ? buildScssSpacingSuggestion(rawPx, scssSpacing) : undefined;
    reconciled.push({
      intentRole: entry.role,
      mappedToken: `${token.slug}|${token.name}|${token.value}`,
      cssVar: token.cssVar,
      confidence: rawPx !== null
        ? (() => {
          const tokenPx = spacingTokenToPx(token.value);
          return tokenPx !== null && Math.abs(tokenPx - rawPx) <= 8 ? "high" : "medium";
        })()
        : "medium",
      reasons: rawPx !== null
        ? [`Mapped raw spacing ${rawPx}px to nearest theme preset`]
        : ["Mapped spacing intent to theme spacing scale"],
      scssSuggestion
    });
  }

  return { reconciled, unresolved };
}
