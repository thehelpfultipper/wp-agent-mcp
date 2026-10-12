import type { StructuredThemeTokens } from "../../theme/themeProfileHelpers";
import type { VisualIntent } from "./visualIntentSchema";
import { nearestColorToken, parseCssColor } from "./colorDistance";

export function scoreThemeAgainstVisualIntent(
  tokens: StructuredThemeTokens,
  visualIntent: VisualIntent
): { score: number; confidence: "high" | "medium" | "low"; reasons: string[] } {
  const reasons: string[] = [];
  let totalWeight = 0;
  let earned = 0;

  for (const color of visualIntent.colors) {
    const raw = color.raw?.hex ?? color.raw?.rgba;
    if (!raw) {
      continue;
    }
    totalWeight += 1;
    const nearest = nearestColorToken(raw, tokens.colors);
    if (!nearest.token) {
      continue;
    }
    const maxDistance = 120;
    const normalized = Math.max(0, 1 - nearest.distance / maxDistance);
    earned += normalized;
    if (normalized >= 0.75) {
      reasons.push(`Color ${raw} maps closely to ${nearest.token.slug}`);
    }
  }

  for (const type of visualIntent.typography) {
    const rawSize = type.raw?.fontSize;
    if (!rawSize) {
      continue;
    }
    totalWeight += 0.5;
    const px = Number.parseFloat(rawSize);
    if (!Number.isFinite(px)) {
      continue;
    }
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const token of tokens.fontSizes) {
      const tokenPx = Number.parseFloat(token.size);
      if (!Number.isFinite(tokenPx)) {
        continue;
      }
      bestDelta = Math.min(bestDelta, Math.abs(tokenPx - px));
    }
    if (bestDelta < Number.POSITIVE_INFINITY) {
      const normalized = Math.max(0, 1 - bestDelta / 24);
      earned += normalized * 0.5;
      if (normalized >= 0.6) {
        reasons.push(`Typography size ${rawSize} aligns with theme scale`);
      }
    }
  }

  if (totalWeight === 0) {
    const paletteSize = tokens.colors.length + tokens.fontSizes.length + tokens.spacing.length;
    const baseline = paletteSize > 0 ? 0.35 : 0;
    return {
      score: baseline,
      confidence: "low",
      reasons: paletteSize > 0 ? ["Theme has presets but visual intent lacks raw comparison hints"] : ["Theme has no theme.json presets"]
    };
  }

  const score = earned / totalWeight;
  const confidence: "high" | "medium" | "low" = score >= 0.75 ? "high" : score >= 0.5 ? "medium" : "low";
  if (reasons.length === 0 && score > 0) {
    reasons.push("Partial token alignment with visual intent");
  }
  return { score, confidence, reasons };
}

export function pickDefaultColorToken(
  tokens: StructuredThemeTokens,
  slugHints: string[]
): StructuredThemeTokens["colors"][number] | null {
  for (const hint of slugHints) {
    const match = tokens.colors.find((token) => token.slug.includes(hint));
    if (match) {
      return match;
    }
  }
  return tokens.colors[0] ?? null;
}

export function parseThemeColorValue(value: string): ReturnType<typeof parseCssColor> {
  return parseCssColor(value);
}
