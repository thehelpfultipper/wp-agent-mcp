export type Rgb = { r: number; g: number; b: number };

export function parseHexColor(input: string): Rgb | null {
  const normalized = input.trim().replace(/^#/u, "");
  if (/^[0-9a-f]{3}$/iu.test(normalized)) {
    return {
      r: Number.parseInt(normalized[0] + normalized[0], 16),
      g: Number.parseInt(normalized[1] + normalized[1], 16),
      b: Number.parseInt(normalized[2] + normalized[2], 16)
    };
  }
  if (/^[0-9a-f]{6}$/iu.test(normalized)) {
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16)
    };
  }
  return null;
}

export function parseCssColor(input: string): Rgb | null {
  const hex = parseHexColor(input);
  if (hex) {
    return hex;
  }
  const rgbMatch = input.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/iu);
  if (rgbMatch) {
    return {
      r: Number.parseInt(rgbMatch[1] ?? "0", 10),
      g: Number.parseInt(rgbMatch[2] ?? "0", 10),
      b: Number.parseInt(rgbMatch[3] ?? "0", 10)
    };
  }
  return null;
}

export function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function nearestColorToken<T extends { value: string }>(
  rawColor: string | undefined,
  tokens: T[]
): { token: T | null; distance: number } {
  if (!rawColor || tokens.length === 0) {
    return { token: null, distance: Number.POSITIVE_INFINITY };
  }
  const target = parseCssColor(rawColor);
  if (!target) {
    return { token: null, distance: Number.POSITIVE_INFINITY };
  }

  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const candidate = parseCssColor(token.value);
    if (!candidate) {
      continue;
    }
    const distance = colorDistance(target, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = token;
    }
  }
  return { token: best, distance: bestDistance };
}
