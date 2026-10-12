import BetterSqlite3 from "better-sqlite3";
import { getIndexPaths } from "../../indexStore";

type BlockRow = {
  id: string;
  name: string;
  path: string;
};

const LAYOUT_KIND_TERMS: Record<string, string[]> = {
  hero: ["hero", "banner", "masthead"],
  card: ["card", "tile", "panel"],
  footer: ["footer", "disclosure", "legal"],
  navigation: ["nav", "navigation", "menu", "header"],
  form: ["form", "signup", "subscribe"]
};

function tokenizeQuery(text: string): string[] {
  return Array.from(new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9-/]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  ));
}

function scoreBlockRow(row: BlockRow, terms: string[]): { score: number; reasons: string[] } {
  const haystack = `${row.id} ${row.name} ${row.path}`.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  for (const term of terms) {
    if (haystack === term) {
      score += 1;
      reasons.push(`Exact match on ${row.id}`);
      continue;
    }
    if (row.id.toLowerCase() === term) {
      score += 0.95;
      reasons.push(`Block id exact match: ${row.id}`);
      continue;
    }
    if (haystack.includes(term)) {
      score += term.includes("/") ? 0.85 : 0.35;
      reasons.push(`Term "${term}" found in block metadata`);
    }
  }

  return { score, reasons };
}

function expandLayoutTerms(terms: string[]): string[] {
  const expanded = new Set(terms);
  const joined = terms.join(" ");
  for (const [kind, kindTerms] of Object.entries(LAYOUT_KIND_TERMS)) {
    if (kindTerms.some((term) => joined.includes(term))) {
      for (const kindTerm of kindTerms) {
        expanded.add(kindTerm);
      }
      expanded.add(kind);
    }
  }
  return Array.from(expanded);
}

export function discoverBlockSlugsFromIndex(
  wpRoot: string,
  queryText: string,
  limit = 5
): Array<{ slug: string; score: number; reasons: string[] }> {
  const terms = expandLayoutTerms(tokenizeQuery(queryText));
  if (terms.length === 0) {
    return [];
  }

  const dbPath = getIndexPaths(wpRoot).dbPath;
  const db = new BetterSqlite3(dbPath);
  try {
    const rows = db
      .prepare("SELECT id, name, path FROM blocks ORDER BY path ASC LIMIT 2000")
      .all() as BlockRow[];

    const scored = rows
      .map((row) => {
        const result = scoreBlockRow(row, terms);
        return {
          slug: row.id,
          score: result.score,
          reasons: result.reasons
        };
      })
      .filter((entry) => entry.score >= 0.35)
      .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));

    return scored.slice(0, limit);
  } finally {
    db.close();
  }
}

export function mergeDiscoveredBlockSlugs<T extends {
  blockNames: string[];
  classNames: string[];
  componentLabels: string[];
}>(querySpec: T, discovered: Array<{ slug: string }>): T {
  const blockNames = new Set(querySpec.blockNames);
  const classNames = new Set(querySpec.classNames);
  const componentLabels = new Set(querySpec.componentLabels);

  for (const entry of discovered) {
    componentLabels.add(entry.slug);
    if (entry.slug.includes("/")) {
      blockNames.add(entry.slug);
    } else {
      classNames.add(entry.slug);
    }
  }

  return {
    ...querySpec,
    blockNames: Array.from(blockNames).sort(),
    classNames: Array.from(classNames).sort(),
    componentLabels: Array.from(componentLabels).sort()
  };
}
