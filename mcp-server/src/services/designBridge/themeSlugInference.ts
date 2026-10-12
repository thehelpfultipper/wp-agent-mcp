import type { VisualIntent } from "./visualIntentSchema";

export type ThemeTextMatch = {
  slug: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

const CORPUS_STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "for", "to", "with", "and", "or", "our", "this", "that",
  "implement", "build", "match", "design", "section", "component", "block", "pattern",
  "theme", "wordpress", "wp", "using", "from", "into", "make", "add", "update"
]);

const STOCK_PARENT_THEME_PATTERNS = [
  /^twentytwenty/u,
  /^twentytwentyone$/u,
  /^twentytwentytwo$/u,
  /^twentytwentythree$/u,
  /^twentytwentyfour$/u,
  /^twentytwentyfive$/u,
  /^twentytwentysix$/u,
  /^default$/u,
  /^genesis$/u
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !CORPUS_STOP_WORDS.has(token));
}

export function collectRequestCorpus(intent: VisualIntent, componentHint?: string): string {
  const parts = [
    componentHint ?? "",
    intent.layout.structure,
    ...(intent.components ?? []).map((component) => component.label),
    ...(intent.annotations ?? []),
    ...intent.layout.regions.map((region) => `${region.role} ${region.notes ?? ""}`.trim())
  ];
  return parts.filter((part) => part.trim().length > 0).join(" ").trim();
}

function scoreSlugAgainstCorpus(slug: string, corpus: string, tokens: string[]): {
  score: number;
  reasons: string[];
} {
  const loweredSlug = slug.toLowerCase();
  const loweredCorpus = corpus.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  if (loweredCorpus.includes(loweredSlug)) {
    score += 1;
    reasons.push(`Corpus contains theme slug "${slug}"`);
  }

  for (const token of tokens) {
    if (token === loweredSlug) {
      score += 0.9;
      reasons.push(`Exact token match for "${slug}"`);
      continue;
    }
    if (loweredSlug.startsWith(token) && token.length >= 3) {
      score += 1;
      reasons.push(`Theme slug starts with token "${token}"`);
      continue;
    }
    if (loweredSlug.includes(token) && token.length >= 3) {
      score += 0.55;
      reasons.push(`Theme slug contains token "${token}"`);
      continue;
    }
    if (token.includes(loweredSlug) && loweredSlug.length >= 3) {
      score += 0.65;
      reasons.push(`Token "${token}" references theme slug "${slug}"`);
    }
  }

  return { score, reasons };
}

export function inferThemeSlugFromText(
  corpus: string,
  installedSlugs: string[]
): ThemeTextMatch | null {
  const trimmed = corpus.trim();
  if (!trimmed || installedSlugs.length === 0) {
    return null;
  }

  const tokens = tokenize(trimmed);
  const scored = installedSlugs
    .map((slug) => {
      const result = scoreSlugAgainstCorpus(slug, trimmed, tokens);
      return { slug, ...result };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));

  const top = scored[0];
  const second = scored[1];
  if (!top) {
    return null;
  }

  const confidence: ThemeTextMatch["confidence"] = top.score >= 1
    ? "high"
    : top.score >= 0.55
      ? "medium"
      : "low";

  if (confidence === "low") {
    return null;
  }

  if (second && top.score - second.score < 0.15) {
    return null;
  }

  return {
    slug: top.slug,
    confidence,
    reasons: top.reasons
  };
}

export function isStockParentTheme(slug: string): boolean {
  return STOCK_PARENT_THEME_PATTERNS.some((pattern) => pattern.test(slug));
}

export function filterCustomThemes(slugs: string[]): string[] {
  return slugs.filter((slug) => !isStockParentTheme(slug));
}
