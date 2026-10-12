import { AppError } from "../../errors";
import { mapFigmaCaptureToVisualIntent } from "./figmaCaptureMapper";

export type VisualIntentSourceKind = "figma" | "screenshot" | "manual";

export type VisualIntentColorRole =
  | "background"
  | "surface"
  | "text"
  | "heading"
  | "accent"
  | "border"
  | "interactive";

export type VisualIntentTypographyRole =
  | "display"
  | "heading"
  | "subheading"
  | "body"
  | "caption"
  | "label";

export type VisualIntent = {
  source?: {
    kind?: VisualIntentSourceKind;
    url?: string;
    nodeId?: string;
  };
  layout: {
    structure: string;
    regions: Array<{ id: string; role: string; notes?: string }>;
  };
  typography: Array<{
    role: VisualIntentTypographyRole;
    emphasis?: "primary" | "secondary" | "muted";
    raw?: {
      fontFamily?: string;
      fontSize?: string;
      fontWeight?: string;
      lineHeight?: string;
    };
  }>;
  colors: Array<{
    role: VisualIntentColorRole;
    emphasis?: "primary" | "secondary" | "muted";
    raw?: { hex?: string; rgba?: string };
  }>;
  spacing: {
    rhythm?: "tight" | "normal" | "loose";
    sectionPadding?: "sm" | "md" | "lg" | "xl";
    gaps?: "sm" | "md" | "lg";
    raw?: { padding?: string; gap?: string };
  };
  responsive?: {
    mobile?: string;
    tablet?: string;
    desktop?: string;
  };
  components?: Array<{
    label: string;
    kind?: "navigation" | "hero" | "card" | "form" | "footer" | "generic";
    contains?: string[];
  }>;
  assets?: Array<{ name: string; type: "image" | "icon" | "logo"; notes?: string }>;
  annotations?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSemanticLayout(intent: VisualIntent): boolean {
  return typeof intent.layout?.structure === "string" && intent.layout.structure.trim().length > 0;
}

function hasSemanticColors(intent: VisualIntent): boolean {
  return intent.colors.some((entry) => typeof entry.role === "string");
}

function hasSemanticTypography(intent: VisualIntent): boolean {
  return intent.typography.some((entry) => typeof entry.role === "string");
}

function hasSemanticSpacing(intent: VisualIntent): boolean {
  const spacing = intent.spacing ?? {};
  return Boolean(spacing.rhythm || spacing.sectionPadding || spacing.gaps);
}

function hasSemanticComponents(intent: VisualIntent): boolean {
  return (intent.components ?? []).some((entry) => typeof entry.label === "string" && entry.label.trim().length > 0);
}

function isRawOnlyPayload(raw: Record<string, unknown>): boolean {
  const layoutRaw = isRecord(raw.layout) ? raw.layout : {};
  const spacingRaw = isRecord(raw.spacing) ? raw.spacing : {};
  const hasStructure = typeof layoutRaw.structure === "string" && layoutRaw.structure.trim().length > 0;
  const hasRegions = Array.isArray(layoutRaw.regions) && layoutRaw.regions.length > 0;
  const hasComponents = Array.isArray(raw.components) && raw.components.length > 0;
  const hasAnnotations = Array.isArray(raw.annotations) && raw.annotations.length > 0;
  const hasResponsive = isRecord(raw.responsive) && Object.values(raw.responsive).some((v) => typeof v === "string" && v.trim());
  const hasSemanticSpacing = ["rhythm", "sectionPadding", "gaps"].some(
    (key) => typeof spacingRaw[key] === "string" && String(spacingRaw[key]).trim().length > 0
  );

  const typography = Array.isArray(raw.typography) ? raw.typography.filter(isRecord) : [];
  const hasSemanticTypography = typography.some((entry) => typeof entry.role === "string" || typeof entry.emphasis === "string");

  const colors = Array.isArray(raw.colors) ? raw.colors.filter(isRecord) : [];
  const hasSemanticColors = colors.some((entry) => typeof entry.role === "string" || typeof entry.emphasis === "string");

  const hasRawTypography = typography.some((entry) => isRecord(entry.raw) && Object.keys(entry.raw).length > 0);
  const hasRawColors = colors.some((entry) => isRecord(entry.raw) && Object.keys(entry.raw).length > 0);
  const hasRawSpacing = isRecord(spacingRaw.raw) && Object.keys(spacingRaw.raw).length > 0;
  const hasRaw = hasRawTypography || hasRawColors || hasRawSpacing;

  const hasSemantic = hasStructure || hasRegions || hasComponents || hasAnnotations || hasResponsive
    || hasSemanticSpacing || hasSemanticTypography || hasSemanticColors;

  return hasRaw && !hasSemantic;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

export function normalizeVisualIntent(raw: unknown): VisualIntent {
  if (!isRecord(raw)) {
    throw new AppError("TOOL_INPUT_INVALID", "Invalid `visualIntent`. Provide a structured object.", 400);
  }

  if (isRawOnlyPayload(raw)) {
    throw new AppError(
      "BRIDGE_INTENT_TOO_RAW",
      "Visual intent is raw-only. Interpret design roles (hierarchy, color roles, typography roles) before calling the bridge.",
      400,
      {
        hint: "Map Figma values to semantic roles such as background/text/accent and heading/body before reconciliation."
      }
    );
  }

  const layoutRaw = isRecord(raw.layout) ? raw.layout : {};
  const spacingRaw = isRecord(raw.spacing) ? raw.spacing : {};
  const sourceRaw = isRecord(raw.source) ? raw.source : undefined;

  const intent: VisualIntent = {
    source: sourceRaw
      ? {
        kind: typeof sourceRaw.kind === "string"
          ? sourceRaw.kind as VisualIntentSourceKind
          : undefined,
        url: typeof sourceRaw.url === "string" ? sourceRaw.url : undefined,
        nodeId: typeof sourceRaw.nodeId === "string" ? sourceRaw.nodeId : undefined
      }
      : undefined,
    layout: {
      structure: typeof layoutRaw.structure === "string" ? layoutRaw.structure.trim() : "",
      regions: Array.isArray(layoutRaw.regions)
        ? layoutRaw.regions
          .filter(isRecord)
          .map((region) => ({
            id: typeof region.id === "string" ? region.id : "region",
            role: typeof region.role === "string" ? region.role : "content",
            notes: typeof region.notes === "string" ? region.notes : undefined
          }))
        : []
    },
    typography: Array.isArray(raw.typography)
      ? raw.typography.filter(isRecord).map((entry) => ({
        role: (typeof entry.role === "string" ? entry.role : "body") as VisualIntentTypographyRole,
        emphasis: typeof entry.emphasis === "string"
          ? entry.emphasis as "primary" | "secondary" | "muted"
          : undefined,
        raw: isRecord(entry.raw)
          ? {
            fontFamily: typeof entry.raw.fontFamily === "string" ? entry.raw.fontFamily : undefined,
            fontSize: typeof entry.raw.fontSize === "string" ? entry.raw.fontSize : undefined,
            fontWeight: typeof entry.raw.fontWeight === "string" ? entry.raw.fontWeight : undefined,
            lineHeight: typeof entry.raw.lineHeight === "string" ? entry.raw.lineHeight : undefined
          }
          : undefined
      }))
      : [],
    colors: Array.isArray(raw.colors)
      ? raw.colors.filter(isRecord).map((entry) => ({
        role: (typeof entry.role === "string" ? entry.role : "text") as VisualIntentColorRole,
        emphasis: typeof entry.emphasis === "string"
          ? entry.emphasis as "primary" | "secondary" | "muted"
          : undefined,
        raw: isRecord(entry.raw)
          ? {
            hex: typeof entry.raw.hex === "string" ? entry.raw.hex : undefined,
            rgba: typeof entry.raw.rgba === "string" ? entry.raw.rgba : undefined
          }
          : undefined
      }))
      : [],
    spacing: {
      rhythm: typeof spacingRaw.rhythm === "string"
        ? spacingRaw.rhythm as "tight" | "normal" | "loose"
        : undefined,
      sectionPadding: typeof spacingRaw.sectionPadding === "string"
        ? spacingRaw.sectionPadding as "sm" | "md" | "lg" | "xl"
        : undefined,
      gaps: typeof spacingRaw.gaps === "string"
        ? spacingRaw.gaps as "sm" | "md" | "lg"
        : undefined,
      raw: isRecord(spacingRaw.raw)
        ? {
          padding: typeof spacingRaw.raw.padding === "string" ? spacingRaw.raw.padding : undefined,
          gap: typeof spacingRaw.raw.gap === "string" ? spacingRaw.raw.gap : undefined
        }
        : undefined
    },
    responsive: isRecord(raw.responsive)
      ? {
        mobile: typeof raw.responsive.mobile === "string" ? raw.responsive.mobile : undefined,
        tablet: typeof raw.responsive.tablet === "string" ? raw.responsive.tablet : undefined,
        desktop: typeof raw.responsive.desktop === "string" ? raw.responsive.desktop : undefined
      }
      : undefined,
    components: Array.isArray(raw.components)
      ? raw.components.filter(isRecord).map((entry) => ({
        label: typeof entry.label === "string" ? entry.label.trim() : "component",
        kind: typeof entry.kind === "string"
          ? entry.kind as "navigation" | "hero" | "card" | "form" | "footer" | "generic"
          : undefined,
        contains: normalizeStringArray(entry.contains)
      }))
      : [],
    assets: Array.isArray(raw.assets)
      ? raw.assets.filter(isRecord).map((entry) => ({
        name: typeof entry.name === "string" ? entry.name : "asset",
        type: (typeof entry.type === "string" ? entry.type : "image") as "image" | "icon" | "logo",
        notes: typeof entry.notes === "string" ? entry.notes : undefined
      }))
      : [],
    annotations: normalizeStringArray(raw.annotations)
  };

  if (!hasSemanticLayout(intent) && !hasSemanticComponents(intent)) {
    throw new AppError(
      "TOOL_INPUT_INVALID",
      "Invalid `visualIntent.layout`. Provide `layout.structure` or component labels.",
      400
    );
  }

  return intent;
}

export function resolveBridgeVisualIntent(input: {
  visualIntent?: unknown;
  figmaCapture?: unknown;
}): VisualIntent {
  if (input.visualIntent !== undefined && input.visualIntent !== null) {
    return normalizeVisualIntent(input.visualIntent);
  }
  if (input.figmaCapture !== undefined && input.figmaCapture !== null) {
    try {
      return normalizeVisualIntent(mapFigmaCaptureToVisualIntent(input.figmaCapture));
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "TOOL_INPUT_INVALID",
        "Unable to map figmaCapture into visual intent.",
        400,
        {
          hint: "Ensure capture includes node names or labels, or provide a structured visualIntent instead.",
          cause: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }
  throw new AppError(
    "TOOL_INPUT_INVALID",
    "Provide `visualIntent` or `figmaCapture`.",
    400,
    {
      hint: "Structure semantic roles in visualIntent, or pass get_design_context output as figmaCapture."
    }
  );
}

export function summarizeVisualIntent(intent: VisualIntent): string {
  const parts = [intent.layout.structure.trim()];
  if (intent.components?.length) {
    parts.push(`components: ${intent.components.map((c) => c.label).join(", ")}`);
  }
  if (intent.source?.kind) {
    parts.push(`source: ${intent.source.kind}`);
  }
  return parts.filter(Boolean).join(" | ");
}

export function collectRawValuesToAvoid(intent: VisualIntent): string[] {
  const values = new Set<string>();
  for (const color of intent.colors) {
    if (color.raw?.hex) {
      values.add(color.raw.hex);
    }
    if (color.raw?.rgba) {
      values.add(color.raw.rgba);
    }
  }
  for (const type of intent.typography) {
    if (type.raw?.fontSize) {
      values.add(type.raw.fontSize);
    }
    if (type.raw?.fontFamily) {
      values.add(type.raw.fontFamily);
    }
  }
  if (intent.spacing.raw?.padding) {
    values.add(intent.spacing.raw.padding);
  }
  if (intent.spacing.raw?.gap) {
    values.add(intent.spacing.raw.gap);
  }
  return Array.from(values).sort();
}
