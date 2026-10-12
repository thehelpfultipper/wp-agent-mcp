import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors";
import { assertWithinRoot, resolveWpRoot, wpRootLooksValid } from "../sandbox";
import { runWpCli } from "../wpCli";
import type { ConfigService } from "./configService";
import {
  buildStructuredTokens,
  buildThemeProfileFromPath,
  firstNonEmptyLine,
  parseThemeJson,
  type ScssSpacingConventions,
  type StructuredThemeTokens
} from "../theme/themeProfileHelpers";
import type { VisualIntent } from "./designBridge/visualIntentSchema";
import { scoreThemeAgainstVisualIntent } from "./designBridge/themeMatcher";
import {
  collectRequestCorpus,
  filterCustomThemes,
  inferThemeSlugFromText
} from "./designBridge/themeSlugInference";

export type ThemeProfileInput = {
  wpRoot?: string;
  themeSlug?: string;
  themePath?: string;
  siteUrl?: string;
  blogId?: number;
};

export type ThemeProfileResult = {
  activeTheme: {
    name: string;
    path: string;
    isBlockTheme: boolean;
  };
  tokens: {
    colors: string[];
    typography: string[];
    spacing: string[];
    customNamespaces: string[];
  };
  tokensStructured: StructuredThemeTokens;
  helpers: {
    files: string[];
    notableFunctions: string[];
  };
  conventions: {
    naming: {
      dominantFileCase: string;
      phpFunctionPrefixes: string[];
    };
    directories: string[];
    directoriesByKind?: {
      components: string[];
      partials: string[];
      helpers: string[];
    };
    cssVarPrefixes: string[];
    scssSpacing?: ScssSpacingConventions;
  };
};

export type InstalledThemeRow = {
  name: string;
  status: string;
  version?: string;
};

export type ThemeCandidate = {
  slug: string;
  path: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

export type ThemeResolution =
  | { mode: "explicit_slug"; themeSlug: string }
  | { mode: "explicit_path"; themePath: string }
  | { mode: "text_match"; themeSlug: string; matchedText: string }
  | { mode: "active_site"; themeSlug: string }
  | { mode: "best_match"; themeSlug: string; score: number };

export type ThemeProfileServiceDeps = {
  wpCli: string;
  config: ConfigService;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalBlogId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function contextArgs(siteUrl: string | undefined): string[] {
  return siteUrl ? [`--url=${siteUrl}`] : [];
}

function withBlogEvalPhp(php: string, blogId: number | undefined): string {
  if (!blogId || blogId <= 0) {
    return php;
  }
  return [
    `$blogId = ${String(blogId)};`,
    "if (function_exists('switch_to_blog')) { switch_to_blog($blogId); }",
    php
  ].join(" ");
}

export function createThemeProfileService(deps: ThemeProfileServiceDeps) {
  function runEval(
    wpRoot: string,
    php: string,
    siteUrl: string | undefined,
    blogId: number | undefined
  ): string {
    return runWpCli(
      wpRoot,
      [...contextArgs(siteUrl), "eval", withBlogEvalPhp(php, blogId)],
      deps.wpCli
    );
  }

  function runCommand(
    wpRoot: string,
    args: string[],
    siteUrl: string | undefined,
    blogId: number | undefined
  ): string {
    if (blogId && blogId > 0 && args[0] !== "eval") {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        "blogId context is supported for theme resolution via eval-backed commands only in this tool.",
        400,
        { blogId }
      );
    }
    return runWpCli(wpRoot, [...contextArgs(siteUrl), ...args], deps.wpCli);
  }

  function resolveWpRootInput(wpRootInput: string | undefined): string {
    const wpRoot = resolveWpRoot(wpRootInput ?? deps.config.getConfiguredWpRoot(), deps.config.getConfiguredWpRoot());
    if (!wpRootLooksValid(wpRoot)) {
      throw new AppError(
        "WP_ROOT_INVALID",
        "Invalid WP root. Expected `wp-includes` in wpRoot or `wp-config.php` in wpRoot (or its parent).",
        400,
        { wpRoot }
      );
    }
    return wpRoot;
  }

  function listInstalledThemes(wpRoot: string, siteUrl?: string, blogId?: number): InstalledThemeRow[] {
    const raw = blogId && blogId > 0
      ? runEval(
        wpRoot,
        [
          "$active = get_stylesheet();",
          "$parent = get_template();",
          "$out = [];",
          "foreach (wp_get_themes() as $slug => $theme) {",
          "  $status = ($slug === $active) ? 'active' : (($slug === $parent && $slug !== $active) ? 'parent' : 'inactive');",
          "  $out[] = ['name' => $slug, 'status' => $status];",
          "}",
          "echo json_encode(array_values($out));"
        ].join(" "),
        siteUrl,
        blogId
      )
      : runCommand(
        wpRoot,
        ["theme", "list", "--format=json"],
        siteUrl,
        blogId
      );
    try {
      const parsed = JSON.parse(raw) as InstalledThemeRow[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function resolveThemeRoot(wpRoot: string): string {
    const raw = runWpCli(wpRoot, ["eval", "echo get_theme_root();"], deps.wpCli);
    const themeRoot = firstNonEmptyLine(raw);
    if (!themeRoot) {
      throw new AppError("WPCLI_FAILED", "Unable to determine theme root.", 400, {
        command: "wp eval echo get_theme_root();"
      });
    }
    return assertWithinRoot(wpRoot, themeRoot, "themeRoot");
  }

  function resolveActiveTheme(wpRoot: string, siteUrl?: string, blogId?: number): { name: string; path: string } {
    const name = blogId && blogId > 0
      ? firstNonEmptyLine(runEval(wpRoot, "echo get_stylesheet();", siteUrl, blogId))
      : firstNonEmptyLine(runCommand(
        wpRoot,
        ["theme", "list", "--status=active", "--field=name"],
        siteUrl,
        blogId
      ));
    if (!name) {
      throw new AppError("WPCLI_FAILED", "Unable to determine active theme.", 400, {
        command: blogId ? "wp eval echo get_stylesheet();" : "wp theme list --status=active --field=name"
      });
    }

    const pathRaw = runEval(
      wpRoot,
      "echo get_theme_root() . '/' . get_stylesheet();",
      siteUrl,
      blogId
    );
    const themePath = firstNonEmptyLine(pathRaw);
    if (!themePath) {
      throw new AppError("WPCLI_FAILED", "Unable to determine active theme path.", 400, {
        command: "wp eval echo get_theme_root() . '/' . get_stylesheet();"
      });
    }

    return {
      name,
      path: assertWithinRoot(wpRoot, themePath, "activeThemePath")
    };
  }

  function resolveThemePathBySlug(wpRoot: string, themeSlug: string): string {
    const themeRoot = resolveThemeRoot(wpRoot);
    const candidate = path.join(themeRoot, themeSlug);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new AppError("TOOL_INPUT_INVALID", `Theme "${themeSlug}" was not found under the theme root.`, 400, {
        themeSlug,
        themeRoot
      });
    }
    return assertWithinRoot(wpRoot, candidate, "themePath");
  }

  function isBlockTheme(wpRoot: string, themePath: string, siteUrl?: string, blogId?: number): boolean {
    const stylesheet = path.basename(themePath).replace(/'/gu, "\\'");
    const raw = runEval(
      wpRoot,
      `$theme = wp_get_theme('${stylesheet}'); echo $theme->exists() && $theme->is_block_theme() ? '1' : '0';`,
      siteUrl,
      blogId
    );
    return firstNonEmptyLine(raw) === "1";
  }

  function getThemeProfile(input: ThemeProfileInput): ThemeProfileResult {
    const wpRoot = resolveWpRootInput(input.wpRoot);
    const siteUrl = normalizeOptionalString(input.siteUrl);
    const blogId = normalizeOptionalBlogId(input.blogId);
    const themeSlug = normalizeOptionalString(input.themeSlug);
    const themePathInput = normalizeOptionalString(input.themePath);

    let themeName: string;
    let themePath: string;

    if (themePathInput) {
      themePath = assertWithinRoot(wpRoot, themePathInput, "themePath");
      themeName = themeSlug ?? path.basename(themePath);
    } else if (themeSlug) {
      themePath = resolveThemePathBySlug(wpRoot, themeSlug);
      themeName = themeSlug;
    } else {
      const active = resolveActiveTheme(wpRoot, siteUrl, blogId);
      themeName = active.name;
      themePath = active.path;
    }

    const blockTheme = isBlockTheme(wpRoot, themePath, siteUrl, blogId);
    return buildThemeProfileFromPath(themePath, themeName, blockTheme);
  }

  function loadThemeJsonFromSlug(wpRoot: string, themeSlug: string): StructuredThemeTokens {
    const themePath = resolveThemePathBySlug(wpRoot, themeSlug);
    const themeJson = parseThemeJson(path.join(themePath, "theme.json"));
    return buildStructuredTokens(themeJson);
  }

  function rankThemeCandidates(
    wpRoot: string,
    visualIntent: VisualIntent,
    siteUrl?: string,
    blogId?: number,
    minConfidenceScore = 0.55
  ): ThemeCandidate[] {
    const themes = listInstalledThemes(wpRoot, siteUrl, blogId);
    const candidates: ThemeCandidate[] = [];

    for (const theme of themes) {
      if (!theme.name) {
        continue;
      }
      let themePath: string;
      try {
        themePath = resolveThemePathBySlug(wpRoot, theme.name);
      } catch {
        continue;
      }
      const tokens = loadThemeJsonFromSlug(wpRoot, theme.name);
      const scored = scoreThemeAgainstVisualIntent(tokens, visualIntent);
      if (scored.score <= 0) {
        continue;
      }
      candidates.push({
        slug: theme.name,
        path: themePath,
        score: scored.score,
        confidence: scored.confidence,
        reasons: scored.reasons
      });
    }

    return candidates
      .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
      .filter((candidate) => candidate.score >= minConfidenceScore);
  }

  function resolveThemeForBridge(input: {
    wpRoot?: string;
    themeSlug?: string;
    themePath?: string;
    siteUrl?: string;
    blogId?: number;
    visualIntent?: VisualIntent;
    componentHint?: string;
  }): {
    profile: ThemeProfileResult | null;
    resolution: ThemeResolution | { mode: "pending_selection" };
    requiresThemeSelection: boolean;
    themeCandidates: ThemeCandidate[];
  } {
    const wpRoot = resolveWpRootInput(input.wpRoot);
    const siteUrl = normalizeOptionalString(input.siteUrl);
    const blogId = normalizeOptionalBlogId(input.blogId);
    const themeSlug = normalizeOptionalString(input.themeSlug);
    const themePathInput = normalizeOptionalString(input.themePath);
    const installedThemes = listInstalledThemes(wpRoot, siteUrl, blogId);
    const installedSlugs = installedThemes.map((theme) => theme.name).filter(Boolean);

    const buildProfile = (slug?: string, path?: string): ThemeProfileResult => getThemeProfile({
      wpRoot,
      themeSlug: slug,
      themePath: path,
      siteUrl: input.siteUrl,
      blogId: input.blogId
    });

    if (themeSlug || themePathInput) {
      const profile = buildProfile(themeSlug, themePathInput);
      const resolution: ThemeResolution = themePathInput
        ? { mode: "explicit_path", themePath: profile.activeTheme.path }
        : { mode: "explicit_slug", themeSlug: profile.activeTheme.name };
      return {
        profile,
        resolution,
        requiresThemeSelection: false,
        themeCandidates: []
      };
    }

    const corpus = input.visualIntent
      ? collectRequestCorpus(input.visualIntent, input.componentHint)
      : (input.componentHint?.trim() ?? "");
    const textMatch = corpus ? inferThemeSlugFromText(corpus, installedSlugs) : null;
    if (textMatch) {
      const profile = buildProfile(textMatch.slug);
      return {
        profile,
        resolution: {
          mode: "text_match",
          themeSlug: textMatch.slug,
          matchedText: corpus
        },
        requiresThemeSelection: false,
        themeCandidates: []
      };
    }

    if (input.visualIntent) {
      const candidates = rankThemeCandidates(
        wpRoot,
        input.visualIntent,
        siteUrl,
        blogId
      );
      const top = candidates[0];
      const second = candidates[1];
      const clearWinner = Boolean(
        top
        && top.confidence === "high"
        && (!second || top.score - second.score >= 0.12)
      );

      if (clearWinner && top) {
        const profile = buildProfile(top.slug);
        return {
          profile,
          resolution: { mode: "best_match", themeSlug: top.slug, score: top.score },
          requiresThemeSelection: false,
          themeCandidates: candidates.slice(0, 5)
        };
      }

      if (candidates.length > 0) {
        return {
          profile: null,
          resolution: { mode: "pending_selection" },
          requiresThemeSelection: true,
          themeCandidates: candidates.slice(0, 5)
        };
      }
    }

    const customThemes = filterCustomThemes(installedSlugs);
    if (customThemes.length === 1) {
      const profile = buildProfile(customThemes[0]);
      return {
        profile,
        resolution: { mode: "text_match", themeSlug: customThemes[0], matchedText: "single custom theme" },
        requiresThemeSelection: false,
        themeCandidates: []
      };
    }

    if (installedSlugs.length === 1) {
      const profile = buildProfile(installedSlugs[0]);
      return {
        profile,
        resolution: { mode: "active_site", themeSlug: installedSlugs[0] },
        requiresThemeSelection: false,
        themeCandidates: []
      };
    }

    const active = resolveActiveTheme(wpRoot, siteUrl, blogId);
    const ambiguous = installedSlugs.length > 1;
    if (ambiguous) {
      return {
        profile: null,
        resolution: { mode: "pending_selection" },
        requiresThemeSelection: true,
        themeCandidates: installedThemes.slice(0, 5).map((theme) => ({
          slug: theme.name,
          path: "",
          score: theme.name === active.name ? 0.6 : 0.4,
          confidence: theme.name === active.name ? "medium" as const : "low" as const,
          reasons: theme.name === active.name
            ? ["Currently active theme"]
            : [`Installed theme (${theme.status})`]
        }))
      };
    }

    const profile = buildProfile(active.name);
    return {
      profile,
      resolution: { mode: "active_site", themeSlug: active.name },
      requiresThemeSelection: false,
      themeCandidates: []
    };
  }

  return {
    getThemeProfile,
    listInstalledThemes,
    rankThemeCandidates,
    resolveThemeForBridge
  };
}

export type ThemeProfileService = ReturnType<typeof createThemeProfileService>;
