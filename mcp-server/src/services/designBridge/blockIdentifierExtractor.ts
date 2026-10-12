const BLOCK_NAMESPACE_PATTERN = /\b[a-z][a-z0-9-]*\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\b/giu;
const COMPONENT_SLUG_PATTERN = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}\b/giu;

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))).sort();
}

function extractFromText(text: string): { blockNames: string[]; classNames: string[] } {
  const blockNames: string[] = [];
  const classNames: string[] = [];

  for (const match of text.matchAll(BLOCK_NAMESPACE_PATTERN)) {
    if (match[0]) {
      blockNames.push(match[0].toLowerCase());
    }
  }

  for (const match of text.matchAll(COMPONENT_SLUG_PATTERN)) {
    const slug = match[0]?.toLowerCase();
    if (!slug) {
      continue;
    }
    if (blockNames.some((blockName) => blockName.endsWith(`/${slug}`))) {
      continue;
    }
    classNames.push(slug);
  }

  return {
    blockNames: uniqueSorted(blockNames),
    classNames: uniqueSorted(classNames)
  };
}

export function extractBlockIdentifiers(...texts: string[]): {
  blockNames: string[];
  classNames: string[];
  componentLabels: string[];
} {
  const blockNames = new Set<string>();
  const classNames = new Set<string>();
  const componentLabels = new Set<string>();

  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    componentLabels.add(trimmed);
    const extracted = extractFromText(trimmed);
    for (const blockName of extracted.blockNames) {
      blockNames.add(blockName);
      componentLabels.add(blockName);
    }
    for (const className of extracted.classNames) {
      classNames.add(className);
      componentLabels.add(className);
    }
  }

  return {
    blockNames: uniqueSorted(Array.from(blockNames)),
    classNames: uniqueSorted(Array.from(classNames)),
    componentLabels: uniqueSorted(Array.from(componentLabels))
  };
}
