import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { buildStructuredTokens, buildThemeProfileFromPath, parseThemeJsonFromContent } from "../theme/themeProfileHelpers";
import { scoreThemeAgainstVisualIntent } from "./designBridge/themeMatcher";
import { normalizeVisualIntent } from "./designBridge/visualIntentSchema";

test("buildThemeProfileFromPath returns flattened directories and structured tokens", () => {
  const themeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-theme-test-"));
  fs.mkdirSync(path.join(themeDir, "patterns"), { recursive: true });
  fs.writeFileSync(
    path.join(themeDir, "theme.json"),
    JSON.stringify({
      settings: {
        color: { palette: [{ slug: "base", name: "Base", color: "#fff" }] },
        spacing: { spacingSizes: [{ slug: "40", name: "40", size: "1rem" }] }
      }
    })
  );

  const profile = buildThemeProfileFromPath(themeDir, "test-theme", true);
  assert.equal(profile.activeTheme.name, "test-theme");
  assert.ok(profile.tokensStructured.colors.length >= 1);
  assert.ok(profile.conventions.directories.includes("patterns"));
  assert.ok(profile.conventions.directoriesByKind?.partials || profile.conventions.directories.length > 0);
});

test("theme best-match scoring prefers theme with matching accent color", () => {
  const themeA = buildStructuredTokens(parseThemeJsonFromContent(JSON.stringify({
    settings: { color: { palette: [{ slug: "accent", name: "Accent", color: "#0055ff" }] } }
  })));
  const themeB = buildStructuredTokens(parseThemeJsonFromContent(JSON.stringify({
    settings: { color: { palette: [{ slug: "accent", name: "Accent", color: "#ff0000" }] } }
  })));

  const intent = normalizeVisualIntent({
    layout: { structure: "cta band", regions: [] },
    typography: [],
    colors: [{ role: "accent", emphasis: "primary", raw: { hex: "#0044ee" } }],
    spacing: {}
  });

  const scoreA = scoreThemeAgainstVisualIntent(themeA, intent);
  const scoreB = scoreThemeAgainstVisualIntent(themeB, intent);
  assert.ok(scoreA.score > scoreB.score);
});
