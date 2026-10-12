export const visualIntentInputJsonSchema = {
  type: "object",
  description:
    "Semantic visual intent from Figma/screenshot interpretation. Map design roles (not raw Figma literals) before calling the bridge.",
  required: ["layout"],
  properties: {
    source: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["figma", "screenshot", "manual"] },
        url: { type: "string" },
        nodeId: { type: "string" }
      },
      additionalProperties: false
    },
    layout: {
      type: "object",
      required: ["structure"],
      properties: {
        structure: {
          type: "string",
          description: "Natural-language layout summary (for example: two-column hero with image right)."
        },
        regions: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "role"],
            properties: {
              id: { type: "string" },
              role: { type: "string" },
              notes: { type: "string" }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    typography: {
      type: "array",
      items: {
        type: "object",
        required: ["role"],
        properties: {
          role: {
            type: "string",
            enum: ["display", "heading", "subheading", "body", "caption", "label"]
          },
          emphasis: { type: "string", enum: ["primary", "secondary", "muted"] },
          raw: {
            type: "object",
            properties: {
              fontFamily: { type: "string" },
              fontSize: { type: "string" },
              fontWeight: { type: "string" },
              lineHeight: { type: "string" }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    },
    colors: {
      type: "array",
      items: {
        type: "object",
        required: ["role"],
        properties: {
          role: {
            type: "string",
            enum: ["background", "surface", "text", "heading", "accent", "border", "interactive"]
          },
          emphasis: { type: "string", enum: ["primary", "secondary", "muted"] },
          raw: {
            type: "object",
            properties: {
              hex: { type: "string" },
              rgba: { type: "string" }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    },
    spacing: {
      type: "object",
      properties: {
        rhythm: { type: "string", enum: ["tight", "normal", "loose"] },
        sectionPadding: { type: "string", enum: ["sm", "md", "lg", "xl"] },
        gaps: { type: "string", enum: ["sm", "md", "lg"] },
        raw: {
          type: "object",
          properties: {
            padding: { type: "string", description: "Raw spacing hint such as 88px (mapped to theme tokens)." },
            gap: { type: "string" }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    },
    responsive: {
      type: "object",
      properties: {
        mobile: { type: "string" },
        tablet: { type: "string" },
        desktop: { type: "string" }
      },
      additionalProperties: false
    },
    components: {
      type: "array",
      description: "Component labels and kinds. Include block slugs such as tht/card-hero when known.",
      items: {
        type: "object",
        required: ["label"],
        properties: {
          label: { type: "string" },
          kind: {
            type: "string",
            enum: ["navigation", "hero", "card", "form", "footer", "generic"]
          },
          contains: { type: "array", items: { type: "string" } }
        },
        additionalProperties: false
      }
    },
    assets: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type"],
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["image", "icon", "logo"] },
          notes: { type: "string" }
        },
        additionalProperties: false
      }
    },
    annotations: { type: "array", items: { type: "string" } }
  },
  additionalProperties: false
} as const;

export const figmaCaptureInputJsonSchema = {
  type: "object",
  description:
    "Optional passthrough from Figma get_design_context. When provided without a fully structured visualIntent, the bridge maps node names and structure into semantic intent.",
  additionalProperties: true
} as const;

export const visualIntentHandoffGuide = [
  "After get_design_context: extract node/component names, layout structure, and color/spacing roles.",
  "Populate visualIntent.layout.structure plus components[].label (include block slugs like namespace/block-name when visible).",
  "Keep raw Figma values under *.raw only; semantic roles drive token reconciliation.",
  "Alternatively pass figmaCapture directly and let the bridge derive a first-pass visualIntent."
].join(" ");
