import { AppError } from "../../errors";
import type { ProjectServices } from "../../services";
import type { ToolHandler, ToolInvokeInput } from "../registry";

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

export function createBridgeDesignToImplementationToolAdapter(services: ProjectServices): ToolHandler {
  return (input: ToolInvokeInput) => {
    if (input.visualIntent === undefined && input.figmaCapture === undefined) {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        "Provide `visualIntent` or `figmaCapture`.",
        400
      );
    }
    return services.designBridge.bridgeDesignToImplementation({
      wpRoot: normalizeOptionalString(input.wpRoot),
      visualIntent: input.visualIntent,
      figmaCapture: input.figmaCapture,
      themeSlug: normalizeOptionalString(input.themeSlug),
      themePath: normalizeOptionalString(input.themePath),
      siteUrl: normalizeOptionalString(input.siteUrl),
      blogId: normalizeOptionalBlogId(input.blogId),
      componentHint: normalizeOptionalString(input.componentHint),
      targetSurface: normalizeOptionalString(input.targetSurface) as
        | "block"
        | "pattern"
        | "template-part"
        | "page-section"
        | undefined
    }) as unknown as Record<string, unknown>;
  };
}

export function createGetDesignBridgeReadinessToolAdapter(services: ProjectServices): ToolHandler {
  return (input: ToolInvokeInput) => {
    return services.designBridgeReadiness.getDesignBridgeReadiness({
      wpRoot: normalizeOptionalString(input.wpRoot),
      themeSlug: normalizeOptionalString(input.themeSlug)
    }) as unknown as Record<string, unknown>;
  };
}

export function createGetThemeProfileToolAdapterDirect(services: ProjectServices): ToolHandler {
  return (input: ToolInvokeInput) => {
    return services.theme.getThemeProfile({
      wpRoot: normalizeOptionalString(input.wpRoot),
      themeSlug: normalizeOptionalString(input.themeSlug),
      themePath: normalizeOptionalString(input.themePath),
      siteUrl: normalizeOptionalString(input.siteUrl),
      blogId: normalizeOptionalBlogId(input.blogId)
    }) as unknown as Record<string, unknown>;
  };
}
