import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../errors";
import { buildStructuredTokens, parseThemeJsonFromContent } from "../theme/themeProfileHelpers";
import { normalizeVisualIntent } from "./designBridge/visualIntentSchema";
import { reconcileAllTokens } from "./designBridge/tokenMatcher";
import { scoreThemeAgainstVisualIntent } from "./designBridge/themeMatcher";
import { buildComponentQuerySpec } from "./designBridge/componentQueryBuilder";
import { extractBlockIdentifiers } from "./designBridge/blockIdentifierExtractor";
import { mapFigmaCaptureToVisualIntent } from "./designBridge/figmaCaptureMapper";
import { resolveBridgeVisualIntent } from "./designBridge/visualIntentSchema";

const fixtureThemeJson = {
  settings: {
    color: {
      palette: [
        { slug: "base", name: "Base", color: "#ffffff" },
        { slug: "contrast", name: "Contrast", color: "#111111" },
        { slug: "accent", name: "Accent", color: "#0055ff" }
      ]
    },
    typography: {
      fontSizes: [
        { slug: "small", name: "Small", size: "14px" },
        { slug: "medium", name: "Medium", size: "18px" },
        { slug: "large", name: "Large", size: "32px" }
      ],
      fontFamilies: [
        { slug: "system", name: "System", fontFamily: "system-ui, sans-serif" }
      ]
    },
    spacing: {
      spacingSizes: [
        { slug: "40", name: "40", size: "1rem" },
        { slug: "60", name: "60", size: "2rem" },
        { slug: "80", name: "80", size: "3rem" }
      ]
    }
  }
};

test("normalizeVisualIntent rejects raw-only payloads", () => {
  assert.throws(
    () => normalizeVisualIntent({
      layout: { structure: "", regions: [] },
      typography: [],
      colors: [{ raw: { hex: "#112233" } }],
      spacing: { raw: { padding: "24px" } }
    }),
    (err: unknown) => err instanceof AppError && err.code === "BRIDGE_INTENT_TOO_RAW"
  );
});

test("normalizeVisualIntent accepts semantic roles with optional raw hints", () => {
  const intent = normalizeVisualIntent({
    layout: { structure: "two-column hero", regions: [{ id: "hero", role: "hero" }] },
    typography: [{ role: "heading", emphasis: "primary", raw: { fontSize: "32px" } }],
    colors: [
      { role: "background", emphasis: "primary", raw: { hex: "#ffffff" } },
      { role: "text", emphasis: "primary", raw: { hex: "#111111" } }
    ],
    spacing: { rhythm: "normal", sectionPadding: "lg" },
    components: [{ label: "hero", kind: "hero" }]
  });

  assert.equal(intent.layout.structure, "two-column hero");
  assert.equal(intent.components?.[0]?.label, "hero");
});

test("reconcileAllTokens maps semantic colors to theme presets", () => {
  const tokens = buildStructuredTokens(parseThemeJsonFromContent(JSON.stringify(fixtureThemeJson)));
  const intent = normalizeVisualIntent({
    layout: { structure: "hero", regions: [{ id: "hero", role: "hero" }] },
    typography: [{ role: "heading", emphasis: "primary" }],
    colors: [
      { role: "background", emphasis: "primary", raw: { hex: "#fefefe" } },
      { role: "text", emphasis: "primary", raw: { hex: "#101010" } },
      { role: "accent", emphasis: "primary", raw: { hex: "#0044ee" } }
    ],
    spacing: { rhythm: "normal", sectionPadding: "lg" }
  });

  const result = reconcileAllTokens(intent, tokens);
  assert.ok(result.colors.length >= 3);
  assert.match(result.colors[0]?.cssVar ?? "", /var\(--wp--preset--color--/u);
  assert.equal(result.unresolved.length, 0);
});

test("scoreThemeAgainstVisualIntent ranks closer palette higher", () => {
  const closeTheme = buildStructuredTokens(parseThemeJsonFromContent(JSON.stringify(fixtureThemeJson)));
  const farTheme = buildStructuredTokens(parseThemeJsonFromContent(JSON.stringify({
    settings: {
      color: {
        palette: [{ slug: "pink", name: "Pink", color: "#ff00ff" }]
      }
    }
  })));

  const intent = normalizeVisualIntent({
    layout: { structure: "hero", regions: [] },
    typography: [],
    colors: [{ role: "accent", emphasis: "primary", raw: { hex: "#0055ff" } }],
    spacing: {}
  });

  const closeScore = scoreThemeAgainstVisualIntent(closeTheme, intent);
  const farScore = scoreThemeAgainstVisualIntent(farTheme, intent);
  assert.ok(closeScore.score > farScore.score);
});

test("buildComponentQuerySpec derives audit query from layout and components", () => {
  const intent = normalizeVisualIntent({
    layout: { structure: "footer disclosure", regions: [] },
    typography: [],
    colors: [{ role: "text", emphasis: "primary" }],
    spacing: { rhythm: "tight" },
    components: [{ label: "footer legal", kind: "footer", contains: ["links"] }]
  });

  const spec = buildComponentQuerySpec(intent, "compact variant");
  assert.match(spec.name, /compact variant/u);
  assert.match(spec.name, /footer legal/u);
});

test("buildComponentQuerySpec extracts block slug from component label", () => {
  const intent = normalizeVisualIntent({
    layout: { structure: "two column hero", regions: [] },
    typography: [{ role: "heading", emphasis: "primary" }],
    colors: [{ role: "text", emphasis: "primary" }],
    spacing: { rhythm: "normal" },
    components: [{ label: "tht/card-hero", kind: "hero" }]
  });

  const spec = buildComponentQuerySpec(intent);
  assert.ok(spec.blockNames.includes("tht/card-hero"));
  assert.ok(spec.componentLabels.includes("tht/card-hero"));
});

test("extractBlockIdentifiers finds namespace block slugs in layout text", () => {
  const identifiers = extractBlockIdentifiers("hero section tht/card-hero layout");
  assert.ok(identifiers.blockNames.includes("tht/card-hero"));
  assert.ok(identifiers.componentLabels.includes("tht/card-hero"));
});

test("reconcileAllTokens maps raw spacing px to presets and scss suggestions", () => {
  const tokens = buildStructuredTokens(parseThemeJsonFromContent(JSON.stringify(fixtureThemeJson)));
  const intent = normalizeVisualIntent({
    layout: { structure: "section", regions: [] },
    typography: [],
    colors: [{ role: "text", emphasis: "primary" }],
    spacing: { rhythm: "normal", raw: { padding: "88px" } }
  });

  const result = reconcileAllTokens(intent, tokens, {
    scssSpacing: { spacerBasePx: 16, usesRfsValue: true, globalLayoutSelectors: ["#content-wrapper"] }
  });
  assert.ok(result.spacing.some((entry) => entry.intentRole.startsWith("rawPadding:")));
  assert.ok(result.spacing.some((entry) => typeof entry.scssSuggestion === "string" && entry.scssSuggestion.includes("rfs-value(88px)")));
});

test("mapFigmaCaptureToVisualIntent extracts component labels from capture nodes", () => {
  const intent = mapFigmaCaptureToVisualIntent({
    nodes: [{ name: "tht/card-hero" }, { label: "Card hero heading" }]
  });
  assert.ok(intent.components?.some((component) => component.label.includes("tht/card-hero")));
});

test("resolveBridgeVisualIntent accepts figmaCapture passthrough", () => {
  const intent = resolveBridgeVisualIntent({
    figmaCapture: {
      nodes: [{ name: "two-column hero tht/card-hero" }]
    }
  });
  assert.match(intent.layout.structure, /hero/iu);
});
