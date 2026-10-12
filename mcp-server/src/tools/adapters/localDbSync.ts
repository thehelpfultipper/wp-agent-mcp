import { AppError } from "../../errors";
import type { ProjectServices } from "../../services";
import type { ToolHandler, ToolInvokeInput } from "../registry";

type MultisiteModeInput = boolean | "auto" | "single-site" | "multisite";

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMultisiteMode(value: unknown): MultisiteModeInput | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "auto" || value === "single-site" || value === "multisite") {
    return value;
  }
  return undefined;
}

function normalizeReplacementMappings(
  value: unknown
): Array<{ from: string; to: string; label?: string }> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new AppError("TOOL_INPUT_INVALID", "Invalid `replacementMappings`. Provide an array of mapping objects.", 400, {
      field: "replacementMappings"
    });
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        `Invalid \`replacementMappings[${String(index)}]\`. Each item must be an object with non-empty \`from\` and \`to\`.`,
        400,
        {
          field: `replacementMappings[${String(index)}]`
        }
      );
    }
    const mapping = entry as Record<string, unknown>;
    const from = normalizeOptionalString(mapping.from);
    const to = normalizeOptionalString(mapping.to);
    if (!from || !to) {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        `Invalid \`replacementMappings[${String(index)}]\`. Each item must include non-empty \`from\` and \`to\` values.`,
        400,
        {
          field: `replacementMappings[${String(index)}]`
        }
      );
    }

    if (from === to) {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        `Invalid \`replacementMappings[${String(index)}]\`. \`from\` and \`to\` must be different values.`,
        400,
        {
          field: `replacementMappings[${String(index)}]`
        }
      );
    }

    if (mapping.label !== undefined && typeof mapping.label !== "string") {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        `Invalid \`replacementMappings[${String(index)}.label]\`. Label must be a string when provided.`,
        400,
        {
          field: `replacementMappings[${String(index)}].label`
        }
      );
    }
    return {
      from,
      to,
      label: normalizeOptionalString(mapping.label)
    };
  });
}

export function createSyncLocalDbFromDumpToolAdapter(services: ProjectServices): ToolHandler {
  return async (input: ToolInvokeInput) => {
    const dumpPath = normalizeOptionalString(input.dumpPath);
    if (!dumpPath) {
      throw new AppError("TOOL_INPUT_INVALID", "Invalid `dumpPath`. Provide a non-empty string path.", 400, {
        field: "dumpPath"
      });
    }

    const rawMultisiteMode = input.multisiteMode;
    const multisiteMode = normalizeMultisiteMode(rawMultisiteMode);
    if (rawMultisiteMode !== undefined && multisiteMode === undefined) {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        "Invalid `multisiteMode`. Use `auto`, `single-site`, `multisite`, `true`, or `false`.",
        400,
        {
          field: "multisiteMode",
          received: rawMultisiteMode
        }
      );
    }

    return services.localDbSync.syncLocalDbFromDump({
      dumpPath,
      liveDomain: normalizeOptionalString(input.liveDomain),
      localUrl: normalizeOptionalString(input.localUrl),
      replacementMappings: normalizeReplacementMappings(input.replacementMappings),
      multisiteMode,
      wpRoot: normalizeOptionalString(input.wpRoot)
    });
  };
}

