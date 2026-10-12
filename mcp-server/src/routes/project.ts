import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import BetterSqlite3 from "better-sqlite3";
import { AppError, sendError } from "../errors";
import { internalDefaults } from "../config/runtime";
import { buildIndexFromFilesystem, getIndexPaths, initializeIndexAndGetStatus } from "../indexStore";
import { assertWithinRoot, resolveWpRoot, wpRootLooksValid } from "../sandbox";
import { runWpCli } from "../wpCli";
import {
  formatContentHint,
  getFilesystemScanRoots,
  resolveWordPressContentPaths,
  type WordPressContentPaths
} from "../wordpressContentPaths";
import type { ProjectServices } from "../services";
import { formatWordpressConnectResponse, type ConnectWordpressInput } from "../services/wordpressService";
import { type ToolDispatcher } from "../tools/dispatcher";

type ProjectRouterDeps = {
  configuredWpRoot: string;
  wpCli: string;
  phpBin: string;
  services: ProjectServices;
  toolDispatcher?: ToolDispatcher;
};
type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

type BuildIndexRequest = {
  wpRoot?: string;
  limit?: number;
  mode?: "full" | "filesystem-only" | "content-only";
};

type ApplyPatchRequest = {
  wpRoot?: string;
  patch?: string;
};

type SearchSimilarRequest = {
  wpRoot?: string;
  query?: unknown;
  componentName?: unknown;
  className?: unknown;
  classNames?: unknown;
  blockNames?: unknown;
  snippet?: unknown;
  limit?: unknown;
};

type WhereIsUsedKind = "class" | "block" | "shortcode" | "function" | "template" | "pattern" | "string" | "auto";

type WhereIsUsedRequest = {
  wpRoot?: string;
  query?: unknown;
  kind?: unknown;
  scope?: unknown;
  limitPerGroup?: unknown;
};

type FsReadRequest = {
  wpRoot?: string;
  path?: string;
  maxBytes?: number;
};

type FsSearchRequest = {
  wpRoot?: string;
  query?: string;
  path?: string;
  glob?: string;
  isRegex?: boolean;
  limit?: number;
};

type ToolCallRequest = {
  tool?: unknown;
  input?: unknown;
};

type ComponentKind = "block" | "pattern" | "template" | "content";

type ComponentQuerySpecInput = {
  name?: unknown;
  componentName?: unknown;
  variantHints?: unknown;
  variants?: unknown;
  typeHints?: unknown;
  types?: unknown;
  blockNames?: unknown;
  classNames?: unknown;
  componentLabels?: unknown;
  snippet?: unknown;
};

type ComponentQuerySpec = {
  name: string;
  variantHints: string[];
  typeHints: ComponentKind[];
  blockNames: string[];
  classNames: string[];
  componentLabels: string[];
  snippet: string;
};

type AuditComponentRequest = {
  wpRoot?: string;
  component_query?: unknown;
  componentQuerySpec?: unknown;
  query?: unknown;
  limit?: unknown;
};

type BlockCandidateRow = {
  id: string;
  name: string;
  sourceType: string;
  path: string;
  attrsJson: string | null;
  stylesJson: string | null;
  variationsJson: string | null;
};

type ContentCandidateRow = {
  postId: number;
  postType: string;
  title: string | null;
  markerSignature: string | null;
  blockFingerprint: string | null;
  contentSearchText: string | null;
};

type PostmetaCandidateRow = {
  id: string;
  postId: number;
  metaKey: string;
  content: string;
  markerSignature: string | null;
};

type OptionCandidateRow = {
  id: string;
  optionName: string;
  content: string;
  markerSignature: string | null;
};

type MenuCandidateRow = {
  id: string;
  postId: number;
  title: string | null;
  content: string;
  markerSignature: string | null;
};

type PatternCandidateRow = {
  id: string;
  slug: string;
  title: string;
  path: string;
  markerSignature: string | null;
  blockFingerprint: string | null;
};

type TemplateCandidateRow = {
  id: string;
  type: string;
  path: string;
  includesJson: string | null;
  blockFingerprint: string | null;
};

type ContentSearchMatch = {
  postId: number;
  postType: string;
  title: string;
  slug: string | null;
  url: string | null;
  identifier: string;
  score: number;
  snippet: string;
  reason: string;
  confidence: number;
  reasons: string[];
};

type PatternSearchMatch = {
  id: string;
  slug: string;
  title: string;
  path: string;
  identifier: string;
  score: number;
  snippet: string;
  reason: string;
  confidence: number;
  reasons: string[];
};

type TemplateSearchMatch = {
  id: string;
  type: string;
  path: string;
  identifier: string;
  score: number;
  snippet: string;
  reason: string;
  confidence: number;
  reasons: string[];
};

type PostmetaSearchMatch = {
  id: string;
  postId: number;
  metaKey: string;
  identifier: string;
  score: number;
  snippet: string;
  reason: string;
  preview: string;
  confidence: number;
  reasons: string[];
};

type OptionSearchMatch = {
  id: string;
  optionName: string;
  identifier: string;
  score: number;
  snippet: string;
  reason: string;
  preview: string;
  confidence: number;
  reasons: string[];
};

type MenuSearchMatch = {
  id: string;
  postId: number;
  title: string;
  identifier: string;
  score: number;
  snippet: string;
  reason: string;
  preview: string;
  confidence: number;
  reasons: string[];
};

type CustomTableSearchMatch = {
  sourceName: string;
  rowId: string;
  identifier: string;
  score: number;
  snippet: string;
  reason: string;
  confidence: number;
  reasons: string[];
};

type FileSearchMatch = {
  path: string;
  confidence: number;
  reasons: string[];
};

type PatchLineKind = "context" | "add" | "remove";

type ParsedPatchLine = {
  kind: PatchLineKind;
  value: string;
};

type ParsedPatchHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedPatchLine[];
};

type ParsedPatchFile = {
  oldPath: string | null;
  newPath: string | null;
  hunks: ParsedPatchHunk[];
};

type AtomicPreparedWrite = {
  targetPath: string;
  tempPath: string;
};

type AtomicBackupEntry = {
  targetPath: string;
  backupPath: string;
};

type ApplyPatchCheck = {
  name: string;
  ok: boolean;
  file?: string;
  command?: string;
  output?: string;
};

type ApplyPatchPlan = {
  writes: Map<string, string>;
  deletes: Set<string>;
  filesChanged: string[];
  lintTargets: string[];
};

type ThemeJsonPreset = {
  slug?: unknown;
  name?: unknown;
  size?: unknown;
  fontFamily?: unknown;
  fontSize?: unknown;
  spacingSize?: unknown;
  color?: unknown;
};

type ThemeJsonData = {
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

type FileCaseStyle = "kebab-case" | "snake_case" | "camelCase" | "pascalCase" | "mixed" | "unknown";

type AuditCandidate = {
  type: ComponentKind;
  id: string;
  path: string | null;
  score: number;
  reasons: string[];
  variantHits: string[];
  enableSteps: string[];
  markerSignature?: string | null;
  blockFingerprint?: string | null;
  patternSlug?: string | null;
  usage?: UsageEntry[];
};

type UsageKind = "page" | "post" | "cpt" | "pattern" | "template" | "template-part";
type UsageReason = "marker match" | "pattern ref" | "fingerprint match";

type UsageEntry = {
  kind: UsageKind;
  identifier: string;
  title?: string;
  reason: UsageReason;
};

type UsageIndexes = {
  contentByMarker: Map<string, UsageEntry[]>;
  contentByFingerprint: Map<string, UsageEntry[]>;
  templatesByMarker: Map<string, UsageEntry[]>;
  templatesByFingerprint: Map<string, UsageEntry[]>;
  patternsByMarker: Map<string, UsageEntry[]>;
  patternsByFingerprint: Map<string, UsageEntry[]>;
  patternRefsBySlug: Map<string, UsageEntry[]>;
};

type VariantMechanismId =
  | "block_styles"
  | "block_variations"
  | "pattern_variants"
  | "template_part_variants"
  | "css_modifiers";

type VariantMechanismSummary = {
  id: VariantMechanismId;
  count: number;
  reasons: string[];
};

type VariantEvidence = {
  variant: string;
  mechanism: VariantMechanismId;
  reasons: string[];
};

type VariantInsights = {
  existing: string[];
  missing: string[];
  existingDetails: VariantEvidence[];
  missingDetails: Array<{ variant: string; reasons: string[] }>;
  recommendedMechanism: {
    id: VariantMechanismId;
    reasons: string[];
  };
  mechanismStats: VariantMechanismSummary[];
};

type RecommendationAction = "reuse" | "extend" | "create";
type LowestRiskApproach = "pattern" | "style" | "variation" | "template-part" | "new-block";

type AuditPublicBestMatch = {
  type: ComponentKind;
  id: string;
  path: string | null;
  enableSteps: string[];
  usageCount: number;
  reasons: string[];
};

type AuditComponentPublicResult = {
  verdict: "exists" | "partial" | "missing";
  bestMatch: AuditPublicBestMatch | null;
  variants: {
    existing: string[];
    missing: string[];
    recommendedMechanism: {
      id: VariantMechanismId;
      reason: string;
    };
  };
  usage: {
    content: {
      count: number;
      matches: Array<{ id: string; score: number; reasons: string[] }>;
    };
    patterns: {
      count: number;
      matches: Array<{ id: string; path: string | null; score: number; reasons: string[] }>;
    };
    templates: {
      count: number;
      matches: Array<{ id: string; path: string | null; score: number; reasons: string[] }>;
    };
  };
  recommendation: {
    action: RecommendationAction;
    approach: LowestRiskApproach;
    rationale: string;
  };
};

type SimilarContentPublicResult = {
  queryEcho: {
    query: string;
    classNames: string[];
    blockNames: string[];
    snippet: string;
    limit: number;
  };
  matches: {
    content: Array<{
      sourceType: "content";
      id: string;
      identifier: string;
      postType: string;
      title: string;
      slug: string | null;
      url: string | null;
      snippet: string;
      score: number;
      reason: string;
      preview: string;
      confidence: number;
      reasons: string[];
    }>;
    postmeta: Array<{
      sourceType: "postmeta";
      id: string;
      identifier: string;
      postId: string;
      metaKey: string;
      snippet: string;
      score: number;
      reason: string;
      preview: string;
      confidence: number;
      reasons: string[];
    }>;
    options: Array<{
      sourceType: "options";
      id: string;
      identifier: string;
      optionName: string;
      snippet: string;
      score: number;
      reason: string;
      preview: string;
      confidence: number;
      reasons: string[];
    }>;
    menus: Array<{
      sourceType: "menus";
      id: string;
      identifier: string;
      postId: string;
      title: string;
      snippet: string;
      score: number;
      reason: string;
      preview: string;
      confidence: number;
      reasons: string[];
    }>;
    patterns: Array<{
      sourceType: "patterns";
      id: string;
      identifier: string;
      slug: string;
      title: string;
      path: string;
      snippet: string;
      score: number;
      reason: string;
      confidence: number;
      reasons: string[];
    }>;
    templates: Array<{
      sourceType: "templates";
      id: string;
      identifier: string;
      type: string;
      path: string;
      snippet: string;
      score: number;
      reason: string;
      confidence: number;
      reasons: string[];
    }>;
    customTables: Array<{
      sourceType: "custom_tables";
      sourceName: string;
      rowId: string;
      identifier: string;
      snippet: string;
      score: number;
      reason: string;
      confidence: number;
      reasons: string[];
    }>;
    files: Array<{
      path: string;
      confidence: number;
      reasons: string[];
    }>;
  };
};

type WhereIsUsedPublicResult = {
  query: string;
  detectedKind: Exclude<WhereIsUsedKind, "auto">;
  summary: {
    totalMatches: number;
    groupsWithMatches: string[];
  };
  groups: {
    templates: Array<Record<string, unknown>>;
    patterns: Array<Record<string, unknown>>;
    files: Array<Record<string, unknown>>;
    content: Array<Record<string, unknown>>;
    menus: Array<Record<string, unknown>>;
    postmeta: Array<Record<string, unknown>>;
    options: Array<Record<string, unknown>>;
    customTables: Array<Record<string, unknown>>;
  };
  recommendation: string;
};

const TYPE_HINT_ALIASES: Record<string, ComponentKind> = {
  block: "block",
  blocks: "block",
  pattern: "pattern",
  patterns: "pattern",
  template: "template",
  templates: "template",
  content: "content",
  post: "content",
  posts: "content"
};

const COMPONENT_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "with",
  "in",
  "on",
  "at",
  "to",
  "from",
  "of",
  "component",
  "variant",
  "version",
  "please",
  "find",
  "need",
  "show",
  "audit"
]);

const SOURCE_BASE_WEIGHTS = {
  files: 1,
  templates: 1,
  patterns: 1,
  content: 0.9,
  menus: 0.8,
  postmeta: 0.6,
  custom_tables: 0.5,
  options: 0.3
} as const;

const WP_INTERNAL_META_KEYS = new Set([
  "_edit_lock",
  "_edit_last",
  "_wp_page_template",
  "_thumbnail_id",
  "_menu_item_menu_item_parent",
  "_menu_item_type",
  "_menu_item_object",
  "_menu_item_object_id",
  "_menu_item_url",
  "_menu_item_xfn",
  "_menu_item_classes",
  "_wp_old_slug",
  "_wp_attachment_metadata",
  "_wp_attached_file"
]);

const BASIC_VARIANT_HINTS = new Set([
  "compact",
  "dark",
  "sticky"
]);

const COMPONENT_KIND_ORDER: ComponentKind[] = ["block", "pattern", "template", "content"];
const STRONG_MATCH_SCORE_THRESHOLD = 0.72;
const PARTIAL_MATCH_SCORE_THRESHOLD = 0.4;
const MECHANISM_ORDER: VariantMechanismId[] = [
  "block_styles",
  "block_variations",
  "pattern_variants",
  "template_part_variants",
  "css_modifiers"
];

const TEMPLATE_PART_BASE_NAMES = new Set([
  "header",
  "footer",
  "sidebar",
  "comments",
  "post-meta",
  "navigation",
  "nav"
]);

function summarizeRecommendedMechanismReason(variantInsights: VariantInsights): string {
  return variantInsights.recommendedMechanism.reasons[0]
    ?? "Recommended from observed variant mechanisms in this project.";
}

function formatAuditComponentPublicResult(input: {
  verdict: "exists" | "partial" | "missing";
  bestCandidate: AuditCandidate | null;
  variantInsights: VariantInsights;
  usage: AuditComponentPublicResult["usage"];
  recommendationAction: RecommendationAction;
  lowestRiskApproach: LowestRiskApproach;
  recommendationWhy: string;
}): AuditComponentPublicResult {
  const usageCount = input.bestCandidate?.usage?.length ?? 0;
  return {
    verdict: input.verdict,
    bestMatch: input.bestCandidate
      ? {
        type: input.bestCandidate.type,
        id: input.bestCandidate.id,
        path: input.bestCandidate.path,
        enableSteps: input.bestCandidate.enableSteps,
        usageCount,
        reasons: input.bestCandidate.reasons
      }
      : null,
    variants: {
      existing: input.variantInsights.existing,
      missing: input.variantInsights.missing,
      recommendedMechanism: {
        id: input.variantInsights.recommendedMechanism.id,
        reason: summarizeRecommendedMechanismReason(input.variantInsights)
      }
    },
    usage: input.usage,
    recommendation: {
      action: input.recommendationAction,
      approach: input.lowestRiskApproach,
      rationale: input.recommendationWhy
    }
  };
}

function formatFindSimilarPublicResult(input: {
  queryEcho: SimilarContentPublicResult["queryEcho"];
  contentMatches: ContentSearchMatch[];
  postmetaMatches: PostmetaSearchMatch[];
  optionMatches: OptionSearchMatch[];
  menuMatches: MenuSearchMatch[];
  patternMatches: PatternSearchMatch[];
  templateMatches: TemplateSearchMatch[];
  customTableMatches: CustomTableSearchMatch[];
  files: FileSearchMatch[];
}): SimilarContentPublicResult {
  return {
    queryEcho: input.queryEcho,
    matches: {
      content: input.contentMatches.map((match) => ({
        sourceType: "content",
        id: String(match.postId),
        identifier: match.identifier,
        postType: match.postType,
        title: match.title,
        slug: match.slug,
        url: match.url,
        snippet: match.snippet,
        score: match.score,
        reason: match.reason,
        preview: match.snippet,
        confidence: match.confidence,
        reasons: match.reasons
      })),
      postmeta: input.postmetaMatches.map((match) => ({
        sourceType: "postmeta",
        id: match.id,
        identifier: match.identifier,
        postId: String(match.postId),
        metaKey: match.metaKey,
        snippet: match.snippet,
        score: match.score,
        reason: match.reason,
        preview: match.preview,
        confidence: match.confidence,
        reasons: match.reasons
      })),
      options: input.optionMatches.map((match) => ({
        sourceType: "options",
        id: match.id,
        identifier: match.identifier,
        optionName: match.optionName,
        snippet: match.snippet,
        score: match.score,
        reason: match.reason,
        preview: match.preview,
        confidence: match.confidence,
        reasons: match.reasons
      })),
      menus: input.menuMatches.map((match) => ({
        sourceType: "menus",
        id: match.id,
        identifier: match.identifier,
        postId: String(match.postId),
        title: match.title,
        snippet: match.snippet,
        score: match.score,
        reason: match.reason,
        preview: match.preview,
        confidence: match.confidence,
        reasons: match.reasons
      })),
      patterns: input.patternMatches.map((match) => ({
        sourceType: "patterns",
        id: match.id,
        identifier: match.identifier,
        slug: match.slug,
        title: match.title,
        path: match.path,
        snippet: match.snippet,
        score: match.score,
        reason: match.reason,
        confidence: match.confidence,
        reasons: match.reasons
      })),
      templates: input.templateMatches.map((match) => ({
        sourceType: "templates",
        id: match.id,
        identifier: match.identifier,
        type: match.type,
        path: match.path,
        snippet: match.snippet,
        score: match.score,
        reason: match.reason,
        confidence: match.confidence,
        reasons: match.reasons
      })),
      customTables: input.customTableMatches.map((match) => ({
        sourceType: "custom_tables",
        sourceName: match.sourceName,
        rowId: match.rowId,
        identifier: match.identifier,
        snippet: match.snippet,
        score: match.score,
        reason: match.reason,
        confidence: match.confidence,
        reasons: match.reasons
      })),
      files: input.files.map((match) => ({
        path: match.path,
        confidence: match.confidence,
        reasons: match.reasons
      }))
    }
  };
}

function toRelativeWpPath(wpRoot: string, absolutePath: string): string {
  return path.relative(wpRoot, absolutePath).split(path.sep).join("/");
}

function isProtectedPatchPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/gu, "/").replace(/^\.\/+/u, "").toLowerCase();
  return internalDefaults.patch.protectedPaths.some((protectedPath) => normalized === protectedPath.toLowerCase());
}

function resolvePatchPathWithinRoot(wpRoot: string, patchPath: string): string {
  if (path.isAbsolute(patchPath)) {
    throw new AppError("PATCH_PATH_OUTSIDE_ROOT", "Patch file paths must be relative to wpRoot.", 400, {
      path: patchPath
    });
  }
  try {
    return assertWithinRoot(wpRoot, path.join(wpRoot, patchPath), "patch path");
  } catch (error) {
    if (error instanceof AppError && error.code === "WP_ROOT_INVALID") {
      throw new AppError("PATCH_PATH_OUTSIDE_ROOT", "Patch file path must stay within wpRoot.", 400, {
        path: patchPath
      });
    }
    throw error;
  }
}

function normalizeDiffPath(rawPath: string): string | null {
  const trimmed = rawPath.split("\t")[0]?.trim() ?? "";
  if (!trimmed) {
    throw new AppError(
      "INVALID_PATCH_FORMAT",
      "Invalid unified diff: missing file path in diff header.",
      400
    );
  }
  if (trimmed === "/dev/null") {
    return null;
  }
  const withoutPrefix = trimmed.startsWith("a/") || trimmed.startsWith("b/")
    ? trimmed.slice(2)
    : trimmed;
  const normalized = withoutPrefix.replace(/^\.\/+/u, "");
  if (!normalized || path.isAbsolute(normalized)) {
    throw new AppError(
      "INVALID_PATCH_FORMAT",
      "Invalid unified diff: file paths must be relative.",
      400,
      { path: trimmed }
    );
  }
  return normalized;
}

function isDiffMetadataLine(line: string): boolean {
  return line.startsWith("diff --git ")
    || line.startsWith("index ")
    || line.startsWith("new file mode ")
    || line.startsWith("deleted file mode ")
    || line.startsWith("old mode ")
    || line.startsWith("new mode ")
    || line.startsWith("similarity index ")
    || line.startsWith("rename from ")
    || line.startsWith("rename to ")
    || line.startsWith("Binary files ");
}

function parseUnifiedDiff(patch: string): ParsedPatchFile[] {
  if (patch.trim().length === 0) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid `patch`. Provide a non-empty unified diff.", 400);
  }

  const lines = patch.replace(/\r\n/gu, "\n").split("\n");
  const files: ParsedPatchFile[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? "";
    if (!line.trim() || isDiffMetadataLine(line)) {
      lineIndex += 1;
      continue;
    }
    if (!line.startsWith("--- ")) {
      throw new AppError(
        "INVALID_PATCH_FORMAT",
        "Invalid unified diff: expected file header starting with `--- `.",
        400,
        { line: lineIndex + 1, value: line }
      );
    }

    const oldPath = normalizeDiffPath(line.slice(4));
    lineIndex += 1;

    const nextLine = lines[lineIndex] ?? "";
    if (!nextLine.startsWith("+++ ")) {
      throw new AppError(
        "INVALID_PATCH_FORMAT",
        "Invalid unified diff: expected file header starting with `+++ ` after `--- `.",
        400,
        { line: lineIndex + 1, value: nextLine }
      );
    }
    const newPath = normalizeDiffPath(nextLine.slice(4));
    if (!oldPath && !newPath) {
      throw new AppError(
        "INVALID_PATCH_FORMAT",
        "Invalid unified diff: file header cannot have both paths as `/dev/null`.",
        400
      );
    }
    lineIndex += 1;

    const hunks: ParsedPatchHunk[] = [];
    while (lineIndex < lines.length) {
      const current = lines[lineIndex] ?? "";
      if (current.startsWith("--- ") || current.startsWith("diff --git ")) {
        break;
      }
      if (!current.trim() || isDiffMetadataLine(current)) {
        lineIndex += 1;
        continue;
      }
      if (!current.startsWith("@@ ")) {
        throw new AppError(
          "INVALID_PATCH_FORMAT",
          "Invalid unified diff: expected hunk header starting with `@@ `.",
          400,
          { line: lineIndex + 1, value: current }
        );
      }

      const hunkMatch = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/u.exec(current);
      if (!hunkMatch) {
        throw new AppError(
          "INVALID_PATCH_FORMAT",
          "Invalid unified diff: malformed hunk header.",
          400,
          { line: lineIndex + 1, value: current }
        );
      }

      const oldStart = Number.parseInt(hunkMatch[1], 10);
      const oldCount = Number.parseInt(hunkMatch[2] ?? "1", 10);
      const newStart = Number.parseInt(hunkMatch[3], 10);
      const newCount = Number.parseInt(hunkMatch[4] ?? "1", 10);
      lineIndex += 1;

      const parsedLines: ParsedPatchLine[] = [];
      while (lineIndex < lines.length) {
        const hunkLine = lines[lineIndex] ?? "";
        if (hunkLine.startsWith("@@ ") || hunkLine.startsWith("--- ") || hunkLine.startsWith("diff --git ")) {
          break;
        }
        if (hunkLine === "\\ No newline at end of file") {
          lineIndex += 1;
          continue;
        }
        const prefix = hunkLine.charAt(0);
        const value = hunkLine.slice(1);
        if (prefix === " ") {
          parsedLines.push({ kind: "context", value });
        } else if (prefix === "+") {
          parsedLines.push({ kind: "add", value });
        } else if (prefix === "-") {
          parsedLines.push({ kind: "remove", value });
        } else {
          throw new AppError(
            "INVALID_PATCH_FORMAT",
            "Invalid unified diff: hunk lines must start with space, +, or -.",
            400,
            { line: lineIndex + 1, value: hunkLine }
          );
        }
        lineIndex += 1;
      }

      if (parsedLines.length === 0) {
        throw new AppError("INVALID_PATCH_FORMAT", "Invalid unified diff: empty hunk body.", 400);
      }

      const oldSeen = parsedLines.filter((item) => item.kind !== "add").length;
      const newSeen = parsedLines.filter((item) => item.kind !== "remove").length;
      if (oldSeen !== oldCount || newSeen !== newCount) {
        throw new AppError(
          "INVALID_PATCH_FORMAT",
          "Invalid unified diff: hunk line counts do not match header.",
          400,
          {
            line: lineIndex + 1,
            oldCount,
            newCount,
            oldSeen,
            newSeen
          }
        );
      }

      hunks.push({
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: parsedLines
      });
    }

    if (hunks.length === 0) {
      throw new AppError("INVALID_PATCH_FORMAT", "Invalid unified diff: each file must include at least one hunk.", 400);
    }

    files.push({
      oldPath,
      newPath,
      hunks
    });
  }

  if (files.length === 0) {
    throw new AppError("INVALID_PATCH_FORMAT", "Invalid unified diff: no file changes were found.", 400);
  }

  return files;
}

function applyHunksToContent(filePatch: ParsedPatchFile, currentContent: string): string {
  const normalized = currentContent.replace(/\r\n/gu, "\n");
  const sourceLines = normalized.length === 0 ? [] : normalized.split("\n");
  const nextLines: string[] = [];
  let sourceCursor = 0;

  for (const hunk of filePatch.hunks) {
    const targetIndex = Math.max(0, hunk.oldStart - 1);
    if (targetIndex < sourceCursor || targetIndex > sourceLines.length) {
      throw new AppError(
        "PATCH_APPLY_FAILED",
        "Patch hunk position is out of bounds.",
        400,
        {
          path: filePatch.newPath ?? filePatch.oldPath,
          oldStart: hunk.oldStart
        }
      );
    }

    nextLines.push(...sourceLines.slice(sourceCursor, targetIndex));
    sourceCursor = targetIndex;

    for (const line of hunk.lines) {
      if (line.kind === "add") {
        nextLines.push(line.value);
        continue;
      }

      const sourceLine = sourceLines[sourceCursor];
      if (sourceLine === undefined) {
        throw new AppError(
          "PATCH_APPLY_FAILED",
          "Patch hunk does not match source content.",
          400,
          {
            path: filePatch.newPath ?? filePatch.oldPath,
            expected: line.value,
            actual: null
          }
        );
      }
      if (sourceLine !== line.value) {
        throw new AppError(
          "PATCH_APPLY_FAILED",
          "Patch hunk does not match source content.",
          400,
          {
            path: filePatch.newPath ?? filePatch.oldPath,
            expected: line.value,
            actual: sourceLine
          }
        );
      }

      if (line.kind === "context") {
        nextLines.push(line.value);
      }
      sourceCursor += 1;
    }
  }

  nextLines.push(...sourceLines.slice(sourceCursor));
  return nextLines.join("\n");
}

function planPatchApply(wpRoot: string, files: ParsedPatchFile[]): ApplyPatchPlan {
  const writes = new Map<string, string>();
  const deletes = new Set<string>();
  const filesChanged = new Set<string>();
  const lintTargets = new Set<string>();

  for (const filePatch of files) {
    const oldAbsolute = filePatch.oldPath ? resolvePatchPathWithinRoot(wpRoot, filePatch.oldPath) : null;
    const newAbsolute = filePatch.newPath ? resolvePatchPathWithinRoot(wpRoot, filePatch.newPath) : null;
    const oldRelative = oldAbsolute ? toRelativeWpPath(wpRoot, oldAbsolute) : null;
    const newRelative = newAbsolute ? toRelativeWpPath(wpRoot, newAbsolute) : null;

    if ((oldRelative && isProtectedPatchPath(oldRelative)) || (newRelative && isProtectedPatchPath(newRelative))) {
      throw new AppError(
        "PATCH_APPLY_FAILED",
        "Patch targets a protected path and cannot be applied.",
        400,
        { path: newRelative ?? oldRelative }
      );
    }

    if (!oldAbsolute && newAbsolute && fs.existsSync(newAbsolute)) {
      throw new AppError(
        "PATCH_APPLY_FAILED",
        "Patch create target already exists.",
        400,
        { path: toRelativeWpPath(wpRoot, newAbsolute) }
      );
    }
    if (oldAbsolute && !fs.existsSync(oldAbsolute)) {
      throw new AppError(
        "PATCH_APPLY_FAILED",
        "Patch source file does not exist.",
        400,
        { path: toRelativeWpPath(wpRoot, oldAbsolute) }
      );
    }

    const sourceContent = oldAbsolute ? fs.readFileSync(oldAbsolute, "utf8") : "";
    const nextContent = applyHunksToContent(filePatch, sourceContent);

    if (!newAbsolute) {
      if (!oldAbsolute) {
        throw new AppError("PATCH_APPLY_FAILED", "Patch delete operation is missing source path.", 400);
      }
      deletes.add(oldAbsolute);
      writes.delete(oldAbsolute);
      filesChanged.add(toRelativeWpPath(wpRoot, oldAbsolute));
      continue;
    }

    writes.set(newAbsolute, nextContent);
    deletes.delete(newAbsolute);
    filesChanged.add(toRelativeWpPath(wpRoot, newAbsolute));
    if (newAbsolute.endsWith(".php")) {
      lintTargets.add(newAbsolute);
    }

    if (oldAbsolute && oldAbsolute !== newAbsolute) {
      deletes.add(oldAbsolute);
      filesChanged.add(toRelativeWpPath(wpRoot, oldAbsolute));
    }
  }

  for (const writePath of writes.keys()) {
    deletes.delete(writePath);
  }

  return {
    writes,
    deletes,
    filesChanged: Array.from(filesChanged).sort(),
    lintTargets: Array.from(lintTargets).sort()
  };
}

function prepareAtomicWrites(writes: Map<string, string>): AtomicPreparedWrite[] {
  const prepared: AtomicPreparedWrite[] = [];
  for (const [targetPath, content] of writes.entries()) {
    const directory = path.dirname(targetPath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = path.join(
      directory,
      `${internalDefaults.patch.tempFilePrefix}${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`
    );
    fs.writeFileSync(tempPath, content, "utf8");
    prepared.push({ targetPath, tempPath });
  }
  return prepared;
}

function rollbackAtomicApply(preparedWrites: AtomicPreparedWrite[], backups: AtomicBackupEntry[]): void {
  for (const prepared of preparedWrites) {
    if (fs.existsSync(prepared.targetPath)) {
      fs.rmSync(prepared.targetPath, { force: true });
    }
    if (fs.existsSync(prepared.tempPath)) {
      fs.rmSync(prepared.tempPath, { force: true });
    }
  }
  for (const backup of [...backups].reverse()) {
    if (fs.existsSync(backup.targetPath)) {
      fs.rmSync(backup.targetPath, { force: true });
    }
    if (fs.existsSync(backup.backupPath)) {
      fs.renameSync(backup.backupPath, backup.targetPath);
    }
  }
}

function runPhpLintChecks(wpRoot: string, lintTargets: string[], phpBin: string): ApplyPatchCheck[] {
  if (!internalDefaults.patch.phpLintEnabled) {
    return [];
  }
  const checks: ApplyPatchCheck[] = [];
  for (const lintPath of lintTargets) {
    if (!fs.existsSync(lintPath)) {
      continue;
    }
    const file = toRelativeWpPath(wpRoot, lintPath);
    const command = `${phpBin} -l ${file}`;
    try {
      const output = execFileSync(phpBin, ["-l", lintPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      checks.push({
        name: "php-lint",
        ok: true,
        file,
        command,
        output: output.trim()
      });
    } catch (error) {
      const lintError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
      const stdout = Buffer.isBuffer(lintError.stdout) ? lintError.stdout.toString("utf8") : lintError.stdout ?? "";
      const stderr = Buffer.isBuffer(lintError.stderr) ? lintError.stderr.toString("utf8") : lintError.stderr ?? "";
      checks.push({
        name: "php-lint",
        ok: false,
        file,
        command,
        output: [stdout.trim(), stderr.trim(), lintError.message ?? ""].filter(Boolean).join("\n")
      });
      throw new AppError(
        "PHP_LINT_FAILED",
        "PHP lint failed for one or more changed files.",
        400,
        { checks }
      );
    }
  }
  return checks;
}

function applyPatchAtomically(
  wpRoot: string,
  plan: ApplyPatchPlan,
  phpBin: string
): { applied: true; filesChanged: string[]; checks: ApplyPatchCheck[] } {
  const preparedWrites = prepareAtomicWrites(plan.writes);
  const backups: AtomicBackupEntry[] = [];
  const checks: ApplyPatchCheck[] = [];
  const affectedTargets = new Set<string>([...plan.writes.keys(), ...plan.deletes.values()]);

  try {
    for (const targetPath of affectedTargets) {
      if (!fs.existsSync(targetPath)) {
        continue;
      }
      const backupPath = `${targetPath}${internalDefaults.patch.backupFilePrefix}${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
      fs.renameSync(targetPath, backupPath);
      backups.push({ targetPath, backupPath });
    }

    for (const prepared of preparedWrites) {
      fs.renameSync(prepared.tempPath, prepared.targetPath);
    }

    checks.push({
      name: "atomic-write",
      ok: true,
      output: `Applied ${plan.writes.size} writes and ${plan.deletes.size} deletes via temp+rename.`
    });

    const lintChecks = runPhpLintChecks(wpRoot, plan.lintTargets, phpBin);
    checks.push(...lintChecks);

    for (const backup of backups) {
      if (fs.existsSync(backup.backupPath)) {
        fs.rmSync(backup.backupPath, { force: true });
      }
    }

    return {
      applied: true,
      filesChanged: plan.filesChanged,
      checks
    };
  } catch (error) {
    rollbackAtomicApply(preparedWrites, backups);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("PATCH_APPLY_FAILED", "Unable to apply patch atomically.", 400, {
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    for (const prepared of preparedWrites) {
      if (fs.existsSync(prepared.tempPath)) {
        fs.rmSync(prepared.tempPath, { force: true });
      }
    }
  }
}

function firstNonEmptyLine(raw: string): string {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? "";
}

function safeReadText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseThemeJson(themeJsonPath: string): ThemeJsonData | null {
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

function normalizePresetValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function extractPresetEntries(items: ThemeJsonPreset[] | undefined, valueKeys: Array<keyof ThemeJsonPreset>): string[] {
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

function getTopLevelKeys(record: Record<string, unknown> | undefined): string[] {
  if (!record || typeof record !== "object") {
    return [];
  }
  return Object.keys(record).sort();
}

function listFilesRecursively(rootDir: string, options?: { exts?: string[]; maxFiles?: number }): string[] {
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

function relativeToRoot(rootDir: string, targetPath: string): string {
  return path.relative(rootDir, targetPath).replace(/\\/gu, "/");
}

function gatherHelperFiles(themePath: string): string[] {
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

function extractPhpFunctions(themePath: string, helperFiles: string[]): string[] {
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

function detectConventionDirectories(themePath: string): {
  components: string[];
  partials: string[];
  helpers: string[];
} {
  const candidates = {
    components: ["components", "component", "blocks", "modules", "parts"],
    partials: ["partials", "partial", "template-parts", "templates/parts"],
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

function inferFileCaseStyle(fileNames: string[]): FileCaseStyle {
  const counters: Record<Exclude<FileCaseStyle, "mixed" | "unknown">, number> = {
    "kebab-case": 0,
    "snake_case": 0,
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
      counters["snake_case"] += 1;
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

function extractFunctionPrefixes(functionNames: string[]): string[] {
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

function extractCssVarPrefixes(themePath: string): string[] {
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

function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeWhereIsUsedKind(value: unknown): WhereIsUsedKind {
  if (typeof value !== "string") {
    return "auto";
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "class"
    || normalized === "block"
    || normalized === "shortcode"
    || normalized === "function"
    || normalized === "template"
    || normalized === "pattern"
    || normalized === "string"
    || normalized === "auto"
  ) {
    return normalized;
  }
  return "auto";
}

function detectWhereIsUsedKind(query: string): Exclude<WhereIsUsedKind, "auto"> {
  const trimmed = query.trim();
  const lowered = trimmed.toLowerCase();
  if (!trimmed) {
    return "string";
  }
  if (trimmed.startsWith(".")) {
    return "class";
  }
  if ((trimmed.includes("[") || trimmed.includes("]")) && /[[\]]/u.test(trimmed)) {
    return "shortcode";
  }
  if (/^[a-z0-9-]+\/[a-z0-9-]+$/u.test(lowered)) {
    return "block";
  }
  if (trimmed.includes("()") || /\$?[A-Za-z_][A-Za-z0-9_]*\s*\(/u.test(trimmed)) {
    return "function";
  }
  return "string";
}

function normalizeWhereIsUsedScope(input: unknown): {
  files: boolean;
  content: boolean;
  postmeta: boolean;
  options: boolean;
  menus: boolean;
  customTables: boolean;
} {
  const fallback = {
    files: true,
    content: true,
    postmeta: true,
    options: true,
    menus: true,
    customTables: true
  };
  if (!isPlainObject(input)) {
    return fallback;
  }
  return {
    files: typeof input.files === "boolean" ? input.files : true,
    content: typeof input.content === "boolean" ? input.content : true,
    postmeta: typeof input.postmeta === "boolean" ? input.postmeta : true,
    options: typeof input.options === "boolean" ? input.options : true,
    menus: typeof input.menus === "boolean" ? input.menus : true,
    customTables: typeof input.customTables === "boolean" ? input.customTables : true
  };
}

function normalizeWhereIsUsedQuery(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function buildWhereIsUsedSignals(query: string, kind: Exclude<WhereIsUsedKind, "auto">): {
  componentName: string;
  blockNames: string[];
  classNames: string[];
  snippet: string;
  likeTerms: string[];
} {
  const trimmed = query.trim();
  const lowered = trimmed.toLowerCase();
  const dottedClass = lowered.startsWith(".") ? lowered.slice(1) : lowered;
  const functionName = lowered.replace(/\(\)\s*$/u, "").replace(/\s+/gu, "");
  const shortcodeTag = lowered.replace(/[[\]]/gu, "").trim();

  if (kind === "class") {
    const classToken = dottedClass.replace(/^[.#]/u, "");
    return {
      componentName: classToken,
      blockNames: [],
      classNames: classToken ? [classToken] : [],
      snippet: classToken ? `<div class="${classToken}"></div>` : "",
      likeTerms: sortedUnique([trimmed, lowered, classToken].filter((item) => item.length > 0))
    };
  }

  if (kind === "block") {
    return {
      componentName: lowered,
      blockNames: lowered ? [lowered] : [],
      classNames: [],
      snippet: lowered ? `<!-- wp:${lowered} /-->` : "",
      likeTerms: sortedUnique([trimmed, lowered].filter((item) => item.length > 0))
    };
  }

  if (kind === "shortcode") {
    return {
      componentName: shortcodeTag,
      blockNames: [],
      classNames: [],
      snippet: trimmed,
      likeTerms: sortedUnique([trimmed, lowered, shortcodeTag].filter((item) => item.length > 0))
    };
  }

  if (kind === "function") {
    return {
      componentName: functionName,
      blockNames: [],
      classNames: [],
      snippet: functionName ? `<?php ${functionName}(); ?>` : "",
      likeTerms: sortedUnique([trimmed, lowered, functionName, `${functionName}()`].filter((item) => item.length > 0))
    };
  }

  return {
    componentName: lowered,
    blockNames: lowered.includes("/") && /^[a-z0-9-]+\/[a-z0-9-]+$/u.test(lowered) ? [lowered] : [],
    classNames: [],
    snippet: "",
    likeTerms: sortedUnique([trimmed, lowered].filter((item) => item.length > 0))
  };
}

function buildSearchRegex(terms: string[]): RegExp | null {
  const normalized = terms.filter((term) => term.length > 0);
  if (normalized.length === 0) {
    return null;
  }
  return new RegExp(normalized.map((term) => escapeRegExp(term)).join("|"), "giu");
}

function sqliteIdentifier(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || !/^[A-Za-z0-9_]+$/u.test(trimmed)) {
    return null;
  }
  return `\`${trimmed}\``;
}

function cleanSnippetSource(content: string): string {
  if (!content) {
    return "";
  }
  const cleaned = content
    .replace(/(?:^|[\s{;])(?:a|o|i|s|b|d):\d+[:;{]/giu, " ")
    .replace(/[{};]/gu, " ")
    .replace(/\\"/gu, "\"")
    .replace(/\\[nrt]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned;
}

function buildPreviewSnippet(content: string, query: string, maxLength = 160): string {
  const normalized = cleanSnippetSource(content);
  if (!normalized) {
    return "";
  }
  if (!query) {
    return normalized.slice(0, maxLength);
  }
  const lowered = normalized.toLowerCase();
  const queryTokens = sortedUnique(query.split(/\s+/u).filter((token) => token.length > 0));
  const offsets = queryTokens
    .map((token) => lowered.indexOf(token))
    .filter((offset) => offset >= 0)
    .sort((a, b) => a - b);
  if (offsets.length === 0) {
    return normalized.slice(0, maxLength);
  }
  const matchOffset = offsets[0] ?? 0;
  const start = Math.max(0, matchOffset - Math.floor(maxLength / 3));
  const end = Math.min(normalized.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function contentSignalStats(content: string): {
  textLength: number;
  numericRatio: number;
  serializedNoise: boolean;
} {
  const normalized = cleanSnippetSource(content).toLowerCase();
  if (!normalized) {
    return { textLength: 0, numericRatio: 0, serializedNoise: false };
  }
  const chars = normalized.replace(/\s+/gu, "");
  const numericCount = (chars.match(/[0-9]/gu) ?? []).length;
  const serializedNoise = /(?:a|o|s|i|b):\d+[:;{]/u.test(content);
  return {
    textLength: chars.length,
    numericRatio: chars.length > 0 ? numericCount / chars.length : 0,
    serializedNoise
  };
}

function countTermOccurrences(values: string[], terms: string[]): number {
  if (terms.length === 0 || values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    for (const term of terms) {
      if (!term) {
        continue;
      }
      const matches = value.match(new RegExp(escapeRegExp(term), "gu")) ?? [];
      total += matches.length;
    }
  }
  return total;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeComponentName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function tokenizeNaturalLanguage(input: string): string[] {
  const matches = input.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  return matches.filter((token) => token.length > 0);
}

function normalizeComponentKinds(value: unknown): ComponentKind[] {
  const rawEntries: string[] = [];
  if (typeof value === "string") {
    rawEntries.push(...tokenizeNaturalLanguage(value));
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        rawEntries.push(...tokenizeNaturalLanguage(item));
      }
    }
  }

  const deduped = new Set<ComponentKind>();
  for (const token of rawEntries) {
    const normalized = TYPE_HINT_ALIASES[token];
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return COMPONENT_KIND_ORDER.filter((kind) => deduped.has(kind));
}

function isVariantToken(token: string): boolean {
  if (BASIC_VARIANT_HINTS.has(token)) {
    return true;
  }
  return /^v[0-9]+$/u.test(token);
}

function normalizeVariantHints(value: unknown): string[] {
  const tokens: string[] = [];
  if (typeof value === "string") {
    tokens.push(...tokenizeNaturalLanguage(value));
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        tokens.push(...tokenizeNaturalLanguage(item));
      }
    }
  }

  const normalized = Array.from(new Set(tokens.filter((token) => isVariantToken(token))));
  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0)))
    .sort((a, b) => a.localeCompare(b));
}

function sortedUniquePreserveCase(values: string[]): string[] {
  const deduped = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (!deduped.has(normalized)) {
      deduped.set(normalized, trimmed);
    }
  }
  return [...deduped.values()].sort((a, b) => a.localeCompare(b));
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function globPatternToRegex(globPattern: string): RegExp {
  const normalized = globPattern.trim();
  if (!normalized) {
    return /.*/u;
  }

  let pattern = normalized.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  pattern = pattern.replace(/\*/gu, ".*").replace(/\?/gu, ".");
  pattern = pattern.replace(/\\\{([^}]+)\\\}/gu, (_full, group) => {
    const entries = String(group)
      .split(",")
      .map((entry) => escapeRegExp(entry.trim()))
      .filter((entry) => entry.length > 0);
    if (entries.length === 0) {
      return "\\{\\}";
    }
    return `(?:${entries.join("|")})`;
  });

  return new RegExp(`^${pattern}$`, "u");
}

function resolveFsSearchPattern(input: { query: string; isRegex: boolean }): RegExp {
  if (!input.isRegex) {
    return new RegExp(escapeRegExp(input.query), "gu");
  }
  try {
    return new RegExp(input.query, "gu");
  } catch (error) {
    throw new AppError("INVALID_SEARCH_INPUT", "Invalid regex in `query`.", 400, {
      query: input.query,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function computeLineColumn(content: string, startOffset: number): { line: number; column: number } {
  const before = content.slice(0, startOffset);
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  const column = startOffset - lastNewline;
  return { line, column };
}

function previewForOffset(content: string, startOffset: number): string {
  const lineStart = content.lastIndexOf("\n", Math.max(0, startOffset - 1)) + 1;
  const lineEndCandidate = content.indexOf("\n", startOffset);
  const lineEnd = lineEndCandidate === -1 ? content.length : lineEndCandidate;
  return content.slice(lineStart, lineEnd).trim();
}

function extractStyleVariantTokens(input: string): string[] {
  const tokens = new Set<string>();
  const styleRegex = /\bis-style-([a-z0-9-]+)\b/gu;
  for (const match of input.matchAll(styleRegex)) {
    const token = (match[1] ?? "").trim().toLowerCase();
    if (token) {
      tokens.add(token);
    }
  }
  return [...tokens].sort((a, b) => a.localeCompare(b));
}

function extractCssModifierTokens(input: string): string[] {
  const tokens = new Set<string>();
  const bemRegex = /\.([a-z0-9-]+)--([a-z0-9-]+)/gu;
  for (const match of input.matchAll(bemRegex)) {
    const token = (match[2] ?? "").trim().toLowerCase();
    if (token) {
      tokens.add(token);
    }
  }

  const stateRegex = /\bis-([a-z0-9-]+)\b/gu;
  for (const match of input.matchAll(stateRegex)) {
    const token = (match[1] ?? "").trim().toLowerCase();
    if (token && !token.startsWith("style-")) {
      tokens.add(token);
    }
  }
  return [...tokens].sort((a, b) => a.localeCompare(b));
}

function baseAndVariantFromName(name: string): { base: string; variant: string | null } {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return { base: "", variant: null };
  }

  const segments = normalized.split(/[-_]/u).filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return { base: normalized, variant: null };
  }

  const base = segments[0] ?? normalized;
  const variant = segments[segments.length - 1] ?? null;
  if (!variant || base === variant) {
    return { base: normalized, variant: null };
  }
  return { base, variant };
}

function parseJsonArraySafe(input: string | null): unknown[] {
  if (!input) {
    return [];
  }
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addVariantEvidence(
  target: Map<string, VariantEvidence[]>,
  variant: string,
  mechanism: VariantMechanismId,
  reason: string
): void {
  const normalized = variant.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  const existing = target.get(normalized) ?? [];
  const current = existing.find((entry) => entry.mechanism === mechanism);
  if (current) {
    current.reasons = sortedUniquePreserveCase([...current.reasons, reason]);
  } else {
    existing.push({
      variant: normalized,
      mechanism,
      reasons: [reason]
    });
  }
  existing.sort((a, b) => {
    if (a.mechanism !== b.mechanism) {
      return MECHANISM_ORDER.indexOf(a.mechanism) - MECHANISM_ORDER.indexOf(b.mechanism);
    }
    return a.variant.localeCompare(b.variant);
  });
  target.set(normalized, existing);
}

function buildVariantInsights(
  wpRoot: string,
  wpCli: string,
  db: SqliteDatabase,
  query: ComponentQuerySpec,
  rankedCandidates: AuditCandidate[]
): VariantInsights {
  const mechanismCounts = new Map<VariantMechanismId, number>(
    MECHANISM_ORDER.map((id) => [id, 0])
  );
  const mechanismReasons = new Map<VariantMechanismId, Set<string>>(
    MECHANISM_ORDER.map((id) => [id, new Set<string>()])
  );
  const variantEvidenceByToken = new Map<string, VariantEvidence[]>();

  const bumpMechanism = (id: VariantMechanismId, amount: number, reason: string): void => {
    if (amount <= 0) {
      return;
    }
    mechanismCounts.set(id, (mechanismCounts.get(id) ?? 0) + amount);
    mechanismReasons.get(id)?.add(reason);
  };

  const blockRows = db
    .prepare("SELECT path, stylesJson, variationsJson FROM blocks ORDER BY path ASC")
    .all() as Array<{ path: string; stylesJson: string | null; variationsJson: string | null }>;

  let blockStyleEntries = 0;
  let blockVariationEntries = 0;
  for (const row of blockRows) {
    const styles = parseJsonArraySafe(row.stylesJson);
    const variations = parseJsonArraySafe(row.variationsJson);
    blockStyleEntries += styles.length;
    blockVariationEntries += variations.length;

    for (const style of styles) {
      if (!isPlainObject(style)) {
        continue;
      }
      const token = normalizeComponentName(style.name ?? style.label ?? "").replace(/\s+/gu, "-");
      if (!token) {
        continue;
      }
      addVariantEvidence(
        variantEvidenceByToken,
        token,
        "block_styles",
        `style "${token}" found in ${row.path}`
      );
    }

    for (const variation of variations) {
      if (!isPlainObject(variation)) {
        continue;
      }
      const token = normalizeComponentName(variation.name ?? variation.title ?? "").replace(/\s+/gu, "-");
      if (!token) {
        continue;
      }
      addVariantEvidence(
        variantEvidenceByToken,
        token,
        "block_variations",
        `variation "${token}" found in ${row.path}`
      );
    }
  }

  bumpMechanism(
    "block_styles",
    blockStyleEntries,
    `Detected ${blockStyleEntries} block style definitions in indexed block metadata.`
  );
  bumpMechanism(
    "block_variations",
    blockVariationEntries,
    `Detected ${blockVariationEntries} block variation definitions in indexed block metadata.`
  );

  const patternRows = db
    .prepare("SELECT slug, path, blockFingerprint FROM patterns ORDER BY path ASC")
    .all() as Array<{ slug: string; path: string; blockFingerprint: string | null }>;

  const patternPrefixCounts = new Map<string, number>();
  const patternFingerprintCounts = new Map<string, number>();
  for (const row of patternRows) {
    const { base } = baseAndVariantFromName(row.slug);
    if (base) {
      patternPrefixCounts.set(base, (patternPrefixCounts.get(base) ?? 0) + 1);
    }
    if (row.blockFingerprint) {
      patternFingerprintCounts.set(row.blockFingerprint, (patternFingerprintCounts.get(row.blockFingerprint) ?? 0) + 1);
    }
  }

  let patternVariantGroups = 0;
  for (const row of patternRows) {
    const { base, variant } = baseAndVariantFromName(row.slug);
    const hasSharedPrefix = base && (patternPrefixCounts.get(base) ?? 0) >= 2;
    const hasSharedFingerprint = row.blockFingerprint && (patternFingerprintCounts.get(row.blockFingerprint) ?? 0) >= 2;
    if (!variant || (!hasSharedPrefix && !hasSharedFingerprint)) {
      continue;
    }
    patternVariantGroups += 1;
    const reasons: string[] = [];
    if (hasSharedPrefix) {
      reasons.push(`slug prefix "${base}" appears in multiple patterns`);
    }
    if (hasSharedFingerprint) {
      reasons.push("pattern shares block fingerprint with sibling patterns");
    }
    addVariantEvidence(
      variantEvidenceByToken,
      variant,
      "pattern_variants",
      `${row.path}: ${reasons.join("; ")}`
    );
  }
  bumpMechanism(
    "pattern_variants",
    patternVariantGroups,
    `Detected ${patternVariantGroups} pattern files using shared prefixes or matching block fingerprints.`
  );

  const templateRows = db
    .prepare("SELECT path, type FROM templates ORDER BY path ASC")
    .all() as Array<{ path: string; type: string }>;
  const templateBaseCounts = new Map<string, number>();
  for (const row of templateRows) {
    const fileName = path.basename(row.path).replace(/\.[^.]+$/u, "");
    const { base } = baseAndVariantFromName(fileName);
    if (!base) {
      continue;
    }
    templateBaseCounts.set(base, (templateBaseCounts.get(base) ?? 0) + 1);
  }
  let templateVariantFiles = 0;
  for (const row of templateRows) {
    const fileName = path.basename(row.path).replace(/\.[^.]+$/u, "");
    const { base, variant } = baseAndVariantFromName(fileName);
    const hasBaseFamily = base && (templateBaseCounts.get(base) ?? 0) >= 2;
    const isLikelyTemplatePart = row.type.includes("part") || TEMPLATE_PART_BASE_NAMES.has(base);
    if (!variant || !hasBaseFamily || !isLikelyTemplatePart) {
      continue;
    }
    templateVariantFiles += 1;
    addVariantEvidence(
      variantEvidenceByToken,
      variant,
      "template_part_variants",
      `${row.path}: filename follows base-variant convention (${base}-${variant})`
    );
  }
  bumpMechanism(
    "template_part_variants",
    templateVariantFiles,
    `Detected ${templateVariantFiles} template/template-part files with base-variant filenames.`
  );

  const contentPaths = resolveWordPressContentPaths(wpRoot, wpCli, { allowFilesystemFallback: true });
  const scanRoots = getFilesystemScanRoots(contentPaths);
  const scanExts = [".css", ".scss", ".js", ".jsx", ".ts", ".tsx", ".php", ".html"];
  let registerBlockStyleHits = 0;
  let registerBlockVariationHits = 0;
  let cssModifierHits = 0;
  for (const root of scanRoots) {
    const files = listFilesRecursively(root, { exts: scanExts, maxFiles: 1200 });
    for (const filePath of files) {
      const relPath = relativeToRoot(wpRoot, filePath);
      const content = safeReadText(filePath);
      if (!content) {
        continue;
      }

      const blockStyleRegistrationHits = (content.match(/\bregister_block_style\s*\(/gu) ?? []).length;
      const variationRegistrationHits = (content.match(/\bregisterBlockVariation\s*\(/gu) ?? []).length;
      registerBlockStyleHits += blockStyleRegistrationHits;
      registerBlockVariationHits += variationRegistrationHits;

      const styleTokens = extractStyleVariantTokens(content);
      for (const token of styleTokens) {
        addVariantEvidence(
          variantEvidenceByToken,
          token,
          "block_styles",
          `${relPath}: found class token is-style-${token}`
        );
      }

      const modifierTokens = extractCssModifierTokens(content);
      cssModifierHits += modifierTokens.length;
      for (const token of modifierTokens) {
        addVariantEvidence(
          variantEvidenceByToken,
          token,
          "css_modifiers",
          `${relPath}: found modifier class/state token "${token}"`
        );
      }
    }
  }

  bumpMechanism(
    "block_styles",
    registerBlockStyleHits,
    `Detected ${registerBlockStyleHits} register_block_style calls in theme/plugin source.`
  );
  bumpMechanism(
    "block_variations",
    registerBlockVariationHits,
    `Detected ${registerBlockVariationHits} registerBlockVariation calls in theme/plugin source.`
  );
  bumpMechanism(
    "css_modifiers",
    cssModifierHits,
    `Detected ${cssModifierHits} CSS modifier/state tokens matching component--* or is-* patterns.`
  );

  const queryVariants = sortedUnique(query.variantHints);
  const existingDetails: VariantEvidence[] = [];
  for (const variant of queryVariants) {
    const entries = variantEvidenceByToken.get(variant) ?? [];
    if (entries.length > 0) {
      existingDetails.push(...entries);
    }
  }

  const topCandidateVariantTokens = sortedUnique(
    rankedCandidates
      .slice(0, 8)
      .flatMap((candidate) => extractCssModifierTokens(`${candidate.id} ${candidate.path ?? ""}`))
  );
  for (const token of topCandidateVariantTokens) {
    const entries = variantEvidenceByToken.get(token);
    if (!entries) {
      continue;
    }
    existingDetails.push(...entries);
  }

  const dedupedExistingDetails = existingDetails
    .reduce((acc, item) => {
      const key = `${item.variant}::${item.mechanism}`;
      const existing = acc.get(key);
      if (!existing) {
        acc.set(key, {
          variant: item.variant,
          mechanism: item.mechanism,
          reasons: [...item.reasons]
        });
      } else {
        existing.reasons = sortedUniquePreserveCase([...existing.reasons, ...item.reasons]);
      }
      return acc;
    }, new Map<string, VariantEvidence>());
  const existingDetailsSorted = [...dedupedExistingDetails.values()].sort((a, b) => {
    if (a.variant !== b.variant) {
      return a.variant.localeCompare(b.variant);
    }
    return MECHANISM_ORDER.indexOf(a.mechanism) - MECHANISM_ORDER.indexOf(b.mechanism);
  });

  const existing = sortedUnique(existingDetailsSorted.map((detail) => detail.variant));
  const missing = sortedUnique(queryVariants.filter((variant) => !existing.includes(variant)));
  const missingDetails = missing.map((variant) => ({
    variant,
    reasons: [
      `Requested variant "${variant}" was not detected via block styles, block variations, pattern/template naming, or CSS modifiers.`
    ]
  }));

  const mechanismStats = MECHANISM_ORDER
    .map((id): VariantMechanismSummary => ({
      id,
      count: mechanismCounts.get(id) ?? 0,
      reasons: sortedUniquePreserveCase([...(mechanismReasons.get(id) ?? new Set<string>())])
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return MECHANISM_ORDER.indexOf(a.id) - MECHANISM_ORDER.indexOf(b.id);
    });

  const recommendedMechanism = mechanismStats[0]?.id ?? "css_modifiers";
  const recommendedReasons = [
    `Recommended "${recommendedMechanism}" because it has the highest project prevalence (${mechanismStats[0]?.count ?? 0} signals).`,
    ...(mechanismStats.find((item) => item.id === recommendedMechanism)?.reasons ?? [])
  ];

  return {
    existing,
    missing,
    existingDetails: existingDetailsSorted,
    missingDetails,
    recommendedMechanism: {
      id: recommendedMechanism,
      reasons: sortedUniquePreserveCase(recommendedReasons)
    },
    mechanismStats
  };
}

function normalizeRawComponentQuery(raw: string): ComponentQuerySpec {
  const normalizedRaw = normalizeComponentName(raw);
  const tokens = tokenizeNaturalLanguage(normalizedRaw);
  const typeHints = normalizeComponentKinds(tokens);
  const variantHints = sortedUnique(tokens.filter((token) => isVariantToken(token)));
  const nameTokens = tokens.filter((token) => {
    if (COMPONENT_QUERY_STOP_WORDS.has(token)) {
      return false;
    }
    if (isVariantToken(token)) {
      return false;
    }
    if (TYPE_HINT_ALIASES[token]) {
      return false;
    }
    return true;
  });

  const name = nameTokens.length > 0
    ? nameTokens.join(" ")
    : normalizedRaw;

  const blockNames = sortedUnique(
    (normalizedRaw.match(/[a-z0-9-]+\/[a-z0-9-]+/gu) ?? [])
  );
  const componentLabels = sortedUnique([...blockNames, ...nameTokens]);

  return {
    name,
    variantHints,
    typeHints,
    blockNames,
    classNames: [],
    componentLabels,
    snippet: ""
  };
}

function normalizeStructuredComponentQuery(input: ComponentQuerySpecInput): ComponentQuerySpec {
  const name = normalizeComponentName(input.name ?? input.componentName);
  const variantHints = normalizeVariantHints(input.variantHints ?? input.variants);
  const typeHints = normalizeComponentKinds(input.typeHints ?? input.types);
  const blockNames = normalizeStringArray(input.blockNames);
  const classNames = normalizeStringArray(input.classNames);
  const componentLabels = normalizeStringArray(input.componentLabels);
  const snippet = typeof input.snippet === "string" ? input.snippet.trim() : "";

  const fallbackName = blockNames[0] ?? classNames[0] ?? "";
  const normalizedName = name || fallbackName;
  if (!normalizedName) {
    throw new AppError(
      "INVALID_AUDIT_QUERY",
      "Structured component query must include `name` (or `componentName`).",
      400
    );
  }

  const resolvedComponentLabels = componentLabels.length > 0
    ? componentLabels
    : sortedUnique([normalizedName, ...blockNames, ...classNames]);

  return {
    name: normalizedName,
    variantHints,
    typeHints,
    blockNames,
    classNames,
    componentLabels: resolvedComponentLabels,
    snippet
  };
}

function normalizeAuditComponentQuery(body: AuditComponentRequest): {
  query: ComponentQuerySpec;
  source: "raw" | "structured";
} {
  if (typeof body.query === "string" && body.query.trim().length > 0) {
    return {
      query: normalizeRawComponentQuery(body.query),
      source: "raw"
    };
  }

  if (typeof body.component_query === "string" && body.component_query.trim().length > 0) {
    return {
      query: normalizeRawComponentQuery(body.component_query),
      source: "raw"
    };
  }

  const structuredInput = body.query ?? body.componentQuerySpec;
  if (isPlainObject(structuredInput)) {
    return {
      query: normalizeStructuredComponentQuery(structuredInput),
      source: "structured"
    };
  }

  throw new AppError(
    "INVALID_AUDIT_QUERY",
    "Provide `query` (string preferred), `component_query` (string), or `query`/`componentQuerySpec` as structured objects.",
    400
  );
}

function inferVariantsFromText(input: string): string[] {
  const tokens = tokenizeNaturalLanguage(input);
  const variantTokens = tokens.filter((token) => isVariantToken(token));
  return sortedUnique(variantTokens);
}

function containsWord(haystack: string, term: string): boolean {
  if (!haystack || !term) {
    return false;
  }
  return haystack.includes(term);
}

function enableStepsForCandidate(kind: ComponentKind, candidate: AuditCandidate): string[] {
  if (kind === "block") {
    return [
      `Use block "${candidate.id}" directly in editor or template markup.`,
      "If variant-specific behavior is needed, use block style or variation first."
    ];
  }
  if (kind === "pattern") {
    return [
      `Insert pattern "${candidate.id}" from the pattern inserter.`,
      "Keep customization minimal to preserve pattern portability."
    ];
  }
  if (kind === "template") {
    return [
      `Reference template "${candidate.id}" in theme template hierarchy.`,
      "Prefer extending via template part overrides over duplicating files."
    ];
  }
  return [
    `Reuse post content candidate "${candidate.id}" as a reference implementation.`,
    "Promote repeated usage into a pattern or block if needed."
  ];
}

function scoreAuditCandidate(
  kind: ComponentKind,
  searchableValues: string[],
  query: ComponentQuerySpec,
  usageBoost: number
): {
  score: number;
  reasons: string[];
  variantHits: string[];
} {
  const values = searchableValues.map((value) => value.toLowerCase()).filter((value) => value.length > 0);
  const joined = values.join(" ");
  let score = 0;
  const reasons: string[] = [];

  const exactName = values.some((value) => value === query.name);
  const partialName = !exactName && values.some((value) => containsWord(value, query.name));
  if (exactName) {
    score += 0.55;
    reasons.push("name exact match");
  } else if (partialName) {
    score += 0.35;
    reasons.push("name partial match");
  }

  for (const token of query.name.split(" ").filter((token) => token.length > 1)) {
    if (containsWord(joined, token)) {
      score += 0.04;
      reasons.push(`name token match: ${token}`);
    }
  }

  if (query.typeHints.length > 0 && query.typeHints.includes(kind)) {
    score += 0.15;
    reasons.push(`type hint match: ${kind}`);
  }

  for (const blockName of query.blockNames) {
    const exactBlockId = values.some((value) => value === blockName);
    if (exactBlockId) {
      score += 0.42;
      reasons.push(`block id exact match: ${blockName}`);
      continue;
    }
    if (containsWord(joined, blockName)) {
      score += blockName.includes("/") ? 0.28 : 0.16;
      reasons.push(`block name match: ${blockName}`);
    }
  }

  for (const label of query.componentLabels) {
    const exactLabel = values.some((value) => value === label);
    const partialLabel = !exactLabel && values.some((value) => containsWord(value, label));
    if (exactLabel) {
      score += label.includes("/") ? 0.48 : 0.34;
      reasons.push(`component label exact match: ${label}`);
    } else if (partialLabel) {
      score += label.includes("/") ? 0.3 : 0.2;
      reasons.push(`component label partial match: ${label}`);
    }
  }

  for (const className of query.classNames) {
    if (containsWord(joined, className)) {
      score += 0.1;
      reasons.push(`class hint match: ${className}`);
    }
  }

  const discoveredVariants = inferVariantsFromText(joined);
  const variantHits = sortedUnique(query.variantHints.filter((hint) => discoveredVariants.includes(hint)));
  if (variantHits.length > 0) {
    score += Math.min(0.2, variantHits.length * 0.08);
    reasons.push(`variant hints matched: ${variantHits.join(", ")}`);
  }

  if (usageBoost > 0) {
    score += usageBoost;
    reasons.push("usage weighting applied");
  }

  return {
    score: Math.min(1, Number.parseFloat(score.toFixed(2))),
    reasons: sortedUnique(reasons),
    variantHits
  };
}

function rankAuditCandidates(candidates: AuditCandidate[]): AuditCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.type !== right.type) {
      return left.type.localeCompare(right.type);
    }
    return left.id.localeCompare(right.id);
  });
}

function decideAuditVerdict(bestScore: number): "exists" | "partial" | "missing" {
  if (bestScore >= STRONG_MATCH_SCORE_THRESHOLD) {
    return "exists";
  }
  if (bestScore >= PARTIAL_MATCH_SCORE_THRESHOLD) {
    return "partial";
  }
  return "missing";
}

function mapMechanismToApproach(mechanism: VariantMechanismId): LowestRiskApproach {
  if (mechanism === "block_styles" || mechanism === "css_modifiers") {
    return "style";
  }
  if (mechanism === "block_variations") {
    return "variation";
  }
  if (mechanism === "template_part_variants") {
    return "template-part";
  }
  return "pattern";
}

function hasClearVariantMechanism(variantInsights: VariantInsights): boolean {
  const top = variantInsights.mechanismStats[0];
  if (!top || top.count <= 0) {
    return false;
  }
  const second = variantInsights.mechanismStats[1];
  if (!second) {
    return true;
  }
  return top.count >= 2 || top.count > second.count;
}

function pickReuseApproach(bestCandidate: AuditCandidate, variantInsights: VariantInsights): LowestRiskApproach {
  if (bestCandidate.type === "pattern") {
    return "pattern";
  }
  if (bestCandidate.type === "template") {
    return "template-part";
  }
  if (bestCandidate.type === "content") {
    return "pattern";
  }

  if (bestCandidate.type === "block") {
    const hasVariationEvidence = variantInsights.existingDetails.some((detail) => detail.mechanism === "block_variations");
    if (hasVariationEvidence || variantInsights.recommendedMechanism.id === "block_variations") {
      return "variation";
    }
    return "style";
  }

  return "new-block";
}

function dedupeAndSort(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((a, b) => a.localeCompare(b));
}

function buildPatchPlanSkeleton(
  action: RecommendationAction,
  approach: LowestRiskApproach,
  bestCandidate: AuditCandidate | null,
  contentPaths: WordPressContentPaths
): {
  files: string[];
  checks: string[];
  rollback: string[];
} {
  const likelyFiles = new Set<string>();
  if (bestCandidate?.path) {
    likelyFiles.add(bestCandidate.path);
  }

  if (approach === "pattern") {
    likelyFiles.add(formatContentHint(contentPaths, "themes/<active-theme>/patterns/*.php"));
  } else if (approach === "style") {
    likelyFiles.add(formatContentHint(contentPaths, "themes/<active-theme>/theme.json"));
    likelyFiles.add(formatContentHint(contentPaths, "themes/<active-theme>/assets/css/*.css"));
  } else if (approach === "variation") {
    likelyFiles.add(formatContentHint(contentPaths, "themes/<active-theme>/functions.php"));
    likelyFiles.add(formatContentHint(contentPaths, "plugins/<active-plugin>/src/**/variations*.{js,ts}"));
  } else if (approach === "template-part") {
    likelyFiles.add(formatContentHint(contentPaths, "themes/<active-theme>/parts/*.html"));
    likelyFiles.add(formatContentHint(contentPaths, "themes/<active-theme>/templates/*.html"));
  } else {
    likelyFiles.add(formatContentHint(contentPaths, "plugins/<active-plugin>/blocks/<component>/block.json"));
    likelyFiles.add(formatContentHint(contentPaths, "plugins/<active-plugin>/blocks/<component>/render.php"));
    likelyFiles.add(formatContentHint(contentPaths, "plugins/<active-plugin>/blocks/<component>/style.css"));
  }

  const checks = [
    "Preview unified diff before apply.",
    "Re-run /project/index/build after any applied patch.",
    "Re-run /audit/component to verify recommendation/verdict changes.",
    "If PHP files change, run php -l on changed PHP files."
  ];
  if (action === "extend") {
    checks.push("Confirm variant mechanism aligns with existing project conventions.");
  }
  if (action === "create") {
    checks.push("Confirm no reusable pattern/style/variation/template-part candidate remains viable.");
  }

  const rollback = [
    "Revert the applied diff for touched files.",
    "Restore previous variant registration/style declarations if changed.",
    "Rebuild index to restore baseline audit signals."
  ];

  return {
    files: dedupeAndSort([...likelyFiles]),
    checks: dedupeAndSort(checks),
    rollback: dedupeAndSort(rollback)
  };
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function extractMarkers(content: string): {
  classes: string[];
  dataAttrs: string[];
  selectors: string[];
} {
  const classNames = new Set<string>();
  const dataAttrs = new Set<string>();
  const selectors = new Set<string>();

  const classRegex = /\bclass(?:Name)?\s*=\s*["']([^"']+)["']/gu;
  for (const match of content.matchAll(classRegex)) {
    const raw = match[1] ?? "";
    for (const candidate of raw.split(/\s+/u)) {
      const className = candidate.trim();
      if (!className) {
        continue;
      }
      classNames.add(className);
      selectors.add(`.${className}`);
    }
  }

  const dataRegex = /\b(data-[a-zA-Z0-9_-]+)\s*=/gu;
  for (const match of content.matchAll(dataRegex)) {
    const attrName = (match[1] ?? "").trim();
    if (!attrName) {
      continue;
    }
    dataAttrs.add(attrName);
    selectors.add(`[${attrName}]`);
  }

  const idRegex = /\bid\s*=\s*["']([^"']+)["']/gu;
  for (const match of content.matchAll(idRegex)) {
    const raw = match[1] ?? "";
    for (const candidate of raw.split(/\s+/u)) {
      const id = candidate.trim();
      if (!id) {
        continue;
      }
      selectors.add(`#${id}`);
    }
  }

  return {
    classes: [...classNames].sort(),
    dataAttrs: [...dataAttrs].sort(),
    selectors: [...selectors].sort()
  };
}

function computeMarkerSignature(content: string): string {
  return sha256(JSON.stringify(extractMarkers(content)));
}

function extractBlockSequence(content: string): string[] {
  const sequence: string[] = [];
  const blockRegex = /<!--\s*wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)\b/giu;
  for (const match of content.matchAll(blockRegex)) {
    const blockName = (match[1] ?? "").trim().toLowerCase();
    if (blockName) {
      sequence.push(blockName);
    }
  }
  return sequence;
}

function computeBlockFingerprintFromSequence(sequence: string[]): string | null {
  if (sequence.length === 0) {
    return null;
  }
  return sha256(JSON.stringify(sequence));
}

function markerTokenSet(markers: ReturnType<typeof extractMarkers>): Set<string> {
  return new Set([
    ...markers.classes.map((item) => item.toLowerCase()),
    ...markers.dataAttrs.map((item) => item.toLowerCase()),
    ...markers.selectors.map((item) => item.toLowerCase())
  ]);
}

function countSetIntersection(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const item of left) {
    if (right.has(item)) {
      overlap += 1;
    }
  }
  return overlap;
}

function computeBlockSequenceOverlap(
  querySequence: string[],
  candidateSequence: string[]
): { overlapCount: number; ratio: number } {
  const querySet = new Set(querySequence.map((item) => item.toLowerCase()));
  const candidateSet = new Set(candidateSequence.map((item) => item.toLowerCase()));
  if (querySet.size === 0 || candidateSet.size === 0) {
    return { overlapCount: 0, ratio: 0 };
  }

  const overlapCount = countSetIntersection(querySet, candidateSet);
  if (overlapCount === 0) {
    return { overlapCount: 0, ratio: 0 };
  }

  const ratio = overlapCount / Math.max(querySet.size, candidateSet.size);
  return { overlapCount, ratio };
}

function readIndexedFileSignals(
  wpRoot: string,
  indexedPath: string
): {
  markerTokens: Set<string>;
  blockSequence: string[];
  rawContent: string;
} | null {
  try {
    const safePath = assertWithinRoot(wpRoot, path.resolve(wpRoot, indexedPath), "indexedPath");
    const content = safeReadText(safePath);
    if (!content) {
      return null;
    }
    return {
      markerTokens: markerTokenSet(extractMarkers(content)),
      blockSequence: extractBlockSequence(content),
      rawContent: content
    };
  } catch {
    return null;
  }
}

function escapeLikeInput(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

function toLikePattern(value: string): string {
  return `%${escapeLikeInput(value)}%`;
}

function buildOrLikeClause(columns: string[], terms: string[]): {
  clause: string;
  params: string[];
} | null {
  if (columns.length === 0 || terms.length === 0) {
    return null;
  }

  const termClauses: string[] = [];
  const params: string[] = [];

  for (const term of terms) {
    const byColumn = columns.map((column) => `LOWER(${column}) LIKE ? ESCAPE '\\'`);
    termClauses.push(`(${byColumn.join(" OR ")})`);
    const pattern = toLikePattern(term);
    for (let idx = 0; idx < columns.length; idx += 1) {
      params.push(pattern);
    }
  }

  return {
    clause: termClauses.join(" OR "),
    params
  };
}

function hasExactOrPartialMatch(value: string, term: string): {
  exact: boolean;
  partial: boolean;
} {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue || !term) {
    return { exact: false, partial: false };
  }
  return {
    exact: normalizedValue === term,
    partial: normalizedValue.includes(term)
  };
}

type SearchSourceType = keyof typeof SOURCE_BASE_WEIGHTS;

function scoreCandidate(
  sourceType: SearchSourceType,
  searchableValues: string[],
  componentName: string,
  blockNames: string[],
  queryMarkerTokens: Set<string>,
  candidateMarkerSignature: string | null,
  candidateMarkerTokens: Set<string> | null,
  queryMarkerSignature: string | null,
  queryBlockFingerprint: string | null,
  queryBlockSequence: string[],
  candidateBlockFingerprint: string | null,
  candidateBlockSequence: string[] | null,
  options?: {
    rawContent?: string;
    metaKey?: string;
  }
): {
  score: number;
  confidence: number;
  reason: string;
  reasons: string[];
} {
  let signalScore = 0;
  const reasons: string[] = [];
  const values = searchableValues.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
  const queryTerms = sortedUnique([componentName, ...blockNames].filter((term) => term.length > 0));
  const sourceWeight = SOURCE_BASE_WEIGHTS[sourceType];

  if (componentName) {
    const nameMatch = values.some((value) => hasExactOrPartialMatch(value, componentName).exact);
    const partialMatch = !nameMatch && values.some((value) => hasExactOrPartialMatch(value, componentName).partial);
    if (nameMatch) {
      signalScore += 0.5;
      reasons.push("text exact match");
    } else if (partialMatch) {
      signalScore += 0.32;
      reasons.push("text partial match");
    }
  }

  for (const blockName of blockNames) {
    const blockExact = values.some((value) => hasExactOrPartialMatch(value, blockName).exact);
    const blockPartial = !blockExact && values.some((value) => hasExactOrPartialMatch(value, blockName).partial);
    if (blockExact) {
      signalScore += 0.2;
      reasons.push(`block match: ${blockName}`);
      continue;
    }
    if (blockPartial) {
      signalScore += 0.1;
      reasons.push(`block partial: ${blockName}`);
    }
  }

  if (queryMarkerSignature && candidateMarkerSignature && queryMarkerSignature === candidateMarkerSignature) {
    signalScore += 0.36;
    reasons.push("known marker signature match");
  }

  if (queryMarkerTokens.size > 0 && candidateMarkerTokens && candidateMarkerTokens.size > 0) {
    const sharedMarkers = countSetIntersection(queryMarkerTokens, candidateMarkerTokens);
    if (sharedMarkers > 0) {
      const markerRatio = sharedMarkers / queryMarkerTokens.size;
      signalScore += Math.min(0.3, 0.08 + (markerRatio * 0.22));
      reasons.push(`marker overlap (${sharedMarkers})`);
    }
  }

  if (queryBlockFingerprint && candidateBlockFingerprint && queryBlockFingerprint === candidateBlockFingerprint) {
    signalScore += 0.4;
    reasons.push("block structure exact match");
  } else if (queryBlockSequence.length > 0 && candidateBlockSequence && candidateBlockSequence.length > 0) {
    const overlap = computeBlockSequenceOverlap(queryBlockSequence, candidateBlockSequence);
    if (overlap.ratio >= 0.5) {
      signalScore += 0.25;
      reasons.push(`block structure overlap high (${overlap.overlapCount})`);
    } else if (overlap.ratio >= 0.25) {
      signalScore += 0.15;
      reasons.push(`block structure overlap medium (${overlap.overlapCount})`);
    }
  }

  const isClassMatch = values.some((value) => /(class=|classname=|\.|is-style-|wp-block-)/u.test(value))
    && countTermOccurrences(values, queryTerms) > 0;
  if (isClassMatch) {
    signalScore += 0.08;
    reasons.push("class match");
  }

  const hasStructuredHtml = values.some((value) => /<[^>]+>/u.test(value));
  if (hasStructuredHtml) {
    signalScore += 0.06;
    reasons.push("structured html context");
  }

  const repeatedMatches = countTermOccurrences(values, queryTerms);
  if (repeatedMatches >= 3) {
    signalScore += Math.min(0.15, repeatedMatches * 0.02);
    reasons.push(`repeated matches (${repeatedMatches})`);
  }

  let penalties = 0;
  const stats = contentSignalStats(options?.rawContent ?? values.join(" "));
  if (stats.textLength > 0 && stats.textLength < 20) {
    penalties += 0.2;
    reasons.push("low signal: very short");
  }
  if (stats.numericRatio >= 0.6) {
    penalties += 0.2;
    reasons.push("low signal: mostly numeric");
  }
  if (stats.serializedNoise) {
    penalties += 0.2;
    reasons.push("low signal: serialized noise");
  }

  const metaKey = options?.metaKey?.trim().toLowerCase() ?? "";
  if (metaKey) {
    if (metaKey.startsWith("_")) {
      penalties += 0.18;
      reasons.push("meta match: internal key");
    }
    if (WP_INTERNAL_META_KEYS.has(metaKey)) {
      penalties += 0.2;
      reasons.push("meta match: wp system key");
    }
  }

  const normalizedSignal = Math.max(0, Math.min(1, signalScore - penalties));
  const weightedScore = Math.max(0, Math.min(1, normalizedSignal * sourceWeight));
  const score = Number.parseFloat(weightedScore.toFixed(2));
  const dedupedReasons = sortedUnique(reasons);
  const reason = dedupedReasons[0] ?? "text match";

  return {
    score,
    confidence: score,
    reason,
    reasons: dedupedReasons
  };
}

function parseMarkerFromTemplateIncludes(includesJson: string | null): string | null {
  if (!includesJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(includesJson) as { markerSignature?: unknown };
    return typeof parsed.markerSignature === "string" ? parsed.markerSignature : null;
  } catch {
    return null;
  }
}

function dedupeByKey<T>(
  matches: T[],
  keyOf: (item: T) => string,
  merge: (left: T, right: T) => T
): T[] {
  const deduped = new Map<string, T>();
  for (const match of matches) {
    const key = keyOf(match);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, match);
      continue;
    }
    deduped.set(key, merge(existing, match));
  }
  return [...deduped.values()];
}

function mergeScores(baseScore: number, incomingScore: number): number {
  const merged = Math.max(baseScore, incomingScore) + Math.min(0.1, Math.abs(incomingScore - baseScore) * 0.5);
  return Number.parseFloat(Math.min(1, merged).toFixed(2));
}

function decodeBase64Utf8(value: string): string {
  if (!value) {
    return "";
  }
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function errorToLookupMessage(error: unknown): string {
  if (error instanceof AppError) {
    const details = error.details as { stderr?: unknown } | undefined;
    const stderr = typeof details?.stderr === "string" ? details.stderr.trim() : "";
    if (stderr.length > 0) {
      return stderr;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseResolvedContentMetadataRows(output: string): Map<number, { slug: string | null; url: string | null }> {
  const metadataByPostId = new Map<number, { slug: string | null; url: string | null }>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [idRaw, slugB64 = "", urlB64 = ""] = trimmed.split("\t");
    const postId = Number.parseInt(idRaw ?? "", 10);
    if (!Number.isInteger(postId) || postId <= 0) {
      continue;
    }
    const slug = decodeBase64Utf8(slugB64).trim();
    const url = decodeBase64Utf8(urlB64).trim();
    metadataByPostId.set(postId, {
      slug: slug.length > 0 ? slug : null,
      url: url.length > 0 ? url : null
    });
  }
  return metadataByPostId;
}

function resolvePostsTableNameForMetadata(wpRoot: string): string {
  const postsTable = runWpCli(wpRoot, [
    "eval",
    "global $wpdb; echo $wpdb->posts;"
  ]).trim();
  if (!postsTable || !/^[a-zA-Z0-9_]+$/.test(postsTable)) {
    throw new AppError("WPCLI_FAILED", "Unable to resolve WordPress posts table name.", 400);
  }
  return postsTable;
}

type ContentMetadataResolution = {
  metadataByPostId: Map<number, { slug: string | null; url: string | null }>;
  warning: string | null;
};

function resolveContentMetadata(
  wpRoot: string,
  postIds: number[]
): ContentMetadataResolution {
  const uniquePostIds = [...new Set(postIds.filter((id) => Number.isInteger(id) && id > 0))];
  const metadataByPostId = new Map<number, { slug: string | null; url: string | null }>();
  if (uniquePostIds.length === 0) {
    return {
      metadataByPostId,
      warning: null
    };
  }

  const lookupErrors: string[] = [];

  try {
    const postsTable = resolvePostsTableNameForMetadata(wpRoot);
    const sql = [
      "SELECT",
      "  ID,",
      "  TO_BASE64(COALESCE(post_name, '')) AS post_name_b64,",
      "  TO_BASE64(COALESCE(guid, '')) AS guid_b64",
      `FROM \`${postsTable}\``,
      `WHERE ID IN (${uniquePostIds.join(",")})`
    ].join("\n");
    const output = runWpCli(wpRoot, ["db", "query", sql, "--skip-column-names"]);
    const dbResults = parseResolvedContentMetadataRows(output);
    for (const [postId, metadata] of dbResults.entries()) {
      metadataByPostId.set(postId, metadata);
    }
  } catch (error) {
    lookupErrors.push(`db_query failed: ${errorToLookupMessage(error)}`);
  }

  const unresolvedPostIds = uniquePostIds.filter((postId) => {
    const existing = metadataByPostId.get(postId);
    return !existing || !existing.url;
  });

  if (unresolvedPostIds.length > 0) {
    const php = [
      `$ids = [${unresolvedPostIds.join(",")}];`,
      "foreach ($ids as $id) {",
      "  $id = (int) $id;",
      "  if ($id <= 0) {",
      "    continue;",
      "  }",
      "  $post = get_post($id);",
      "  $slug = '';",
      "  $url = '';",
      "  if ($post instanceof WP_Post) {",
      "    $slug = (string) $post->post_name;",
      "    $permalink = get_permalink($post);",
      "    if (is_string($permalink)) {",
      "      $url = $permalink;",
      "    }",
      "  }",
      "  echo $id . \"\\t\" . base64_encode($slug) . \"\\t\" . base64_encode($url) . PHP_EOL;",
      "}"
    ].join(" ");
    try {
      const output = runWpCli(wpRoot, ["eval", php]);
      const evalResults = parseResolvedContentMetadataRows(output);
      for (const [postId, metadata] of evalResults.entries()) {
        const existing = metadataByPostId.get(postId);
        metadataByPostId.set(postId, {
          slug: metadata.slug ?? existing?.slug ?? null,
          url: metadata.url ?? existing?.url ?? null
        });
      }
    } catch (error) {
      lookupErrors.push(`wp_eval failed: ${errorToLookupMessage(error)}`);
    }
  }

  const warning = lookupErrors.length > 0
    ? `content metadata lookup incomplete: ${lookupErrors.join(" | ")}`
    : null;

  return {
    metadataByPostId,
    warning
  };
}

function usageKindFromPostType(postType: string): UsageKind {
  if (postType === "page") {
    return "page";
  }
  if (postType === "post") {
    return "post";
  }
  return "cpt";
}

function usageKindFromTemplateType(type: string): UsageKind {
  return type.includes("part") ? "template-part" : "template";
}

function addUsageToIndex(target: Map<string, UsageEntry[]>, key: string | null, usage: UsageEntry): void {
  if (!key) {
    return;
  }
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return;
  }
  const existing = target.get(normalizedKey) ?? [];
  const duplicate = existing.some((entry) => (
    entry.kind === usage.kind
    && entry.identifier === usage.identifier
    && entry.reason === usage.reason
    && (entry.title ?? "") === (usage.title ?? "")
  ));
  if (!duplicate) {
    existing.push(usage);
    existing.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }
      if (left.identifier !== right.identifier) {
        return left.identifier.localeCompare(right.identifier);
      }
      return left.reason.localeCompare(right.reason);
    });
  }
  target.set(normalizedKey, existing);
}

function extractPatternReferenceSlugs(content: string): string[] {
  const slugs = new Set<string>();
  const patternBlockRegex = /<!--\s*wp:pattern\s+(\{[^]*?\})\s*\/?-->/gu;
  for (const match of content.matchAll(patternBlockRegex)) {
    const attrsFragment = match[1] ?? "";
    const slugMatch = attrsFragment.match(/"slug"\s*:\s*"([^"]+)"/u);
    const slug = slugMatch?.[1]?.trim();
    if (slug) {
      slugs.add(slug);
    }
  }
  return [...slugs].sort((a, b) => a.localeCompare(b));
}

function buildUsageIndexes(wpRoot: string, db: SqliteDatabase): UsageIndexes {
  const contentByMarker = new Map<string, UsageEntry[]>();
  const contentByFingerprint = new Map<string, UsageEntry[]>();
  const templatesByMarker = new Map<string, UsageEntry[]>();
  const templatesByFingerprint = new Map<string, UsageEntry[]>();
  const patternsByMarker = new Map<string, UsageEntry[]>();
  const patternsByFingerprint = new Map<string, UsageEntry[]>();
  const patternRefsBySlug = new Map<string, UsageEntry[]>();

  const contentRows = db
    .prepare(
      "SELECT postId, postType, title, markerSignature, blockFingerprint, contentSearchText FROM content"
    )
    .all() as ContentCandidateRow[];
  for (const row of contentRows) {
    const usage: UsageEntry = {
      kind: usageKindFromPostType(row.postType),
      identifier: String(row.postId),
      title: row.title ?? undefined,
      reason: "marker match"
    };
    addUsageToIndex(contentByMarker, row.markerSignature, usage);
    addUsageToIndex(contentByFingerprint, row.blockFingerprint, {
      ...usage,
      reason: "fingerprint match"
    });
  }

  const templateRows = db
    .prepare("SELECT id, type, path, includesJson, blockFingerprint FROM templates")
    .all() as TemplateCandidateRow[];
  for (const row of templateRows) {
    const templateUsageBase: UsageEntry = {
      kind: usageKindFromTemplateType(row.type),
      identifier: row.path,
      reason: "marker match"
    };
    addUsageToIndex(templatesByMarker, parseMarkerFromTemplateIncludes(row.includesJson), templateUsageBase);
    addUsageToIndex(templatesByFingerprint, row.blockFingerprint, {
      ...templateUsageBase,
      reason: "fingerprint match"
    });

    let content = "";
    try {
      const filePath = assertWithinRoot(wpRoot, path.resolve(wpRoot, row.path), "templatePath");
      content = safeReadText(filePath);
    } catch {
      content = "";
    }
    if (!content) {
      continue;
    }
    const refs = extractPatternReferenceSlugs(content);
    for (const slug of refs) {
      addUsageToIndex(patternRefsBySlug, slug, {
        kind: usageKindFromTemplateType(row.type),
        identifier: row.path,
        reason: "pattern ref"
      });
    }
  }

  const patternRows = db
    .prepare("SELECT id, slug, title, path, markerSignature, blockFingerprint FROM patterns")
    .all() as PatternCandidateRow[];
  for (const row of patternRows) {
    const patternUsageBase: UsageEntry = {
      kind: "pattern",
      identifier: row.path,
      reason: "marker match"
    };
    addUsageToIndex(patternsByMarker, row.markerSignature, patternUsageBase);
    addUsageToIndex(patternsByFingerprint, row.blockFingerprint, {
      ...patternUsageBase,
      reason: "fingerprint match"
    });

    let content = "";
    try {
      const filePath = assertWithinRoot(wpRoot, path.resolve(wpRoot, row.path), "patternPath");
      content = safeReadText(filePath);
    } catch {
      content = "";
    }
    if (!content) {
      continue;
    }
    const refs = extractPatternReferenceSlugs(content);
    for (const slug of refs) {
      addUsageToIndex(patternRefsBySlug, slug, {
        kind: "pattern",
        identifier: row.path,
        reason: "pattern ref"
      });
    }
  }

  return {
    contentByMarker,
    contentByFingerprint,
    templatesByMarker,
    templatesByFingerprint,
    patternsByMarker,
    patternsByFingerprint,
    patternRefsBySlug
  };
}

function collectUsageForCandidate(candidate: AuditCandidate, indexes: UsageIndexes): UsageEntry[] {
  const usageEntries: UsageEntry[] = [];

  const pushMany = (entries: UsageEntry[] | undefined): void => {
    if (!entries || entries.length === 0) {
      return;
    }
    usageEntries.push(...entries);
  };

  if (candidate.markerSignature) {
    pushMany(indexes.contentByMarker.get(candidate.markerSignature));
    pushMany(indexes.templatesByMarker.get(candidate.markerSignature));
    pushMany(indexes.patternsByMarker.get(candidate.markerSignature));
  }

  if (candidate.blockFingerprint) {
    pushMany(indexes.contentByFingerprint.get(candidate.blockFingerprint));
    pushMany(indexes.templatesByFingerprint.get(candidate.blockFingerprint));
    pushMany(indexes.patternsByFingerprint.get(candidate.blockFingerprint));
  }

  if (candidate.type === "pattern") {
    pushMany(indexes.patternRefsBySlug.get(candidate.id));
    if (candidate.patternSlug && candidate.patternSlug !== candidate.id) {
      pushMany(indexes.patternRefsBySlug.get(candidate.patternSlug));
    }
  }

  const deduped = new Map<string, UsageEntry>();
  for (const entry of usageEntries) {
    const isSelfContent = candidate.type === "content"
      && (entry.kind === "page" || entry.kind === "post" || entry.kind === "cpt")
      && entry.identifier === candidate.id;
    const isSelfPattern = candidate.type === "pattern"
      && entry.kind === "pattern"
      && candidate.path
      && entry.identifier === candidate.path;
    const isSelfTemplate = candidate.type === "template"
      && (entry.kind === "template" || entry.kind === "template-part")
      && candidate.path
      && entry.identifier === candidate.path;
    if (isSelfContent || isSelfPattern || isSelfTemplate) {
      continue;
    }

    const key = `${entry.kind}::${entry.identifier}::${entry.reason}::${entry.title ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    if (left.identifier !== right.identifier) {
      return left.identifier.localeCompare(right.identifier);
    }
    return left.reason.localeCompare(right.reason);
  });
}

type ProjectRouteLogicDeps = {
  configuredWpRoot: string;
  wpCli: string;
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
        input: {
          mode: "full"
        }
      },
      indexStatus: status
    }
  );
}

export function executeAuditComponentLogic(
  body: AuditComponentRequest,
  deps: ProjectRouteLogicDeps
): Record<string, unknown> {
  const wpRootInput = body.wpRoot ?? deps.configuredWpRoot;
  const wpRoot = resolveWpRoot(wpRootInput, deps.configuredWpRoot);
  if (!wpRootLooksValid(wpRoot)) {
    throw new AppError(
      "WP_ROOT_INVALID",
      "Invalid WP root. Expected `wp-includes` in wpRoot or `wp-config.php` in wpRoot (or its parent).",
      400,
      { wpRoot }
    );
  }

  const normalized = normalizeAuditComponentQuery(body);
  const rawLimit = typeof body.limit === "number" && Number.isFinite(body.limit)
    ? Math.floor(body.limit)
    : 20;
  const limit = Math.min(100, Math.max(1, rawLimit));

  requireReadyIndex(wpRoot);
  const dbPath = getIndexPaths(wpRoot).dbPath;
  const db = new BetterSqlite3(dbPath);

  try {
    const queryTerms = sortedUnique([
      normalized.query.name,
      ...normalized.query.name.split(" "),
      ...normalized.query.variantHints,
      ...normalized.query.blockNames,
      ...normalized.query.classNames,
      ...normalized.query.componentLabels
    ]).filter((term) => term.length > 1);

    const blockNameClause = buildOrLikeClause(
      ["id", "name", "sourceType", "path", "attrsJson", "stylesJson", "variationsJson"],
      queryTerms
    );
    const patternNameClause = buildOrLikeClause(["id", "slug", "title", "path"], queryTerms);
    const templateNameClause = buildOrLikeClause(["id", "type", "path", "includesJson"], queryTerms);
    const contentNameClause = buildOrLikeClause(
      ["CAST(postId AS TEXT)", "postType", "title", "contentSearchText"],
      queryTerms
    );

    const blockWhere = blockNameClause ? `WHERE ${blockNameClause.clause}` : "";
    const patternWhere = patternNameClause ? `WHERE ${patternNameClause.clause}` : "";
    const templateWhere = templateNameClause ? `WHERE ${templateNameClause.clause}` : "";
    const contentWhere = contentNameClause ? `WHERE ${contentNameClause.clause}` : "";

    const blockRows = db
      .prepare(
        `SELECT id, name, sourceType, path, attrsJson, stylesJson, variationsJson FROM blocks ${blockWhere} ORDER BY path ASC LIMIT ?`
      )
      .all(...(blockNameClause?.params ?? []), limit * 6) as BlockCandidateRow[];
    const patternRows = db
      .prepare(
        `SELECT id, slug, title, path, markerSignature, blockFingerprint FROM patterns ${patternWhere} ORDER BY path ASC LIMIT ?`
      )
      .all(...(patternNameClause?.params ?? []), limit * 6) as PatternCandidateRow[];
    const templateRows = db
      .prepare(
        `SELECT id, type, path, includesJson, blockFingerprint FROM templates ${templateWhere} ORDER BY path ASC LIMIT ?`
      )
      .all(...(templateNameClause?.params ?? []), limit * 6) as TemplateCandidateRow[];
    const contentRows = db
      .prepare(
        `SELECT postId, postType, title, markerSignature, blockFingerprint, contentSearchText FROM content ${contentWhere} ORDER BY postId DESC LIMIT ?`
      )
      .all(...(contentNameClause?.params ?? []), limit * 6) as ContentCandidateRow[];

    const blockCandidates = blockRows.map((row): AuditCandidate => {
      const searchable = [
        row.id,
        row.name,
        row.sourceType,
        row.path,
        row.attrsJson ?? "",
        row.stylesJson ?? "",
        row.variationsJson ?? ""
      ];
      const scored = scoreAuditCandidate("block", searchable, normalized.query, 0.08);
      const candidate: AuditCandidate = {
        type: "block",
        id: row.id,
        path: row.path,
        score: scored.score,
        reasons: scored.reasons,
        variantHits: scored.variantHits,
        enableSteps: [],
        markerSignature: null,
        blockFingerprint: null,
        patternSlug: null
      };
      candidate.enableSteps = enableStepsForCandidate("block", candidate);
      return candidate;
    });

    const patternCandidates = patternRows.map((row): AuditCandidate => {
      const searchable = [row.id, row.slug, row.title, row.path];
      const scored = scoreAuditCandidate("pattern", searchable, normalized.query, 0.06);
      const candidate: AuditCandidate = {
        type: "pattern",
        id: row.id,
        path: row.path,
        score: scored.score,
        reasons: scored.reasons,
        variantHits: scored.variantHits,
        enableSteps: [],
        markerSignature: row.markerSignature,
        blockFingerprint: row.blockFingerprint,
        patternSlug: row.slug
      };
      candidate.enableSteps = enableStepsForCandidate("pattern", candidate);
      return candidate;
    });

    const templateCandidates = templateRows.map((row): AuditCandidate => {
      const searchable = [row.id, row.type, row.path, row.includesJson ?? ""];
      const scored = scoreAuditCandidate("template", searchable, normalized.query, 0.05);
      const candidate: AuditCandidate = {
        type: "template",
        id: row.id,
        path: row.path,
        score: scored.score,
        reasons: scored.reasons,
        variantHits: scored.variantHits,
        enableSteps: [],
        markerSignature: parseMarkerFromTemplateIncludes(row.includesJson),
        blockFingerprint: row.blockFingerprint,
        patternSlug: null
      };
      candidate.enableSteps = enableStepsForCandidate("template", candidate);
      return candidate;
    });

    const contentCandidates = contentRows.map((row): AuditCandidate => {
      const searchable = [
        String(row.postId),
        row.postType,
        row.title ?? "",
        row.contentSearchText ?? ""
      ];
      const scored = scoreAuditCandidate("content", searchable, normalized.query, 0.04);
      const candidate: AuditCandidate = {
        type: "content",
        id: String(row.postId),
        path: null,
        score: scored.score,
        reasons: scored.reasons,
        variantHits: scored.variantHits,
        enableSteps: [],
        markerSignature: row.markerSignature,
        blockFingerprint: row.blockFingerprint,
        patternSlug: null
      };
      candidate.enableSteps = enableStepsForCandidate("content", candidate);
      return candidate;
    });

    const rankedCandidates = rankAuditCandidates([
      ...blockCandidates,
      ...patternCandidates,
      ...templateCandidates,
      ...contentCandidates
    ]).slice(0, limit);

    const usageIndexes = buildUsageIndexes(wpRoot, db);
    const rankedCandidatesWithUsage = rankedCandidates.map((candidate) => {
      const usage = collectUsageForCandidate(candidate, usageIndexes);
      const usageReasonSuffix = usage.length > 0 ? `in-use evidence: ${usage.length} matches` : "";
      return {
        ...candidate,
        reasons: usageReasonSuffix
          ? sortedUniquePreserveCase([...candidate.reasons, usageReasonSuffix])
          : candidate.reasons,
        usage
      };
    });

    const bestCandidate = rankedCandidatesWithUsage[0] ?? null;
    const verdict = decideAuditVerdict(bestCandidate?.score ?? 0);
    const variantInsights = buildVariantInsights(wpRoot, deps.wpCli, db, normalized.query, rankedCandidatesWithUsage);

    const strongMatchUsed = Boolean(
      bestCandidate
      && bestCandidate.score >= STRONG_MATCH_SCORE_THRESHOLD
      && (bestCandidate.usage?.length ?? 0) > 0
    );
    const partialMatchExists = Boolean(
      bestCandidate
      && bestCandidate.score >= PARTIAL_MATCH_SCORE_THRESHOLD
      && bestCandidate.score < STRONG_MATCH_SCORE_THRESHOLD
    );
    const clearVariantMechanism = hasClearVariantMechanism(variantInsights);

    // Reuse > Extend > Create decision order.
    const recommendationAction: RecommendationAction = strongMatchUsed
      ? "reuse"
      : partialMatchExists && clearVariantMechanism
        ? "extend"
        : "create";

    const usage = {
      content: {
        count: contentCandidates.filter((candidate) => candidate.score > 0).length,
        matches: contentCandidates
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score || b.id.localeCompare(a.id))
          .slice(0, 5)
          .map((candidate) => ({
            id: candidate.id,
            score: candidate.score,
            reasons: candidate.reasons
          }))
      },
      patterns: {
        count: patternCandidates.filter((candidate) => candidate.score > 0).length,
        matches: patternCandidates
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
          .slice(0, 5)
          .map((candidate) => ({
            id: candidate.id,
            path: candidate.path,
            score: candidate.score,
            reasons: candidate.reasons
          }))
      },
      templates: {
        count: templateCandidates.filter((candidate) => candidate.score > 0).length,
        matches: templateCandidates
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
          .slice(0, 5)
          .map((candidate) => ({
            id: candidate.id,
            path: candidate.path,
            score: candidate.score,
            reasons: candidate.reasons
          }))
      }
    };

    const lowestRiskApproach: LowestRiskApproach = recommendationAction === "reuse"
      ? (bestCandidate ? pickReuseApproach(bestCandidate, variantInsights) : "new-block")
      : recommendationAction === "extend"
        ? mapMechanismToApproach(variantInsights.recommendedMechanism.id)
        : "new-block";

    const recommendationWhy = strongMatchUsed
      ? "Strong in-use match exists, so reuse is lowest risk."
      : partialMatchExists && clearVariantMechanism
        ? "Partial match and a clear variant mechanism exist, so extending is lowest risk."
        : bestCandidate
          ? "Closest match is weak or lacks variant support, so creating new is lowest risk."
          : "No viable indexed match found, so creating new is lowest risk.";

    return formatAuditComponentPublicResult({
      verdict,
      bestCandidate,
      variantInsights,
      usage,
      recommendationAction,
      lowestRiskApproach,
      recommendationWhy
    });
  } finally {
    db.close();
  }
}

export function executeSearchSimilarLogic(
  body: SearchSimilarRequest,
  deps: ProjectRouteLogicDeps
): Record<string, unknown> {
  const wpRootInput = body.wpRoot ?? deps.configuredWpRoot;
  const wpRoot = resolveWpRoot(wpRootInput, deps.configuredWpRoot);
  if (!wpRootLooksValid(wpRoot)) {
    throw new AppError(
      "WP_ROOT_INVALID",
      "Invalid WP root. Expected `wp-includes` in wpRoot or `wp-config.php` in wpRoot (or its parent).",
      400,
      { wpRoot }
    );
  }

  const componentNameFromQuery = normalizeSearchText(body.query);
  const componentNameFromLegacyField = normalizeSearchText(body.componentName);
  const classNames = sortedUnique([
    ...normalizeStringArray(body.classNames),
    normalizeSearchText(body.className)
  ].filter((value): value is string => value.length > 0));
  const blockNames = normalizeStringArray(body.blockNames);
  const snippet = typeof body.snippet === "string" ? body.snippet.trim() : "";
  const componentName = componentNameFromQuery
    || componentNameFromLegacyField
    || blockNames[0]
    || classNames[0]
    || (snippet ? "snippet" : "");
  if (!componentName) {
    throw new AppError(
      "INVALID_SEARCH_INPUT",
      "Invalid search input. Provide `query` (preferred) or advanced fields (`className`, `classNames`, `blockNames`, `snippet`).",
      400
    );
  }

  const parsedLimit = typeof body.limit === "number" && Number.isFinite(body.limit)
    ? body.limit
    : Number.NaN;
  const rawLimit = Number.isFinite(parsedLimit) ? Math.floor(parsedLimit) : 25;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const groupLimit = Math.min(10, Math.max(5, limit));
  const nameTerms = Array.from(new Set([componentName, ...blockNames]));

  const markerSourceFragments: string[] = [];
  if (classNames.length > 0) {
    markerSourceFragments.push(`<div class="${classNames.join(" ")}"></div>`);
  }
  if (snippet) {
    markerSourceFragments.push(snippet);
  }
  const markerQuerySource = markerSourceFragments.join("\n");
  const queryMarkers = markerQuerySource ? extractMarkers(markerQuerySource) : null;
  const queryMarkerTokens = queryMarkers ? markerTokenSet(queryMarkers) : new Set<string>();
  const queryMarkerSignature = queryMarkers ? sha256(JSON.stringify(queryMarkers)) : null;
  const snippetSequence = snippet ? extractBlockSequence(snippet) : [];
  const queryBlockSequence = snippetSequence.length > 0 ? snippetSequence : blockNames;
  const queryBlockFingerprint = computeBlockFingerprintFromSequence(queryBlockSequence);

  requireReadyIndex(wpRoot);
  const dbPath = getIndexPaths(wpRoot).dbPath;
  const db = new BetterSqlite3(dbPath);

  try {
    const contentConditions: string[] = [];
    const contentParams: Array<string> = [];
    const contentNameClause = buildOrLikeClause(
      ["CAST(postId AS TEXT)", "postType", "title", "contentSearchText"],
      nameTerms
    );
    if (contentNameClause) {
      contentConditions.push(`(${contentNameClause.clause})`);
      contentParams.push(...contentNameClause.params);
    }
    if (queryMarkerSignature) {
      contentConditions.push("markerSignature = ?");
      contentParams.push(queryMarkerSignature);
    }
    if (queryBlockFingerprint) {
      contentConditions.push("blockFingerprint = ?");
      contentParams.push(queryBlockFingerprint);
    }

    const contentWhere = contentConditions.length > 0 ? `WHERE ${contentConditions.join(" OR ")}` : "";
    const contentRows = db
      .prepare(
        `SELECT postId, postType, title, markerSignature, blockFingerprint, contentSearchText FROM content ${contentWhere} ORDER BY postId DESC LIMIT ?`
      )
      .all(...contentParams, limit * 3) as ContentCandidateRow[];

    const postmetaConditions: string[] = [];
    const postmetaParams: Array<string> = [];
    const postmetaNameClause = buildOrLikeClause(["CAST(postId AS TEXT)", "metaKey", "content"], [
      ...nameTerms,
      ...classNames
    ]);
    if (postmetaNameClause) {
      postmetaConditions.push(`(${postmetaNameClause.clause})`);
      postmetaParams.push(...postmetaNameClause.params);
    }
    if (queryMarkerSignature) {
      postmetaConditions.push("markerSignature = ?");
      postmetaParams.push(queryMarkerSignature);
    }
    const postmetaWhere = postmetaConditions.length > 0 ? `WHERE ${postmetaConditions.join(" OR ")}` : "";
    const postmetaRows = db
      .prepare(
        `SELECT id, postId, metaKey, content, markerSignature FROM postmeta_index ${postmetaWhere} ORDER BY postId DESC LIMIT ?`
      )
      .all(...postmetaParams, limit * 4) as PostmetaCandidateRow[];

    const optionConditions: string[] = [];
    const optionParams: Array<string> = [];
    const optionNameClause = buildOrLikeClause(["optionName", "content"], [...nameTerms, ...classNames]);
    if (optionNameClause) {
      optionConditions.push(`(${optionNameClause.clause})`);
      optionParams.push(...optionNameClause.params);
    }
    if (queryMarkerSignature) {
      optionConditions.push("markerSignature = ?");
      optionParams.push(queryMarkerSignature);
    }
    const optionWhere = optionConditions.length > 0 ? `WHERE ${optionConditions.join(" OR ")}` : "";
    const optionRows = db
      .prepare(
        `SELECT id, optionName, content, markerSignature FROM options_index ${optionWhere} ORDER BY optionName ASC LIMIT ?`
      )
      .all(...optionParams, limit * 4) as OptionCandidateRow[];

    const menuConditions: string[] = [];
    const menuParams: Array<string> = [];
    const menuNameClause = buildOrLikeClause(["CAST(postId AS TEXT)", "title", "content"], [
      ...nameTerms,
      ...classNames
    ]);
    if (menuNameClause) {
      menuConditions.push(`(${menuNameClause.clause})`);
      menuParams.push(...menuNameClause.params);
    }
    if (queryMarkerSignature) {
      menuConditions.push("markerSignature = ?");
      menuParams.push(queryMarkerSignature);
    }
    const menuWhere = menuConditions.length > 0 ? `WHERE ${menuConditions.join(" OR ")}` : "";
    const menuRows = db
      .prepare(
        `SELECT id, postId, title, content, markerSignature FROM menus_index ${menuWhere} ORDER BY postId DESC LIMIT ?`
      )
      .all(...menuParams, limit * 4) as MenuCandidateRow[];

    const patternConditions: string[] = [];
    const patternParams: Array<string> = [];
    const patternNameClause = buildOrLikeClause(["id", "slug", "title", "path"], nameTerms);
    if (patternNameClause) {
      patternConditions.push(`(${patternNameClause.clause})`);
      patternParams.push(...patternNameClause.params);
    }
    if (queryMarkerSignature) {
      patternConditions.push("markerSignature = ?");
      patternParams.push(queryMarkerSignature);
    }
    if (queryBlockFingerprint) {
      patternConditions.push("blockFingerprint = ?");
      patternParams.push(queryBlockFingerprint);
    }

    const patternWhere = patternConditions.length > 0 ? `WHERE ${patternConditions.join(" OR ")}` : "";
    const patternRows = db
      .prepare(
        `SELECT id, slug, title, path, markerSignature, blockFingerprint FROM patterns ${patternWhere} ORDER BY path ASC LIMIT ?`
      )
      .all(...patternParams, limit * 3) as PatternCandidateRow[];

    const templateConditions: string[] = [];
    const templateParams: string[] = [];
    const templateNameClause = buildOrLikeClause(["id", "type", "path"], nameTerms);
    if (templateNameClause) {
      templateConditions.push(`(${templateNameClause.clause})`);
      templateParams.push(...templateNameClause.params);
    }
    if (queryBlockFingerprint) {
      templateConditions.push("blockFingerprint = ?");
      templateParams.push(queryBlockFingerprint);
    }
    const templateWhere = templateConditions.length > 0
      ? `WHERE ${templateConditions.join(" OR ")}`
      : "";
    const templateRows = db
      .prepare(
        `SELECT id, type, path, includesJson, blockFingerprint FROM templates ${templateWhere} ORDER BY path ASC LIMIT ?`
      )
      .all(...templateParams, limit * 5) as TemplateCandidateRow[];

    const contentMatches = contentRows
      .map((row): ContentSearchMatch | null => {
        const snippetSource = `${row.title ?? ""} ${row.postType ?? ""} ${row.contentSearchText ?? ""}`.trim();
        const { score, confidence, reason, reasons } = scoreCandidate(
          "content",
          [
            String(row.postId),
            row.postType ?? "",
            row.title ?? "",
            row.contentSearchText ?? ""
          ],
          componentName,
          blockNames,
          queryMarkerTokens,
          row.markerSignature,
          null,
          queryMarkerSignature,
          queryBlockFingerprint,
          queryBlockSequence,
          row.blockFingerprint,
          null,
          {
            rawContent: snippetSource
          }
        );
        if (confidence <= 0 || reasons.length === 0) {
          return null;
        }
        return {
          postId: row.postId,
          postType: row.postType,
          title: row.title ?? "",
          identifier: `post_id:${row.postId}`,
          score,
          snippet: buildPreviewSnippet(snippetSource, componentName),
          reason,
          slug: null,
          url: null,
          confidence,
          reasons
        };
      })
      .filter((match): match is ContentSearchMatch => match !== null)
      .sort((a, b) => b.score - a.score || b.postId - a.postId);
    const contentMetadataResolution = resolveContentMetadata(
      wpRoot,
      contentMatches.map((match) => match.postId)
    );
    const contentMetadataByPostId = contentMetadataResolution.metadataByPostId;
    const enrichedContentMatches = contentMatches.map((match) => {
      const metadata = contentMetadataByPostId.get(match.postId);
      const metadataLookupWarning = contentMetadataResolution.warning;
      return {
        ...match,
        slug: metadata?.slug ?? null,
        url: metadata?.url ?? null,
        reasons: metadataLookupWarning
          ? sortedUnique([...match.reasons, metadataLookupWarning])
          : match.reasons
      };
    })
      .slice(0, groupLimit);

    const postmetaMatches = postmetaRows
      .map((row): PostmetaSearchMatch | null => {
        const { score, confidence, reason, reasons } = scoreCandidate(
          "postmeta",
          [String(row.postId), row.metaKey, row.content],
          componentName,
          blockNames,
          queryMarkerTokens,
          row.markerSignature,
          null,
          queryMarkerSignature,
          null,
          [],
          null,
          null,
          {
            rawContent: row.content,
            metaKey: row.metaKey
          }
        );
        if (confidence <= 0 || reasons.length === 0) {
          return null;
        }
        const snippet = buildPreviewSnippet(row.content, componentName);
        return {
          id: row.id,
          postId: row.postId,
          metaKey: row.metaKey,
          identifier: `post_id:${row.postId}`,
          score,
          snippet,
          reason,
          preview: snippet,
          confidence,
          reasons
        };
      })
      .filter((match): match is PostmetaSearchMatch => match !== null)
      .sort((a, b) => b.score - a.score || b.postId - a.postId);
    const dedupedPostmetaMatches = dedupeByKey(
      postmetaMatches,
      (match) => `${match.postId}:${match.snippet.slice(0, 80)}`,
      (left, right) => {
        const useRight = right.score > left.score;
        const winning = useRight ? right : left;
        const mergedScore = mergeScores(left.score, right.score);
        return {
          ...winning,
          score: mergedScore,
          confidence: mergedScore,
          reasons: sortedUnique([...left.reasons, ...right.reasons]),
          reason: winning.reason || left.reason
        };
      }
    ).slice(0, groupLimit);

    const optionMatches = optionRows
      .map((row): OptionSearchMatch | null => {
        const { score, confidence, reason, reasons } = scoreCandidate(
          "options",
          [row.optionName, row.content],
          componentName,
          blockNames,
          queryMarkerTokens,
          row.markerSignature,
          null,
          queryMarkerSignature,
          null,
          [],
          null,
          null,
          {
            rawContent: row.content
          }
        );
        if (confidence <= 0 || reasons.length === 0) {
          return null;
        }
        const snippet = buildPreviewSnippet(row.content, componentName);
        return {
          id: row.id,
          optionName: row.optionName,
          identifier: `option_name:${row.optionName}`,
          score,
          snippet,
          reason,
          preview: snippet,
          confidence,
          reasons
        };
      })
      .filter((match): match is OptionSearchMatch => match !== null)
      .sort((a, b) => b.score - a.score || a.optionName.localeCompare(b.optionName));
    const dedupedOptionMatches = dedupeByKey(
      optionMatches,
      (match) => match.optionName.toLowerCase(),
      (left, right) => {
        const useRight = right.score > left.score;
        const winning = useRight ? right : left;
        const mergedScore = mergeScores(left.score, right.score);
        return {
          ...winning,
          score: mergedScore,
          confidence: mergedScore,
          reasons: sortedUnique([...left.reasons, ...right.reasons]),
          reason: winning.reason || left.reason
        };
      }
    ).slice(0, groupLimit);

    const menuMatches = menuRows
      .map((row): MenuSearchMatch | null => {
        const { score, confidence, reason, reasons } = scoreCandidate(
          "menus",
          [String(row.postId), row.title ?? "", row.content],
          componentName,
          blockNames,
          queryMarkerTokens,
          row.markerSignature,
          null,
          queryMarkerSignature,
          null,
          [],
          null,
          null,
          {
            rawContent: `${row.title ?? ""} ${row.content ?? ""}`
          }
        );
        if (confidence <= 0 || reasons.length === 0) {
          return null;
        }
        const snippet = buildPreviewSnippet(`${row.title ?? ""} ${row.content}`, componentName);
        return {
          id: row.id,
          postId: row.postId,
          title: row.title ?? "",
          identifier: `menu_post_id:${row.postId}`,
          score,
          snippet,
          reason,
          preview: snippet,
          confidence,
          reasons
        };
      })
      .filter((match): match is MenuSearchMatch => match !== null)
      .sort((a, b) => b.score - a.score || b.postId - a.postId);
    const dedupedMenuMatches = dedupeByKey(
      menuMatches,
      (match) => String(match.postId),
      (left, right) => {
        const useRight = right.score > left.score;
        const winning = useRight ? right : left;
        const mergedScore = mergeScores(left.score, right.score);
        return {
          ...winning,
          score: mergedScore,
          confidence: mergedScore,
          reasons: sortedUnique([...left.reasons, ...right.reasons]),
          reason: winning.reason || left.reason
        };
      }
    ).slice(0, groupLimit);

    const patternMatches = patternRows
      .map((row): PatternSearchMatch | null => {
        const candidateSignals = readIndexedFileSignals(wpRoot, row.path);
        const rawContent = candidateSignals?.rawContent ?? `${row.title} ${row.slug} ${row.path}`;
        const { score, confidence, reason, reasons } = scoreCandidate(
          "patterns",
          [row.id, row.slug, row.title, row.path],
          componentName,
          blockNames,
          queryMarkerTokens,
          row.markerSignature,
          candidateSignals?.markerTokens ?? null,
          queryMarkerSignature,
          queryBlockFingerprint,
          queryBlockSequence,
          row.blockFingerprint,
          candidateSignals?.blockSequence ?? null,
          {
            rawContent
          }
        );
        if (confidence <= 0 || reasons.length === 0) {
          return null;
        }
        return {
          id: row.id,
          slug: row.slug,
          title: row.title,
          path: row.path,
          identifier: `pattern:${row.path}`,
          score,
          snippet: buildPreviewSnippet(rawContent, componentName),
          reason,
          confidence,
          reasons
        };
      })
      .filter((match): match is PatternSearchMatch => match !== null)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, groupLimit);

    const templateMatches = templateRows
      .map((row): TemplateSearchMatch | null => {
        const templateMarker = parseMarkerFromTemplateIncludes(row.includesJson);
        const candidateSignals = readIndexedFileSignals(wpRoot, row.path);
        const rawContent = candidateSignals?.rawContent ?? `${row.type} ${row.path}`;
        const { score, confidence, reason, reasons } = scoreCandidate(
          "templates",
          [row.id, row.type, row.path],
          componentName,
          blockNames,
          queryMarkerTokens,
          templateMarker,
          candidateSignals?.markerTokens ?? null,
          queryMarkerSignature,
          queryBlockFingerprint,
          queryBlockSequence,
          row.blockFingerprint,
          candidateSignals?.blockSequence ?? null,
          {
            rawContent
          }
        );
        if (confidence <= 0 || reasons.length === 0) {
          return null;
        }
        return {
          id: row.id,
          type: row.type,
          path: row.path,
          identifier: `template:${row.path}`,
          score,
          snippet: buildPreviewSnippet(rawContent, componentName),
          reason,
          confidence,
          reasons
        };
      })
      .filter((match): match is TemplateSearchMatch => match !== null)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, groupLimit);

    const customTableMatches: CustomTableSearchMatch[] = [];

    const files: FileSearchMatch[] = [];

    return formatFindSimilarPublicResult({
      queryEcho: {
        query: componentName,
        classNames,
        blockNames,
        snippet,
        limit
      },
      contentMatches: enrichedContentMatches,
      postmetaMatches: dedupedPostmetaMatches,
      optionMatches: dedupedOptionMatches,
      menuMatches: dedupedMenuMatches,
      patternMatches,
      templateMatches,
      customTableMatches,
      files
    });
  } finally {
    db.close();
  }
}

function buildWhereIsUsedRecommendation(input: {
  templates: number;
  patterns: number;
  files: number;
  content: number;
  menus: number;
  postmeta: number;
  options: number;
  customTables: number;
  topTemplatePath: string | null;
}): string {
  const highSignalCount = input.templates + input.patterns + input.files + input.content;
  const lowSignalCount = input.postmeta + input.options + input.customTables;
  if (highSignalCount === 0 && lowSignalCount === 0 && input.menus === 0) {
    return "No direct usage found. Try related class names, block names, or function aliases and rerun `where_is_used`.";
  }
  if (input.templates > 0 && input.content > 0) {
    return `Primary usage appears in template "${input.topTemplatePath ?? "top-ranked template"}" and is reused in ${input.content} content records.`;
  }
  if (highSignalCount === 0 && lowSignalCount > 0) {
    return "Usage appears only in postmeta/options/custom-table data and is likely managed by ACF or plugin settings.";
  }
  if (input.templates + input.patterns + input.files >= 3) {
    return "Multiple similar usages were found in theme/plugin files. Inspect top templates and patterns before editing.";
  }
  return "Top matches are likely authoritative. Validate the highest-ranked template/pattern entries before changing downstream content.";
}

function detectIndexedCustomTable(db: SqliteDatabase): {
  tableName: string;
  contentColumn: string;
  rowIdColumn: string | null;
  sourceColumn: string | null;
} | null {
  const tableCandidates = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
    .all() as Array<{ name: string }>;
  const preferredNames = ["custom_tables_index", "custom_table_index", "custom_tables"];
  const ordered = [
    ...preferredNames.filter((name) => tableCandidates.some((row) => row.name === name)),
    ...tableCandidates.map((row) => row.name).filter((name) => !preferredNames.includes(name))
  ];

  for (const tableName of ordered) {
    const safeTable = sqliteIdentifier(tableName);
    if (!safeTable) {
      continue;
    }
    const columns = db
      .prepare(`PRAGMA table_info(${safeTable})`)
      .all() as Array<{ name?: string }>;
    const columnNames = columns
      .map((column) => (typeof column.name === "string" ? column.name : ""))
      .filter((columnName) => columnName.length > 0);
    const lowered = new Map(columnNames.map((name) => [name.toLowerCase(), name]));
    const contentColumn = lowered.get("content") ?? lowered.get("value") ?? lowered.get("text");
    if (!contentColumn) {
      continue;
    }
    const rowIdColumn = lowered.get("rowid") ?? lowered.get("row_id") ?? lowered.get("id") ?? null;
    const sourceColumn = lowered.get("source_name")
      ?? lowered.get("tablename")
      ?? lowered.get("table_name")
      ?? lowered.get("source")
      ?? null;
    return {
      tableName,
      contentColumn,
      rowIdColumn,
      sourceColumn
    };
  }
  return null;
}

export function executeWhereIsUsedLogic(
  body: WhereIsUsedRequest,
  deps: ProjectRouteLogicDeps
): Record<string, unknown> {
  const wpRootInput = body.wpRoot ?? deps.configuredWpRoot;
  const wpRoot = resolveWpRoot(wpRootInput, deps.configuredWpRoot);
  if (!wpRootLooksValid(wpRoot)) {
    throw new AppError(
      "WP_ROOT_INVALID",
      "Invalid WP root. Expected `wp-includes` in wpRoot or `wp-config.php` in wpRoot (or its parent).",
      400,
      { wpRoot }
    );
  }

  const rawQuery = normalizeWhereIsUsedQuery(body.query);
  if (!rawQuery) {
    throw new AppError("INVALID_SEARCH_INPUT", "Invalid `query`. Provide a non-empty string.", 400);
  }

  const requestedKind = normalizeWhereIsUsedKind(body.kind);
  const detectedKind = (requestedKind === "auto"
    ? detectWhereIsUsedKind(rawQuery)
    : requestedKind) as Exclude<WhereIsUsedKind, "auto">;
  const scope = normalizeWhereIsUsedScope(body.scope);
  const parsedLimit = typeof body.limitPerGroup === "number" && Number.isFinite(body.limitPerGroup)
    ? Math.floor(body.limitPerGroup)
    : 10;
  const limitPerGroup = Math.max(1, Math.min(50, parsedLimit));

  const querySignals = buildWhereIsUsedSignals(rawQuery, detectedKind);
  const markerQuerySource = [querySignals.snippet, rawQuery].filter((entry) => entry.length > 0).join("\n");
  const queryMarkers = markerQuerySource ? extractMarkers(markerQuerySource) : null;
  const queryMarkerTokens = queryMarkers ? markerTokenSet(queryMarkers) : new Set<string>();
  const queryMarkerSignature = queryMarkers ? sha256(JSON.stringify(queryMarkers)) : null;
  const queryBlockSequence = querySignals.snippet ? extractBlockSequence(querySignals.snippet) : querySignals.blockNames;
  const queryBlockFingerprint = computeBlockFingerprintFromSequence(queryBlockSequence);
  const queryRegex = buildSearchRegex(querySignals.likeTerms);

  requireReadyIndex(wpRoot);
  const dbPath = getIndexPaths(wpRoot).dbPath;
  const db = new BetterSqlite3(dbPath);

  try {
    const broadLimit = Math.max(limitPerGroup * 20, 200);

    const contentConditions: string[] = [];
    const contentParams: string[] = [];
    const contentLikeClause = buildOrLikeClause(
      ["CAST(postId AS TEXT)", "postType", "title", "contentSearchText"],
      querySignals.likeTerms
    );
    if (contentLikeClause) {
      contentConditions.push(`(${contentLikeClause.clause})`);
      contentParams.push(...contentLikeClause.params);
    }
    if (queryMarkerSignature) {
      contentConditions.push("markerSignature = ?");
      contentParams.push(queryMarkerSignature);
    }
    if (queryBlockFingerprint) {
      contentConditions.push("blockFingerprint = ?");
      contentParams.push(queryBlockFingerprint);
    }
    const contentWhere = contentConditions.length > 0 ? `WHERE ${contentConditions.join(" OR ")}` : "";
    const contentRows = scope.content
      ? db
        .prepare(
          `SELECT postId, postType, title, markerSignature, blockFingerprint, contentSearchText FROM content ${contentWhere} ORDER BY postId DESC LIMIT ?`
        )
        .all(...contentParams, broadLimit) as ContentCandidateRow[]
      : [];

    const postmetaRows = scope.postmeta
      ? db
        .prepare(
          `SELECT id, postId, metaKey, content, markerSignature FROM postmeta_index WHERE ${
            buildOrLikeClause(["CAST(postId AS TEXT)", "metaKey", "content"], querySignals.likeTerms)?.clause
            ?? "1=0"
          } ORDER BY postId DESC LIMIT ?`
        )
        .all(...(buildOrLikeClause(["CAST(postId AS TEXT)", "metaKey", "content"], querySignals.likeTerms)?.params ?? []), broadLimit) as PostmetaCandidateRow[]
      : [];

    const optionRows = scope.options
      ? db
        .prepare(
          `SELECT id, optionName, content, markerSignature FROM options_index WHERE ${
            buildOrLikeClause(["optionName", "content"], querySignals.likeTerms)?.clause
            ?? "1=0"
          } ORDER BY optionName ASC LIMIT ?`
        )
        .all(...(buildOrLikeClause(["optionName", "content"], querySignals.likeTerms)?.params ?? []), broadLimit) as OptionCandidateRow[]
      : [];

    const menuRows = scope.menus
      ? db
        .prepare(
          `SELECT id, postId, title, content, markerSignature FROM menus_index WHERE ${
            buildOrLikeClause(["CAST(postId AS TEXT)", "title", "content"], querySignals.likeTerms)?.clause
            ?? "1=0"
          } ORDER BY postId DESC LIMIT ?`
        )
        .all(...(buildOrLikeClause(["CAST(postId AS TEXT)", "title", "content"], querySignals.likeTerms)?.params ?? []), broadLimit) as MenuCandidateRow[]
      : [];

    const patternRows = db
      .prepare(
        "SELECT id, slug, title, path, markerSignature, blockFingerprint FROM patterns ORDER BY path ASC LIMIT ?"
      )
      .all(broadLimit) as PatternCandidateRow[];

    const templateRows = db
      .prepare(
        "SELECT id, type, path, includesJson, blockFingerprint FROM templates ORDER BY path ASC LIMIT ?"
      )
      .all(broadLimit) as TemplateCandidateRow[];

    const contentMatches = contentRows
      .map((row) => {
        const snippetSource = `${row.title ?? ""} ${row.postType ?? ""} ${row.contentSearchText ?? ""}`.trim();
        const scored = scoreCandidate(
          "content",
          [
            String(row.postId),
            row.postType ?? "",
            row.title ?? "",
            row.contentSearchText ?? ""
          ],
          querySignals.componentName,
          querySignals.blockNames,
          queryMarkerTokens,
          row.markerSignature,
          null,
          queryMarkerSignature,
          queryBlockFingerprint,
          queryBlockSequence,
          row.blockFingerprint,
          null,
          { rawContent: snippetSource }
        );
        if (scored.score <= 0) {
          return null;
        }
        return {
          sourceType: "content",
          identifier: `post_id:${row.postId}`,
          post_id: row.postId,
          post_type: row.postType,
          title: row.title ?? "",
          score: scored.score,
          snippet: buildPreviewSnippet(snippetSource, querySignals.componentName),
          reason: scored.reason
        };
      })
      .filter(isDefined)
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limitPerGroup);

    const postmetaMatches = dedupeByKey(
      postmetaRows
        .map((row) => {
          const scored = scoreCandidate(
            "postmeta",
            [String(row.postId), row.metaKey, row.content],
            querySignals.componentName,
            querySignals.blockNames,
            queryMarkerTokens,
            row.markerSignature,
            null,
            queryMarkerSignature,
            null,
            [],
            null,
            null,
            { rawContent: row.content, metaKey: row.metaKey }
          );
          if (scored.score <= 0) {
            return null;
          }
          return {
            sourceType: "postmeta",
            identifier: `post_id:${row.postId}`,
            post_id: row.postId,
            meta_key: row.metaKey,
            score: scored.score,
            snippet: buildPreviewSnippet(row.content, querySignals.componentName),
            reason: scored.reason
          };
        })
        .filter(isDefined),
      (row) => `${String(row.post_id)}:${String(row.meta_key)}`,
      (left, right) => (Number(right.score) > Number(left.score) ? right : left)
    )
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limitPerGroup);

    const optionMatches = dedupeByKey(
      optionRows
        .map((row) => {
          const scored = scoreCandidate(
            "options",
            [row.optionName, row.content],
            querySignals.componentName,
            querySignals.blockNames,
            queryMarkerTokens,
            row.markerSignature,
            null,
            queryMarkerSignature,
            null,
            [],
            null,
            null,
            { rawContent: row.content }
          );
          if (scored.score <= 0) {
            return null;
          }
          return {
            sourceType: "options",
            identifier: `option_name:${row.optionName}`,
            option_name: row.optionName,
            score: scored.score,
            snippet: buildPreviewSnippet(row.content, querySignals.componentName),
            reason: scored.reason
          };
        })
        .filter(isDefined),
      (row) => String(row.option_name),
      (left, right) => (Number(right.score) > Number(left.score) ? right : left)
    )
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limitPerGroup);

    const menuMatches = dedupeByKey(
      menuRows
        .map((row) => {
          const raw = `${row.title ?? ""} ${row.content ?? ""}`;
          const scored = scoreCandidate(
            "menus",
            [String(row.postId), row.title ?? "", row.content],
            querySignals.componentName,
            querySignals.blockNames,
            queryMarkerTokens,
            row.markerSignature,
            null,
            queryMarkerSignature,
            null,
            [],
            null,
            null,
            { rawContent: raw }
          );
          if (scored.score <= 0) {
            return null;
          }
          return {
            sourceType: "menus",
            identifier: `menu_post_id:${row.postId}`,
            post_id: row.postId,
            title: row.title ?? "",
            score: scored.score,
            snippet: buildPreviewSnippet(raw, querySignals.componentName),
            reason: scored.reason
          };
        })
        .filter(isDefined),
      (row) => String(row.post_id),
      (left, right) => (Number(right.score) > Number(left.score) ? right : left)
    )
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limitPerGroup);

    const patternMatches = patternRows
      .map((row) => {
        const candidateSignals = readIndexedFileSignals(wpRoot, row.path);
        const rawContent = candidateSignals?.rawContent ?? `${row.title} ${row.slug} ${row.path}`;
        const scored = scoreCandidate(
          "patterns",
          [row.id, row.slug, row.title, row.path, rawContent],
          querySignals.componentName,
          querySignals.blockNames,
          queryMarkerTokens,
          row.markerSignature,
          candidateSignals?.markerTokens ?? null,
          queryMarkerSignature,
          queryBlockFingerprint,
          queryBlockSequence,
          row.blockFingerprint,
          candidateSignals?.blockSequence ?? null,
          { rawContent }
        );
        if (scored.score <= 0) {
          return null;
        }
        return {
          sourceType: "patterns",
          identifier: `pattern:${row.path}`,
          slug: row.slug,
          title: row.title,
          path: row.path,
          score: scored.score,
          snippet: buildPreviewSnippet(rawContent, querySignals.componentName),
          reason: scored.reason
        };
      })
      .filter(isDefined)
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limitPerGroup);

    const templateMatches = templateRows
      .map((row) => {
        const templateMarker = parseMarkerFromTemplateIncludes(row.includesJson);
        const candidateSignals = readIndexedFileSignals(wpRoot, row.path);
        const rawContent = candidateSignals?.rawContent ?? `${row.type} ${row.path}`;
        const scored = scoreCandidate(
          "templates",
          [row.id, row.type, row.path, rawContent],
          querySignals.componentName,
          querySignals.blockNames,
          queryMarkerTokens,
          templateMarker,
          candidateSignals?.markerTokens ?? null,
          queryMarkerSignature,
          queryBlockFingerprint,
          queryBlockSequence,
          row.blockFingerprint,
          candidateSignals?.blockSequence ?? null,
          { rawContent }
        );
        if (scored.score <= 0) {
          return null;
        }
        return {
          sourceType: "templates",
          identifier: `template:${row.path}`,
          type: row.type,
          path: row.path,
          score: scored.score,
          snippet: buildPreviewSnippet(rawContent, querySignals.componentName),
          reason: scored.reason
        };
      })
      .filter(isDefined)
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limitPerGroup);

    const customTableMatches: Record<string, unknown>[] = [];
    if (scope.customTables) {
      const indexedCustomTable = detectIndexedCustomTable(db);
      if (indexedCustomTable) {
        const safeTable = sqliteIdentifier(indexedCustomTable.tableName);
        const safeContent = sqliteIdentifier(indexedCustomTable.contentColumn);
        const safeRowId = indexedCustomTable.rowIdColumn ? sqliteIdentifier(indexedCustomTable.rowIdColumn) : null;
        const safeSource = indexedCustomTable.sourceColumn ? sqliteIdentifier(indexedCustomTable.sourceColumn) : null;
        if (safeTable && safeContent) {
          const whereClause = buildOrLikeClause(
            [safeContent, ...(safeSource ? [safeSource] : [])],
            querySignals.likeTerms
          );
          if (whereClause) {
            const rows = db
              .prepare(
                `SELECT ${
                  safeSource ?? `'${indexedCustomTable.tableName}'`
                } AS sourceName, ${
                  safeRowId ?? "rowid"
                } AS rowId, ${safeContent} AS content FROM ${safeTable} WHERE ${whereClause.clause} LIMIT ?`
              )
              .all(...whereClause.params, broadLimit) as Array<{ sourceName: string; rowId: string | number; content: string }>;
            for (const row of rows) {
              const scored = scoreCandidate(
                "custom_tables",
                [String(row.sourceName ?? ""), String(row.rowId ?? ""), String(row.content ?? "")],
                querySignals.componentName,
                querySignals.blockNames,
                queryMarkerTokens,
                null,
                null,
                queryMarkerSignature,
                null,
                [],
                null,
                null,
                { rawContent: String(row.content ?? "") }
              );
              if (scored.score <= 0) {
                continue;
              }
              customTableMatches.push({
                sourceType: "customTables",
                identifier: `${String(row.sourceName)}:${String(row.rowId)}`,
                table_name: String(row.sourceName ?? indexedCustomTable.tableName),
                row_id: String(row.rowId ?? ""),
                score: scored.score,
                snippet: buildPreviewSnippet(String(row.content ?? ""), querySignals.componentName),
                reason: scored.reason
              });
            }
          }
        }
      }
    }

    const fileMatches: Record<string, unknown>[] = [];
    if (scope.files) {
      const indexedPaths = db
        .prepare(`
          SELECT path FROM blocks
          UNION
          SELECT path FROM patterns
          UNION
          SELECT path FROM templates
          ORDER BY path ASC
          LIMIT ?
        `)
        .all(Math.max(300, broadLimit * 2)) as Array<{ path: string }>;
      for (const row of indexedPaths) {
        const relativePath = row.path;
        const absolutePath = assertWithinRoot(wpRoot, path.resolve(wpRoot, relativePath), "indexedPath");
        const content = safeReadText(absolutePath);
        if (!content || !queryRegex) {
          continue;
        }
        const candidateSignals = readIndexedFileSignals(wpRoot, relativePath);
        const markerSignature = candidateSignals ? computeMarkerSignature(candidateSignals.rawContent) : null;
        queryRegex.lastIndex = 0;
        let regexMatch: RegExpExecArray | null = null;
        while ((regexMatch = queryRegex.exec(content)) !== null) {
          const startOffset = regexMatch.index;
          const lineData = computeLineColumn(content, startOffset);
          const preview = previewForOffset(content, startOffset);
          const scored = scoreCandidate(
            "files",
            [relativePath, preview],
            querySignals.componentName,
            querySignals.blockNames,
            queryMarkerTokens,
            markerSignature,
            candidateSignals?.markerTokens ?? null,
            queryMarkerSignature,
            queryBlockFingerprint,
            queryBlockSequence,
            computeBlockFingerprintFromSequence(candidateSignals?.blockSequence ?? []),
            candidateSignals?.blockSequence ?? null,
            { rawContent: preview }
          );
          if (scored.score <= 0) {
            continue;
          }
          fileMatches.push({
            sourceType: "files",
            identifier: `file:${relativePath}:${lineData.line}`,
            path: relativePath,
            line: lineData.line,
            column: lineData.column,
            score: scored.score,
            snippet: preview,
            reason: scored.reason
          });
          if (fileMatches.length >= limitPerGroup * 8) {
            break;
          }
        }
        if (fileMatches.length >= limitPerGroup * 8) {
          break;
        }
      }
    }

    const dedupedFileMatches = dedupeByKey(
      fileMatches,
      (row) => `${String(row.path)}:${String(row.line)}`,
      (left, right) => (Number(right.score) > Number(left.score) ? right : left)
    )
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limitPerGroup);

    const groups: WhereIsUsedPublicResult["groups"] = {
      templates: templateMatches,
      patterns: patternMatches,
      files: dedupedFileMatches,
      content: contentMatches,
      menus: menuMatches,
      postmeta: postmetaMatches,
      options: optionMatches,
      customTables: customTableMatches
        .sort((a, b) => Number(b.score) - Number(a.score))
        .slice(0, limitPerGroup)
    };

    const groupsWithMatches = Object.entries(groups)
      .filter(([, matches]) => matches.length > 0)
      .map(([groupName]) => groupName);
    const totalMatches = Object.values(groups).reduce((sum, matches) => sum + matches.length, 0);
    const recommendation = buildWhereIsUsedRecommendation({
      templates: groups.templates.length,
      patterns: groups.patterns.length,
      files: groups.files.length,
      content: groups.content.length,
      menus: groups.menus.length,
      postmeta: groups.postmeta.length,
      options: groups.options.length,
      customTables: groups.customTables.length,
      topTemplatePath: typeof groups.templates[0]?.path === "string" ? groups.templates[0].path as string : null
    });

    return {
      query: rawQuery,
      detectedKind,
      summary: {
        totalMatches,
        groupsWithMatches
      },
      groups,
      recommendation
    };
  } finally {
    db.close();
  }
}

export function createProjectRouter(deps: ProjectRouterDeps): Router {
  const router = Router();
  const services = deps.services;

  // MCP tool transport surface. Prefer this path for assistant/user-facing calls.
  router.get("/tools", (_req, res) => {
    if (!deps.toolDispatcher) {
      sendError(res, new AppError("INTERNAL_ERROR", "Tool dispatcher not configured.", 500));
      return;
    }

    try {
      res.json({
        ok: true,
        data: {
          tools: deps.toolDispatcher.listTools()
        }
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/tools/call", async (req, res) => {
    if (!deps.toolDispatcher) {
      sendError(res, new AppError("INTERNAL_ERROR", "Tool dispatcher not configured.", 500));
      return;
    }

    const body = (req.body ?? {}) as ToolCallRequest;
    const toolName = typeof body.tool === "string" ? body.tool.trim() : "";
    if (!toolName) {
      sendError(
        res,
        new AppError("TOOL_INPUT_INVALID", "Request body must include a non-empty `tool` string.", 400)
      );
      return;
    }

    try {
      const result = await deps.toolDispatcher.dispatch({
        tool: toolName,
        input: body.input
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Legacy endpoint handlers are retained for internal/transitional usage.
  // Public usage should happen through MCP tools rather than direct endpoint calls.
  router.post("/project/connect", (req, res) => {
    const body = (req.body ?? {}) as ConnectWordpressInput;

    try {
      const result = services.wordpress.connectWordpress(body);
      res.json({
        ok: true,
        data: formatWordpressConnectResponse(result)
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/project/index/status", (req, res) => {
    const wpRootInput = typeof req.query.wpRoot === "string" ? req.query.wpRoot : undefined;

    try {
      const status = services.index.getIndexStatus({ wpRoot: wpRootInput });
      res.json({
        ok: true,
        data: status
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/project/index/build", (req, res) => {
    const body = (req.body ?? {}) as BuildIndexRequest;

    try {
      const result = services.index.buildIndex({
        wpRoot: body.wpRoot,
        limit: body.limit,
        mode: body.mode
      });
      res.json({
        ok: true,
        data: result
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/audit/component", (req, res) => {
    const body = (req.body ?? {}) as AuditComponentRequest;
    try {
      const data = services.audit.auditComponent(body);
      res.json({
        ok: true,
        data
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/wp/theme/profile", (req, res) => {
    try {
      const wpRoot = typeof req.query.wpRoot === "string" ? req.query.wpRoot : undefined;
      const themeSlug = typeof req.query.themeSlug === "string" ? req.query.themeSlug : undefined;
      const themePath = typeof req.query.themePath === "string" ? req.query.themePath : undefined;
      const siteUrl = typeof req.query.siteUrl === "string" ? req.query.siteUrl : undefined;
      const blogIdRaw = typeof req.query.blogId === "string" ? req.query.blogId : undefined;
      const blogId = blogIdRaw && /^\d+$/u.test(blogIdRaw) ? Number.parseInt(blogIdRaw, 10) : undefined;

      const data = deps.services.theme.getThemeProfile({
        wpRoot,
        themeSlug,
        themePath,
        siteUrl,
        blogId
      });

      res.json({
        ok: true,
        data
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/search/similar", (req, res) => {
    const body = (req.body ?? {}) as SearchSimilarRequest;
    try {
      const data = services.similarity.findSimilar(body);
      res.json({
        ok: true,
        data
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/fs/read", (req, res) => {
    const wpRootInput = typeof req.query.wpRoot === "string" ? req.query.wpRoot : deps.configuredWpRoot;
    const pathInput = typeof req.query.path === "string" ? req.query.path : "";
    const maxBytesInput = typeof req.query.maxBytes === "string" ? Number.parseInt(req.query.maxBytes, 10) : undefined;

    try {
      const wpRoot = resolveWpRoot(wpRootInput, deps.configuredWpRoot);
      if (!wpRootLooksValid(wpRoot)) {
        throw new AppError(
          "WP_ROOT_INVALID",
          "Invalid WP root. Expected `wp-includes` in wpRoot or `wp-config.php` in wpRoot (or its parent).",
          400,
          { wpRoot }
        );
      }
      const filePath = pathInput.trim();
      if (!filePath) {
        throw new AppError("INVALID_FS_READ_INPUT", "Invalid `path`. Provide a non-empty string.", 400);
      }
      const filePathCandidate = path.isAbsolute(filePath) ? filePath : path.join(wpRoot, filePath);
      const resolvedFile = assertWithinRoot(wpRoot, filePathCandidate, "path");
      const stat = fs.statSync(resolvedFile, { throwIfNoEntry: false });
      if (!stat || !stat.isFile()) {
        throw new AppError("FS_READ_NOT_FOUND", "Requested file was not found.", 404, {
          path: filePath
        });
      }

      const maxBytes = Number.isFinite(maxBytesInput) && (maxBytesInput ?? 0) > 0
        ? Math.floor(maxBytesInput as number)
        : 1024 * 1024;
      const raw = fs.readFileSync(resolvedFile);
      const truncated = raw.length > maxBytes;
      const content = raw.subarray(0, maxBytes).toString("utf8");

      res.json({
        ok: true,
        data: {
          path: resolvedFile,
          content,
          truncated
        }
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/fs/search", (req, res) => {
    const body = (req.body ?? {}) as FsSearchRequest;
    const wpRootInput = body.wpRoot ?? deps.configuredWpRoot;

    try {
      const wpRoot = resolveWpRoot(wpRootInput, deps.configuredWpRoot);
      if (!wpRootLooksValid(wpRoot)) {
        throw new AppError(
          "WP_ROOT_INVALID",
          "Invalid WP root. Expected `wp-includes` in wpRoot or `wp-config.php` in wpRoot (or its parent).",
          400,
          { wpRoot }
        );
      }

      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) {
        throw new AppError("INVALID_SEARCH_INPUT", "Invalid `query`. Provide a non-empty string.", 400);
      }
      const isRegex = body.isRegex === true;
      const searchPattern = resolveFsSearchPattern({ query, isRegex });
      const rawLimit = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.floor(body.limit) : 50;
      const limit = Math.min(200, Math.max(1, rawLimit));
      const searchRoot = body.path
        ? assertWithinRoot(wpRoot, path.isAbsolute(body.path) ? body.path : path.join(wpRoot, body.path), "path")
        : wpRoot;
      const stat = fs.statSync(searchRoot, { throwIfNoEntry: false });
      if (!stat) {
        throw new AppError("FS_SEARCH_PATH_NOT_FOUND", "Search path was not found.", 404, {
          path: body.path ?? "."
        });
      }

      const globRegex = typeof body.glob === "string" && body.glob.trim()
        ? globPatternToRegex(body.glob.trim())
        : null;
      const fileCandidates = stat.isFile() ? [searchRoot] : listFilesRecursively(searchRoot, { maxFiles: 5000 });
      const matches: Array<{ path: string; line: number; column: number; preview: string }> = [];

      for (const candidate of fileCandidates) {
        const relativePath = toRelativeWpPath(wpRoot, candidate);
        if (globRegex && !globRegex.test(path.basename(candidate)) && !globRegex.test(relativePath)) {
          continue;
        }
        const content = safeReadText(candidate);
        if (!content) {
          continue;
        }

        searchPattern.lastIndex = 0;
        let match = searchPattern.exec(content);
        while (match) {
          const start = match.index;
          const position = computeLineColumn(content, start);
          matches.push({
            path: relativePath,
            line: position.line,
            column: position.column,
            preview: previewForOffset(content, start)
          });
          if (matches.length >= limit) {
            break;
          }
          if (match[0].length === 0) {
            searchPattern.lastIndex += 1;
          }
          match = searchPattern.exec(content);
        }

        if (matches.length >= limit) {
          break;
        }
      }

      res.json({
        ok: true,
        data: {
          queryEcho: {
            query,
            isRegex
          },
          matches
        }
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/fs/applyPatch", (req, res) => {
    const body = (req.body ?? {}) as ApplyPatchRequest;
    const wpRootInput = body.wpRoot ?? deps.configuredWpRoot;
    const patchInput = typeof body.patch === "string" ? body.patch : "";

    try {
      const wpRoot = resolveWpRoot(wpRootInput, deps.configuredWpRoot);
      if (!wpRootLooksValid(wpRoot)) {
        throw new AppError(
          "WP_ROOT_INVALID",
          "Invalid WP root. Expected `wp-includes` in wpRoot or `wp-config.php` in wpRoot (or its parent).",
          400,
          { wpRoot }
        );
      }
      if (!patchInput.trim()) {
        throw new AppError("INVALID_PATCH_FORMAT", "Invalid `patch`. Provide a non-empty unified diff.", 400);
      }

      const parsedPatch = parseUnifiedDiff(patchInput);
      const plan = planPatchApply(wpRoot, parsedPatch);
      const result = applyPatchAtomically(wpRoot, plan, deps.phpBin);

      res.json({
        ok: true,
        data: result
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
