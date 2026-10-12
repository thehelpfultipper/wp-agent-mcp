import { AppError } from "../../errors";
import type { VisualIntent } from "./visualIntentSchema";
import { extractBlockIdentifiers } from "./blockIdentifierExtractor";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectTextNodes(value: unknown, texts: string[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length < 500) {
      texts.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 40)) {
      collectTextNodes(entry, texts, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const key of ["name", "label", "title", "text", "componentName", "nodeName", "description"]) {
    const field = value[key];
    if (typeof field === "string" && field.trim().length > 0) {
      texts.push(field.trim());
    }
  }

  for (const key of ["nodes", "children", "components", "layers", "elements"]) {
    if (key in value) {
      collectTextNodes(value[key], texts, depth + 1);
    }
  }
}

function inferLayoutStructure(texts: string[]): string {
  const joined = texts.join(" ").trim();
  if (joined.length > 0) {
    return joined.slice(0, 240);
  }
  return "layout from figma capture";
}

function inferComponents(texts: string[]): Array<NonNullable<VisualIntent["components"]>[number]> {
  const identifiers = extractBlockIdentifiers(...texts);
  const components: NonNullable<VisualIntent["components"]> = [];

  for (const label of identifiers.componentLabels.slice(0, 8)) {
    const lower = label.toLowerCase();
    const kind = lower.includes("hero")
      ? "hero"
      : lower.includes("footer")
        ? "footer"
        : lower.includes("nav")
          ? "navigation"
          : lower.includes("card")
            ? "card"
            : lower.includes("form")
              ? "form"
              : "generic";
    components.push({ label, kind });
  }

  return components;
}

export function mapFigmaCaptureToVisualIntent(capture: unknown): VisualIntent {
  if (!isRecord(capture)) {
    throw new AppError(
      "TOOL_INPUT_INVALID",
      "figmaCapture must be an object (for example output from get_design_context).",
      400,
      {
        hint: "Pass the structured capture object from Figma MCP, or build visualIntent manually."
      }
    );
  }

  const texts: string[] = [];
  collectTextNodes(capture, texts);
  const uniqueTexts = Array.from(new Set(texts)).slice(0, 30);
  const structure = inferLayoutStructure(uniqueTexts);
  const components = inferComponents(uniqueTexts);
  const identifiers = extractBlockIdentifiers(...uniqueTexts);

  return {
    source: {
      kind: "figma",
      url: typeof capture.url === "string" ? capture.url : undefined,
      nodeId: typeof capture.nodeId === "string" ? capture.nodeId : undefined
    },
    layout: {
      structure,
      regions: identifiers.blockNames.map((blockName, index) => ({
        id: `region-${String(index + 1)}`,
        role: blockName.includes("hero") ? "hero" : "content",
        notes: blockName
      }))
    },
    typography: [{ role: "heading", emphasis: "primary" }, { role: "body", emphasis: "primary" }],
    colors: [
      { role: "background", emphasis: "primary" },
      { role: "text", emphasis: "primary" }
    ],
    spacing: {
      rhythm: "normal",
      sectionPadding: "lg"
    },
    components: components.length > 0 ? components : [{ label: structure.slice(0, 80), kind: "generic" }],
    annotations: uniqueTexts.slice(0, 5)
  };
}
