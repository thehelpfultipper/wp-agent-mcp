import type { VisualIntent } from "./visualIntentSchema";
import type { ReconciledToken } from "./tokenMatcher";

export type VerificationCheck = {
  id: string;
  description: string;
  selectorOrRegion?: string;
  playwrightHint?: string;
};

export function buildVerificationChecks(input: {
  intent: VisualIntent;
  reconciledColors: ReconciledToken[];
  auditVerdict: string;
  bestMatchPath?: string | null;
}): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  checks.push({
    id: "token-colors",
    description: "Key regions use theme preset CSS variables instead of raw Figma hex values.",
    playwrightHint: "Inspect computed styles for color properties and confirm var(--wp--preset--color--*) usage."
  });

  for (const region of input.intent.layout.regions.slice(0, 3)) {
    checks.push({
      id: `region-${region.id}`,
      description: `Region "${region.role}" matches intended layout structure.`,
      selectorOrRegion: region.id,
      playwrightHint: `Verify visible layout for region role "${region.role}" matches: ${input.intent.layout.structure}`
    });
  }

  if (input.intent.responsive?.mobile || input.intent.responsive?.tablet || input.intent.responsive?.desktop) {
    checks.push({
      id: "responsive-layout",
      description: "Responsive behavior matches interpreted mobile/tablet/desktop intent.",
      playwrightHint: [
        input.intent.responsive.mobile ? `mobile: ${input.intent.responsive.mobile}` : "",
        input.intent.responsive.tablet ? `tablet: ${input.intent.responsive.tablet}` : "",
        input.intent.responsive.desktop ? `desktop: ${input.intent.responsive.desktop}` : ""
      ].filter(Boolean).join(" | ")
    });
  }

  if (input.auditVerdict === "exists" && input.bestMatchPath) {
    checks.push({
      id: "reuse-render",
      description: `Reused component at ${input.bestMatchPath} renders with reconciled theme tokens.`,
      playwrightHint: `Confirm ${input.bestMatchPath} is present and styled with theme presets.`
    });
  }

  if (input.reconciledColors.length > 0) {
    const sample = input.reconciledColors[0];
    if (sample) {
      checks.push({
        id: "sample-token",
        description: `Sample mapped token ${sample.cssVar} is applied.`,
        playwrightHint: `Look for ${sample.cssVar} in computed styles.`
      });
    }
  }

  return checks;
}
