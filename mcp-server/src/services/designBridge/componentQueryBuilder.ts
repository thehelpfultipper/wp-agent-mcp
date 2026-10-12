import type { VisualIntent } from "./visualIntentSchema";
import { extractBlockIdentifiers } from "./blockIdentifierExtractor";

export function buildComponentAuditQuery(intent: VisualIntent, componentHint?: string): string {
  const parts: string[] = [];

  if (componentHint?.trim()) {
    parts.push(componentHint.trim());
  }

  for (const component of intent.components ?? []) {
    if (component.label.trim()) {
      parts.push(component.label.trim());
    }
    if (component.kind && component.kind !== "generic") {
      parts.push(component.kind);
    }
    for (const child of component.contains ?? []) {
      if (child.trim()) {
        parts.push(child.trim());
      }
    }
  }

  if (parts.length === 0 && intent.layout.structure.trim()) {
    parts.push(intent.layout.structure.trim());
  }

  for (const region of intent.layout.regions) {
    if (region.role.trim()) {
      parts.push(region.role.trim());
    }
    if (region.notes?.trim()) {
      parts.push(region.notes.trim());
    }
  }

  for (const annotation of intent.annotations ?? []) {
    if (annotation.trim()) {
      parts.push(annotation.trim());
    }
  }

  return Array.from(new Set(parts)).join(" ").trim();
}

export function buildComponentQuerySpec(intent: VisualIntent, componentHint?: string): {
  name: string;
  variantHints: string[];
  typeHints: Array<"block" | "pattern" | "template" | "content">;
  blockNames: string[];
  classNames: string[];
  componentLabels: string[];
  snippet: string;
} {
  const auditTexts = [
    componentHint ?? "",
    intent.layout.structure,
    ...(intent.components ?? []).map((component) => component.label),
    ...(intent.annotations ?? []),
    ...intent.layout.regions.map((region) => region.notes ?? region.role)
  ];
  const identifiers = extractBlockIdentifiers(...auditTexts.filter((text) => text.trim().length > 0));

  const name = buildComponentAuditQuery(intent, componentHint) || intent.layout.structure.trim();
  const variantHints = (intent.annotations ?? []).slice(0, 5);
  const blockNames = [...identifiers.blockNames];
  const classNames = [...identifiers.classNames];
  const componentLabels = [...identifiers.componentLabels];

  for (const component of intent.components ?? []) {
    if (component.label.trim()) {
      componentLabels.push(component.label.trim());
    }
    if (component.kind === "hero" || component.kind === "card" || component.kind === "footer") {
      blockNames.push(component.kind);
    }
  }

  const layoutLower = intent.layout.structure.toLowerCase();
  if (layoutLower.includes("hero") && !blockNames.includes("hero")) {
    blockNames.push("hero");
  }
  if (layoutLower.includes("card") && !blockNames.includes("card")) {
    blockNames.push("card");
  }
  if (layoutLower.includes("footer") && !blockNames.includes("footer")) {
    blockNames.push("footer");
  }
  if (layoutLower.includes("nav") && !blockNames.includes("navigation")) {
    blockNames.push("navigation");
  }

  return {
    name,
    variantHints,
    typeHints: ["pattern", "block", "template", "content"],
    blockNames: Array.from(new Set(blockNames)).sort(),
    classNames: Array.from(new Set(classNames)).sort(),
    componentLabels: Array.from(new Set(componentLabels)).sort(),
    snippet: intent.layout.structure
  };
}
