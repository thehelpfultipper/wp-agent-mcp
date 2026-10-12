import { AppError } from "../errors";
import { type ToolRegistry, type ToolInvokeInput, type ToolInvokeResult } from "./registry";

type JsonSchema = Record<string, unknown>;

export type DispatchToolCall = {
  tool: string;
  input?: unknown;
};

export type DispatchToolResult = {
  ok: true;
  data: ToolInvokeResult;
};

export class ToolDispatcher {
  constructor(private readonly registry: ToolRegistry) {}

  listTools() {
    return Array.from(this.registry.values()).map((entry) => entry.definition);
  }

  async dispatch(call: DispatchToolCall): Promise<DispatchToolResult> {
    const toolName = call.tool;
    const registration = this.registry.get(toolName);
    if (!registration) {
      throw new AppError("TOOL_NOT_FOUND", `Unknown tool "${toolName}".`, 404, {
        tool: toolName,
        availableTools: Array.from(this.registry.keys()).sort()
      });
    }

    const input = this.normalizeInput(toolName, call.input);
    if (toolName === "bridge_design_to_implementation" && input.visualIntent === undefined && input.figmaCapture === undefined) {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        "Provide `visualIntent` or `figmaCapture`.",
        400,
        {
          tool: toolName,
          hint: "Structure semantic roles in visualIntent, or pass get_design_context output as figmaCapture."
        }
      );
    }
    if (toolName === "sync_local_db_from_dump" && includesFileSyncRequest(input)) {
      throw new AppError(
        "TOOL_INPUT_INVALID",
        "sync_local_db_from_dump is database-only. It imports and rewrites the local DB only, and does not sync uploads/media/files. Run DB sync first, then use a separate file-sync capability when available.",
        400,
        {
          tool: toolName,
          hint: "Remove file/media/uploads sync fields from this call."
        }
      );
    }

    const inputErrors = validateInputAgainstSchema(registration.definition.inputSchema, input, "$");
    if (inputErrors.length > 0) {
      throw new AppError("TOOL_INPUT_INVALID", buildValidationMessage(toolName), 400, {
        tool: toolName,
        errors: inputErrors,
        hint: toolInputHint(toolName)
      });
    }

    const result = await registration.handler(input);
    return {
      ok: true,
      data: result
    };
  }

  private normalizeInput(toolName: string, input: unknown): ToolInvokeInput {
    if (input === undefined) {
      return {};
    }
    if (typeof input === "string") {
      const normalized = input.trim();
      if (!normalized) {
        throw new AppError("TOOL_INPUT_INVALID", "Tool input string must not be empty.", 400, {
          tool: toolName
        });
      }
      if (toolName === "audit_component" || toolName === "find_similar_content" || toolName === "where_is_used") {
        return {
          query: normalized
        };
      }
      throw new AppError("TOOL_INPUT_INVALID", "Tool input must be a JSON object.", 400, {
        tool: toolName,
        receivedType: "string"
      });
    }
    if (!isPlainObject(input)) {
      throw new AppError("TOOL_INPUT_INVALID", "Tool input must be a JSON object.", 400, {
        receivedType: typeof input
      });
    }

    if (toolName === "audit_component" && typeof input.component_query === "string" && input.query === undefined) {
      const { component_query: legacyQuery, ...rest } = input;
      return {
        ...rest,
        query: legacyQuery
      };
    }
    if (toolName === "find_similar_content" && typeof input.componentName === "string" && input.query === undefined) {
      const { componentName: legacyName, ...rest } = input;
      return {
        ...rest,
        query: legacyName
      };
    }
    return input;
  }
}

function buildValidationMessage(toolName: string): string {
  if (toolName === "audit_component") {
    return "Invalid audit input. Provide a natural-language query string or `{ query: \"...\" }`.";
  }
  if (toolName === "find_similar_content") {
    return "Invalid similarity input. Provide a natural-language query or class name.";
  }
  if (toolName === "sync_local_db_from_dump") {
    return "Invalid DB sync input. Provide `{ dumpPath }` and optional DB rewrite settings only; uploads/media/file sync is not handled by this tool.";
  }
  if (toolName === "where_is_used") {
    return "Invalid usage lookup input. Provide a query string (for example: `.footer-disclosure`).";
  }
  return "Tool input failed validation.";
}

function toolInputHint(toolName: string): string | undefined {
  if (toolName === "audit_component") {
    return "Examples: \"compact testimonial section\" or {\"query\":\"compact testimonial section\"}.";
  }
  if (toolName === "find_similar_content") {
    return "Examples: \"hero with two CTA buttons\" or {\"className\":\"is-style-compact\"}.";
  }
  if (toolName === "sync_local_db_from_dump") {
    return "Examples: \"update local db\", \"sync my local db from this dump\", or {\"dumpPath\":\"/path/to/live.sql.gz\"}.";
  }
  if (toolName === "where_is_used") {
    return "Examples: \".footer-disclosure\" or {\"query\":\"[gravityform]\",\"kind\":\"shortcode\"}.";
  }
  return undefined;
}

const FILE_SYNC_KEY_PATTERN = /(upload|uploads|media|file|files|asset|assets|rsync|scp|sftp|wpcontent|wp-content)/iu;

function includesFileSyncRequest(input: ToolInvokeInput): boolean {
  return Object.keys(input).some((key) => {
    if (key === "dumpPath") {
      return false;
    }
    return FILE_SYNC_KEY_PATTERN.test(key);
  });
}

function validateInputAgainstSchema(schema: JsonSchema, value: unknown, path: string): string[] {
  const errors: string[] = [];
  validateValue(schema, value, path, errors);
  return errors;
}

function validateValue(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  const constValue = schema.const;
  if (constValue !== undefined && value !== constValue) {
    errors.push(`${path} must be ${JSON.stringify(constValue)}.`);
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((enumValue) => enumValue === value)) {
    errors.push(`${path} must be one of: ${enumValues.map((entry) => JSON.stringify(entry)).join(", ")}.`);
  }

  const typeSpec = schema.type;
  if (typeSpec !== undefined) {
    const allowedTypes = Array.isArray(typeSpec) ? typeSpec : [typeSpec];
    const typeMatches = allowedTypes.some((typeName) => matchesType(typeName, value));
    if (!typeMatches) {
      errors.push(`${path} must match type: ${allowedTypes.join(" | ")}.`);
      return;
    }
  }

  if (typeof value === "string") {
    const minLength = schema.minLength;
    if (typeof minLength === "number" && value.length < minLength) {
      errors.push(`${path} must have length >= ${minLength}.`);
    }
  }

  if (typeof value === "number") {
    const minimum = schema.minimum;
    if (typeof minimum === "number" && value < minimum) {
      errors.push(`${path} must be >= ${minimum}.`);
    }
    const maximum = schema.maximum;
    if (typeof maximum === "number" && value > maximum) {
      errors.push(`${path} must be <= ${maximum}.`);
    }
  }

  if (isPlainObject(value)) {
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const requiredKey of required) {
        if (typeof requiredKey !== "string") {
          continue;
        }
        if (!(requiredKey in value)) {
          errors.push(`${path}.${requiredKey} is required.`);
        }
      }
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const knownKeys = new Set(Object.keys(properties));
    const additionalProperties = schema.additionalProperties;
    if (additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!knownKeys.has(key)) {
          errors.push(`${path}.${key} is not allowed.`);
        }
      }
    }

    for (const [key, childValue] of Object.entries(value)) {
      const childSchema = properties[key];
      if (isPlainObject(childSchema)) {
        validateValue(childSchema, childValue, `${path}.${key}`, errors);
      }
    }

    const anyOf = schema.anyOf;
    if (Array.isArray(anyOf) && anyOf.length > 0) {
      const anyOfMatches = anyOf.some((variantSchema) => {
        if (!isPlainObject(variantSchema)) {
          return false;
        }
        const variantErrors: string[] = [];
        validateValue(variantSchema, value, path, variantErrors);
        return variantErrors.length === 0;
      });
      if (!anyOfMatches) {
        errors.push(`${path} must satisfy at least one anyOf branch.`);
      }
    }
  }

  if (Array.isArray(value)) {
    const itemSchema = schema.items;
    if (isPlainObject(itemSchema)) {
      value.forEach((item, index) => {
        validateValue(itemSchema, item, `${path}[${index}]`, errors);
      });
    }
  }
}

function matchesType(typeName: unknown, value: unknown): boolean {
  if (typeName === "null") {
    return value === null;
  }
  if (typeName === "array") {
    return Array.isArray(value);
  }
  if (typeName === "object") {
    return isPlainObject(value);
  }
  if (typeName === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  return typeof value === typeName;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

