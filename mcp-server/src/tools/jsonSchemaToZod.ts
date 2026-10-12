import * as z from "zod/v4";

type JsonSchema = Record<string, unknown>;

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyDescription<T extends z.ZodType>(schema: T, jsonSchema: JsonSchema): T {
  const description = jsonSchema.description;
  if (typeof description === "string" && description.trim().length > 0) {
    return schema.describe(description) as T;
  }
  return schema;
}

function convertStringSchema(schema: JsonSchema): z.ZodType {
  let result: z.ZodType = z.string();
  const minLength = schema.minLength;
  if (typeof minLength === "number") {
    result = z.string().min(minLength);
  }
  return applyDescription(result, schema);
}

function convertIntegerSchema(schema: JsonSchema): z.ZodType {
  let result: z.ZodType = z.number().int();
  const minimum = schema.minimum;
  if (typeof minimum === "number") {
    result = z.number().int().min(minimum);
  }
  const maximum = schema.maximum;
  if (typeof maximum === "number") {
    result = z.number().int().max(maximum);
  }
  return applyDescription(result, schema);
}

function convertNumberSchema(schema: JsonSchema): z.ZodType {
  let result: z.ZodType = z.number();
  const minimum = schema.minimum;
  if (typeof minimum === "number") {
    result = z.number().min(minimum);
  }
  return applyDescription(result, schema);
}

function convertObjectSchema(schema: JsonSchema): z.ZodType {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, childSchema] of Object.entries(properties)) {
    if (!isRecord(childSchema)) {
      continue;
    }
    let fieldSchema = convertSchema(childSchema);
    if (!required.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }
    shape[key] = fieldSchema;
  }

  let result: z.ZodType = z.object(shape);
  if (schema.additionalProperties === false) {
    result = z.object(shape).strict();
  } else if (isRecord(schema.additionalProperties)) {
    result = z.object(shape).catchall(convertSchema(schema.additionalProperties));
  } else if (schema.additionalProperties !== false) {
    result = z.object(shape).catchall(z.unknown());
  }

  return applyDescription(result, schema);
}

function convertSchema(schema: JsonSchema): z.ZodTypeAny {
  const constValue = schema.const;
  if (constValue !== undefined) {
    return z.literal(constValue as never);
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && enumValues.length > 0 && enumValues.every((entry) => typeof entry === "string")) {
    return applyDescription(z.enum(enumValues as [string, ...string[]]), schema);
  }

  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const branches = anyOf.filter(isRecord).map(convertSchema);
    if (branches.length === 1) {
      return branches[0]!;
    }
    if (branches.length >= 2) {
      return applyDescription(z.union(branches as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]), schema);
    }
  }

  const typeSpec = schema.type;
  const types = Array.isArray(typeSpec)
    ? typeSpec.filter((entry): entry is string => typeof entry === "string")
    : typeof typeSpec === "string"
      ? [typeSpec]
      : ["object"];

  if (types.length > 1) {
    const branches = types.map((typeName) => {
      if (typeName === "string") {
        return convertStringSchema(schema);
      }
      if (typeName === "integer") {
        return convertIntegerSchema(schema);
      }
      if (typeName === "number") {
        return convertNumberSchema(schema);
      }
      if (typeName === "boolean") {
        return z.boolean();
      }
      if (typeName === "array") {
        const items = isRecord(schema.items) ? convertSchema(schema.items) : z.unknown();
        return z.array(items);
      }
      return convertObjectSchema(schema);
    });
    return applyDescription(z.union(branches as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]), schema);
  }

  const typeName = types[0] ?? "object";
  if (typeName === "string") {
    return convertStringSchema(schema);
  }
  if (typeName === "integer") {
    return convertIntegerSchema(schema);
  }
  if (typeName === "number") {
    return convertNumberSchema(schema);
  }
  if (typeName === "boolean") {
    return applyDescription(z.boolean(), schema);
  }
  if (typeName === "array") {
    const items = isRecord(schema.items) ? convertSchema(schema.items) : z.unknown();
    return applyDescription(z.array(items), schema);
  }
  if (typeName === "null") {
    return z.null();
  }

  return convertObjectSchema(schema);
}

export function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  if (!isRecord(schema)) {
    return z.object({}).catchall(z.unknown());
  }
  return convertSchema(schema);
}
