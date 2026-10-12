import fs from "node:fs";
import path from "node:path";
import { internalDefaults } from "../config/runtime";

export type ThemeJsonPreset = {
  slug?: unknown;
  name?: unknown;
  size?: unknown;
  fontFamily?: unknown;
  fontSize?: unknown;
  spacingSize?: unknown;
  color?: unknown;
};

export type ThemeJsonData = {
  settings?: {
    color?: {
      palette?: ThemeJsonPreset[];
    };
    typography?: {
      fontFamilies?: ThemeJsonPreset[];
      fontSizes?: ThemeJsonPreset[];
    };
    spacing?: {
      spacingSizes?: ThemeJsonPreset[];
      spacingScale?: unknown[];
    };
    custom?: Record<string, unknown>;
  };
  styles?: {
    custom?: Record<string, unknown>;
  };
};

export type FileCaseStyle = "kebab-case" | "snake_case" | "camelCase" | "pascalCase" | "mixed" | "unknown";

export type StructuredColorToken = {
  slug: string;
  name: string;
  value: string;
  cssVar: string;
};

export type StructuredFontSizeToken = {
  slug: string;
  name: string;
  size: string;
  cssVar: string;
};

export type StructuredFontFamilyToken = {
  slug: string;
  name: string;
  fontFamily: string;
  cssVar: string;
};

export type StructuredSpacingToken = {
  slug: string;
  name: string;
  value: string;
  cssVar: string;
};

export type StructuredThemeTokens = {
  colors: StructuredColorToken[];
  fontSizes: StructuredFontSizeToken[];
  fontFamilies: StructuredFontFamilyToken[];
  spacing: StructuredSpacingToken[];
};

export function firstNonEmptyLine(raw: string): string {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? "";
}

export function safeReadText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function parseThemeJson(themeJsonPath: string): ThemeJsonData | null {
  if (!fs.existsSync(themeJsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(themeJsonPath, "utf8");
    const parsed = JSON.parse(raw) as ThemeJsonData;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function parseThemeJsonFromContent(content: string): ThemeJsonData | null {
  try {
    const parsed = JSON.parse(content) as ThemeJsonData;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePresetValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function extractPresetEntries(items: ThemeJsonPreset[] | undefined, valueKeys: Array<keyof ThemeJsonPreset>): string[] {
  if (!items?.length) {
    return [];
  }

  const results = new Set<string>();
  for (const item of items) {
    const slug = normalizePresetValue(item.slug);
    const name = normalizePresetValue(item.name);
    const value = valueKeys
      .map((key) => normalizePresetValue(item[key]))
      .find((candidate) => candidate !== null);

    const fragments = [slug, name, value].filter((fragment): fragment is string => Boolean(fragment));
    if (fragments.length > 0) {
      results.add(fragments.join("|"));
    }
  }

  return Array.from(results).sort();
}

function presetSlug(item: ThemeJsonPreset): string {
  return normalizePresetValue(item.slug) ?? normalizePresetValue(item.name) ?? "unknown";
}

function presetName(item: ThemeJsonPreset): string {
  return normalizePresetValue(item.name) ?? normalizePresetValue(item.slug) ?? "unknown";
}

export function buildStructuredTokens(themeJson: ThemeJsonData | null): StructuredThemeTokens {
  const colors: StructuredColorToken[] = [];
  for (const item of themeJson?.settings?.color?.palette ?? []) {
    const slug = presetSlug(item);
    const name = presetName(item);
    const value = normalizePresetValue(item.color);
    if (!value) {
      continue;
    }
    colors.push({
      slug,
      name,
      value,
      cssVar: `var(--wp--preset--color--${slug})`
    });
  }

  const fontSizes: StructuredFontSizeToken[] = [];
  for (const item of themeJson?.settings?.typography?.fontSizes ?? []) {
    const slug = presetSlug(item);
    const name = presetName(item);
    const size = normalizePresetValue(item.size) ?? normalizePresetValue(item.fontSize);
    if (!size) {
      continue;
    }
    fontSizes.push({
      slug,
      name,
      size,
      cssVar: `var(--wp--preset--font-size--${slug})`
    });
  }

  const fontFamilies: StructuredFontFamilyToken[] = [];
  for (const item of themeJson?.settings?.typography?.fontFamilies ?? []) {
    const slug = presetSlug(item);
    const name = presetName(item);
    const fontFamily = normalizePresetValue(item.fontFamily);
    if (!fontFamily) {
      continue;
    }
    fontFamilies.push({
      slug,
      name,
      fontFamily,
      cssVar: `var(--wp--preset--font-family--${slug})`
    });
  }

  const spacing: StructuredSpacingToken[] = [];
  for (const item of themeJson?.settings?.spacing?.spacingSizes ?? []) {
    const slug = presetSlug(item);
    const name = presetName(item);
    const value = normalizePresetValue(item.spacingSize) ?? normalizePresetValue(item.size);
    if (!value) {
      continue;
    }
    spacing.push({
      slug,
      name,
      value,
      cssVar: `var(--wp--preset--spacing--${slug})`
    });
  }
  for (const raw of themeJson?.settings?.spacing?.spacingScale ?? []) {
    const value = normalizePresetValue(raw);
    if (!value) {
      continue;
    }
    const slug = value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    spacing.push({
      slug,
      name: slug,
      value,
      cssVar: `var(--wp--preset--spacing--${slug})`
    });
  }

  return {
    colors: colors.sort((a, b) => a.slug.localeCompare(b.slug)),
    fontSizes: fontSizes.sort((a, b) => a.slug.localeCompare(b.slug)),
    fontFamilies: fontFamilies.sort((a, b) => a.slug.localeCompare(b.slug)),
    spacing: spacing.sort((a, b) => a.slug.localeCompare(b.slug))
  };
}

function getTopLevelKeys(record: Record<string, unknown> | undefined): string[] {
  if (!record || typeof record !== "object") {
    return [];
  }
  return Object.keys(record).sort();
}

export function listFilesRecursively(rootDir: string, options?: { exts?: string[]; maxFiles?: number }): string[] {
  const files: string[] = [];
  const stack = [rootDir];
  const maxFiles = options?.maxFiles ?? 500;
  const exts = options?.exts?.map((ext) => ext.toLowerCase()) ?? [];

  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (exts.length > 0) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!exts.includes(ext)) {
          continue;
        }
      }
      files.push(fullPath);
      if (files.length >= maxFiles) {
        break;
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

export function relativeToRoot(rootDir: string, targetPath: string): string {
  return path.relative(rootDir, targetPath).replace(/\\/gu, "/");
}

export function gatherHelperFiles(themePath: string): string[] {
  if (!internalDefaults.helperPlugin.enabled) {
    return [];
  }
  const helperFiles = new Set<string>();
  const directHelpers = internalDefaults.helperPlugin.directHelperFiles;
  for (const fileName of directHelpers) {
    const fullPath = path.join(themePath, fileName);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      helperFiles.add(relativeToRoot(themePath, fullPath));
    }
  }

  const helperDirs = internalDefaults.helperPlugin.helperDirectories;
  for (const helperDir of helperDirs) {
    const fullPath = path.join(themePath, helperDir);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const phpFiles = listFilesRecursively(fullPath, {
        exts: [".php"],
        maxFiles: internalDefaults.helperPlugin.helperPhpMaxFiles
      });
      for (const phpFile of phpFiles) {
        helperFiles.add(relativeToRoot(themePath, phpFile));
      }
    }
  }

  return Array.from(helperFiles).sort();
}

export function extractPhpFunctions(themePath: string, helperFiles: string[]): string[] {
  const functionNames = new Set<string>();
  const fnRegex = /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu;

  for (const relPath of helperFiles) {
    const fullPath = path.join(themePath, relPath);
    const content = safeReadText(fullPath);
    if (!content) {
      continue;
    }
    for (const match of content.matchAll(fnRegex)) {
      if (match[1]) {
        functionNames.add(match[1]);
      }
    }
  }

  return Array.from(functionNames).sort();
}

export function detectConventionDirectories(themePath: string): {
  components: string[];
  partials: string[];
  helpers: string[];
} {
  const candidates = {
    components: ["components", "component", "blocks", "modules", "parts"],
    partials: ["partials", "partial", "template-parts", "templates/parts", "patterns"],
    helpers: internalDefaults.helperPlugin.helperDirectories
  };

  const result = {
    components: [] as string[],
    partials: [] as string[],
    helpers: [] as string[]
  };

  for (const dirName of candidates.components) {
    const dirPath = path.join(themePath, dirName);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      result.components.push(relativeToRoot(themePath, dirPath));
    }
  }
  for (const dirName of candidates.partials) {
    const dirPath = path.join(themePath, dirName);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      result.partials.push(relativeToRoot(themePath, dirPath));
    }
  }
  for (const dirName of candidates.helpers) {
    const dirPath = path.join(themePath, dirName);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      result.helpers.push(relativeToRoot(themePath, dirPath));
    }
  }

  result.components.sort();
  result.partials.sort();
  result.helpers.sort();
  return result;
}

export function flattenConventionDirectories(detected: ReturnType<typeof detectConventionDirectories>): string[] {
  return Array.from(new Set([
    ...detected.components,
    ...detected.partials,
    ...detected.helpers
  ])).sort();
}

export function inferFileCaseStyle(fileNames: string[]): FileCaseStyle {
  const counters: Record<Exclude<FileCaseStyle, "mixed" | "unknown">, number> = {
    "kebab-case": 0,
    snake_case: 0,
    camelCase: 0,
    pascalCase: 0
  };

  for (const fileName of fileNames) {
    const bare = fileName.replace(/\.[^.]+$/u, "");
    if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(bare)) {
      counters["kebab-case"] += 1;
      continue;
    }
    if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/u.test(bare)) {
      counters.snake_case += 1;
      continue;
    }
    if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/u.test(bare)) {
      counters.camelCase += 1;
      continue;
    }
    if (/^[A-Z][A-Za-z0-9]*$/u.test(bare)) {
      counters.pascalCase += 1;
    }
  }

  const entries = Object.entries(counters).sort((a, b) => b[1] - a[1]);
  const [topStyle, topCount] = entries[0] as [Exclude<FileCaseStyle, "mixed" | "unknown">, number];
  const secondCount = entries[1]?.[1] ?? 0;

  if (topCount === 0) {
    return "unknown";
  }
  if (topCount === secondCount) {
    return "mixed";
  }
  return topStyle;
}

export function extractFunctionPrefixes(functionNames: string[]): string[] {
  const prefixCounts = new Map<string, number>();

  for (const fnName of functionNames) {
    const firstUnderscore = fnName.indexOf("_");
    if (firstUnderscore <= 1) {
      continue;
    }
    const prefix = fnName.slice(0, firstUnderscore);
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

  return Array.from(prefixCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([prefix]) => prefix)
    .sort();
}

export function extractCssVarPrefixes(themePath: string): string[] {
  const cssFiles = listFilesRecursively(themePath, { exts: [".css"], maxFiles: 300 });
  const varTokenRegex = /--([a-z0-9-]+)/gu;
  const prefixes = new Set<string>();

  for (const cssFile of cssFiles) {
    const content = safeReadText(cssFile);
    if (!content) {
      continue;
    }

    for (const match of content.matchAll(varTokenRegex)) {
      const token = match[1];
      if (!token) {
        continue;
      }
      const segments = token.split("-").filter((segment) => segment.length > 0);
      if (segments.length === 0) {
        continue;
      }
      if (segments[0] === "wp" && segments.length >= 2) {
        prefixes.add(`wp-${segments[1]}`);
      } else if (segments.length >= 2) {
        prefixes.add(`${segments[0]}-${segments[1]}`);
      } else {
        prefixes.add(segments[0]);
      }
    }
  }

  return Array.from(prefixes).sort();
}

export type ScssSpacingConventions = {
  spacerBasePx?: number;
  usesRfsValue: boolean;
  globalLayoutSelectors: string[];
};

export function extractScssSpacingConventions(themePath: string): ScssSpacingConventions {
  const scssFiles = listFilesRecursively(themePath, { exts: [".scss", ".sass"], maxFiles: 400 });
  let spacerBasePx: number | undefined;
  let usesRfsValue = false;
  const globalLayoutSelectors = new Set<string>();

  const spacerRegex = /\$spacer\s*:\s*([\d.]+)\s*(px|rem)?/giu;
  const rfsRegex = /rfs-value\s*\(/iu;
  const selectorRegex = /#([a-z0-9-]+)/giu;

  for (const scssFile of scssFiles) {
    const content = safeReadText(scssFile);
    if (!content) {
      continue;
    }

    if (rfsRegex.test(content)) {
      usesRfsValue = true;
    }

    for (const match of content.matchAll(spacerRegex)) {
      const amount = Number.parseFloat(match[1] ?? "");
      const unit = (match[2] ?? "px").toLowerCase();
      if (!Number.isFinite(amount)) {
        continue;
      }
      spacerBasePx = unit === "rem" ? amount * 16 : amount;
    }

    if (content.includes("#content-wrapper")) {
      globalLayoutSelectors.add("#content-wrapper");
    }
    for (const match of content.matchAll(selectorRegex)) {
      const selector = `#${match[1] ?? ""}`;
      if (selector.includes("wrapper") || selector.includes("layout") || selector.includes("content")) {
        globalLayoutSelectors.add(selector);
      }
    }
  }

  return {
    spacerBasePx,
    usesRfsValue,
    globalLayoutSelectors: Array.from(globalLayoutSelectors).sort().slice(0, 8)
  };
}

export function buildThemeProfileFromPath(
  themePath: string,
  themeName: string,
  isBlockTheme: boolean
): {
  activeTheme: { name: string; path: string; isBlockTheme: boolean };
  tokens: {
    colors: string[];
    typography: string[];
    spacing: string[];
    customNamespaces: string[];
  };
  tokensStructured: StructuredThemeTokens;
  helpers: { files: string[]; notableFunctions: string[] };
  conventions: {
    naming: { dominantFileCase: FileCaseStyle; phpFunctionPrefixes: string[] };
    directories: string[];
    directoriesByKind: ReturnType<typeof detectConventionDirectories>;
    cssVarPrefixes: string[];
    scssSpacing: ScssSpacingConventions;
  };
} {
  const themeJsonPath = path.join(themePath, "theme.json");
  const themeJson = parseThemeJson(themeJsonPath);

  const colors = extractPresetEntries(themeJson?.settings?.color?.palette, ["color"]);
  const typography = [
    ...extractPresetEntries(themeJson?.settings?.typography?.fontFamilies, ["fontFamily"]),
    ...extractPresetEntries(themeJson?.settings?.typography?.fontSizes, ["fontSize", "size"])
  ].sort();
  const spacing = [
    ...extractPresetEntries(themeJson?.settings?.spacing?.spacingSizes, ["spacingSize", "size"]),
    ...(themeJson?.settings?.spacing?.spacingScale ?? [])
      .map((value) => normalizePresetValue(value))
      .filter((value): value is string => value !== null)
  ].sort();

  const helperFiles = gatherHelperFiles(themePath);
  const notableFunctions = extractPhpFunctions(themePath, helperFiles);
  const detectedDirectories = detectConventionDirectories(themePath);
  const cssVarPrefixes = extractCssVarPrefixes(themePath);
  const scssSpacing = extractScssSpacingConventions(themePath);

  const sampleThemeFileNames = listFilesRecursively(themePath, { maxFiles: 300 })
    .map((fullPath) => path.basename(fullPath));
  const dominantFileCase = inferFileCaseStyle(sampleThemeFileNames);
  const phpFunctionPrefixes = extractFunctionPrefixes(notableFunctions);

  const customNamespaces = Array.from(
    new Set([
      ...getTopLevelKeys(themeJson?.settings?.custom),
      ...getTopLevelKeys(themeJson?.styles?.custom)
    ])
  ).sort();

  return {
    activeTheme: {
      name: themeName,
      path: themePath,
      isBlockTheme
    },
    tokens: {
      colors,
      typography,
      spacing,
      customNamespaces
    },
    tokensStructured: buildStructuredTokens(themeJson),
    helpers: {
      files: helperFiles,
      notableFunctions
    },
    conventions: {
      naming: {
        dominantFileCase,
        phpFunctionPrefixes
      },
      directories: flattenConventionDirectories(detectedDirectories),
      directoriesByKind: detectedDirectories,
      cssVarPrefixes,
      scssSpacing
    }
  };
}
