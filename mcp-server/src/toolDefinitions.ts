import {
  figmaCaptureInputJsonSchema,
  visualIntentHandoffGuide,
  visualIntentInputJsonSchema
} from "./services/designBridge/visualIntentJsonSchema";

type JsonSchema = Record<string, unknown>;

export type PublicToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  exampleInvocation: Record<string, unknown>;
  exampleOutput: Record<string, unknown>;
};

const okEnvelopeSchema = {
  type: "object",
  required: ["ok", "data"],
  properties: {
    ok: { type: "boolean", const: true },
    data: { type: "object" }
  },
  additionalProperties: false
} as const;

export const publicToolDefinitions: PublicToolDefinition[] = [
  {
    name: "connect_wordpress",
    description: "Use to connect to a WordPress root and verify it is ready before other tools.",
    inputSchema: {
      type: "object",
      properties: {
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path. Defaults to configured WP_ROOT."
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["health", "config"],
          properties: {
            health: {
              type: "object",
              required: ["status", "wordpressVersion", "phpVersion", "isMultisite"],
              properties: {
                status: { type: "string", const: "ok" },
                wordpressVersion: { type: "string" },
                phpVersion: { type: "string" },
                isMultisite: { type: "boolean" }
              },
              additionalProperties: false
            },
            config: {
              type: "object",
              required: ["wpRoot", "wpCliPath", "tablePrefix"],
              properties: {
                wpRoot: { type: "string" },
                wpCliPath: { type: "string" },
                tablePrefix: { type: "string", description: "Database table prefix ($wpdb->prefix) for building SELECT table names." }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      wpRoot: "/var/www/html"
    },
    exampleOutput: {
      ok: true,
      data: {
        health: {
          status: "ok",
          wordpressVersion: "6.8.1",
          phpVersion: "8.3.8",
          isMultisite: false
        },
        config: {
          wpRoot: "/var/www/html",
          wpCliPath: "/usr/local/bin/wp",
          tablePrefix: "wp_"
        }
      }
    }
  },
  {
    name: "build_wp_index",
    description: "Use to build or refresh the local index. Required before audit or similarity tools when the index has not been built yet.",
    inputSchema: {
      type: "object",
      properties: {
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        },
        mode: {
          type: "string",
          enum: ["full", "filesystem-only", "content-only"],
          description: "Index build scope."
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Optional content row limit for indexing."
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["status", "summary"],
          properties: {
            status: {
              type: "object",
              required: ["schemaVersion", "lastBuildAt", "counts"],
              properties: {
                schemaVersion: { type: "integer" },
                lastBuildAt: { type: ["string", "null"] },
                counts: {
                  type: "object",
                  required: ["blocks", "patterns", "templates", "content", "postmeta_index", "options_index", "menus_index"],
                  properties: {
                    blocks: { type: "integer" },
                    patterns: { type: "integer" },
                    templates: { type: "integer" },
                    content: { type: "integer" },
                    postmeta_index: { type: "integer" },
                    options_index: { type: "integer" },
                    menus_index: { type: "integer" }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            },
            summary: {
              type: "object",
              required: ["discovered", "indexed", "debugExports", "rebuiltAt"],
              properties: {
                discovered: {
                  type: "object",
                  required: ["blocks", "patterns", "templates", "content", "postmeta", "options", "menus"],
                  properties: {
                    blocks: { type: "integer" },
                    patterns: { type: "integer" },
                    templates: { type: "integer" },
                    content: { type: "integer" },
                    postmeta: { type: "integer" },
                    options: { type: "integer" },
                    menus: { type: "integer" }
                  },
                  additionalProperties: false
                },
                indexed: {
                  type: "object",
                  required: ["blocks", "patterns", "templates", "content", "postmeta_index", "options_index", "menus_index"],
                  properties: {
                    blocks: { type: "integer" },
                    patterns: { type: "integer" },
                    templates: { type: "integer" },
                    content: { type: "integer" },
                    postmeta_index: { type: "integer" },
                    options_index: { type: "integer" },
                    menus_index: { type: "integer" }
                  },
                  additionalProperties: false
                },
                debugExports: {
                  type: "object",
                  required: ["blocks", "patterns", "templates"],
                  properties: {
                    blocks: { type: "string" },
                    patterns: { type: "string" },
                    templates: { type: "string" }
                  },
                  additionalProperties: false
                },
                rebuiltAt: { type: "string" }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      mode: "full",
      limit: 500
    },
    exampleOutput: {
      ok: true,
      data: {
        status: {
          schemaVersion: 3,
          lastBuildAt: "2026-03-18T09:10:32.110Z",
          counts: {
            blocks: 42,
            patterns: 31,
            templates: 18,
            content: 500,
            postmeta_index: 500,
            options_index: 40,
            menus_index: 24
          }
        },
        summary: {
          discovered: {
            blocks: 42,
            patterns: 31,
            templates: 18,
            content: 500,
            postmeta: 500,
            options: 40,
            menus: 24
          },
          indexed: {
            blocks: 42,
            patterns: 31,
            templates: 18,
            content: 500,
            postmeta_index: 500,
            options_index: 40,
            menus_index: 24
          },
          debugExports: {
            blocks: "/var/www/html/.cursor-wp-index/blocks.json",
            patterns: "/var/www/html/.cursor-wp-index/patterns.json",
            templates: "/var/www/html/.cursor-wp-index/templates.json"
          },
          rebuiltAt: "2026-03-18T09:10:32.110Z"
        }
      }
    }
  },
  {
    name: "get_index_status",
    description: "Use to check whether the local index is ready and see indexed record counts.",
    inputSchema: {
      type: "object",
      properties: {
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["schemaVersion", "lastBuildAt", "counts"],
          properties: {
            schemaVersion: { type: "integer" },
            lastBuildAt: { type: ["string", "null"] },
            counts: {
              type: "object",
              required: ["blocks", "patterns", "templates", "content", "postmeta_index", "options_index", "menus_index"],
              properties: {
                blocks: { type: "integer" },
                patterns: { type: "integer" },
                templates: { type: "integer" },
                content: { type: "integer" },
                postmeta_index: { type: "integer" },
                options_index: { type: "integer" },
                menus_index: { type: "integer" }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {},
    exampleOutput: {
      ok: true,
      data: {
        schemaVersion: 3,
        lastBuildAt: "2026-03-18T09:10:32.110Z",
        counts: {
          blocks: 42,
          patterns: 31,
          templates: 18,
          content: 500,
          postmeta_index: 500,
          options_index: 40,
          menus_index: 24
        }
      }
    }
  },
  {
    name: "sync_local_db_from_dump",
    description:
      "Use when a teammate asks to update local db, sync local db from a dump, import a SQL dump into local WordPress, refresh local db and replace URLs, or import a dump and update API URL/token mappings. This tool is strictly DB-only: it imports and rewrites database content only, does not sync uploads/media/files, and should return guidance toward a separate file-sync capability if file sync is requested. Requires WP-CLI plus MySQL client binaries (mysql, mysqldump, mysqlcheck) visible to the MCP process—set WP_AGENT_EXTRA_PATH if they are installed but not on PATH.",
    inputSchema: {
      type: "object",
      required: ["dumpPath"],
      properties: {
        dumpPath: {
          type: "string",
          minLength: 1,
          description: "Absolute or relative path to a local `.sql` or `.sql.gz` dump file."
        },
        liveDomain: {
          type: "string",
          description:
            "Optional live domain/origin used for search-replace (for example: `example.com`). If omitted, the tool attempts safe inference from imported DB options and otherwise asks for explicit input."
        },
        localUrl: {
          type: "string",
          description:
            "Optional local URL override. If omitted, the tool attempts to detect it from local WordPress options and fails with a clear prompt if detection is insufficient."
        },
        replacementMappings: {
          type: "array",
          description:
            "Optional additional search-replace mappings applied after the primary domain replacement. Useful for API hosts, tokens, and other environment-specific strings (for example updating an API host URL or auth token).",
          items: {
            type: "object",
            required: ["from", "to"],
            properties: {
              from: {
                type: "string",
                minLength: 1
              },
              to: {
                type: "string",
                minLength: 1
              },
              label: {
                type: "string"
              }
            },
            additionalProperties: false
          }
        },
        multisiteMode: {
          type: ["string", "boolean"],
          enum: ["auto", "single-site", "multisite", true, false],
          description:
            "Optional override for site mode detection. Use `auto` (default), `single-site`, `multisite`, or boolean equivalents."
        },
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      required: [
        "success",
        "backupPath",
        "importedDumpPath",
        "detectedSiteType",
        "detectedLocalUrl",
        "primaryReplacementApplied",
        "additionalReplacementsApplied",
        "warnings"
      ],
      properties: {
        success: { type: "boolean" },
        backupPath: { type: ["string", "null"] },
        importedDumpPath: { type: ["string", "null"] },
        detectedSiteType: { type: ["string", "null"], enum: ["single-site", "multisite", null] },
        detectedLocalUrl: { type: ["string", "null"] },
        primaryReplacementApplied: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              required: ["label", "from", "to", "executedPairs"],
              properties: {
                label: { type: "string" },
                from: { type: "string" },
                to: { type: "string" },
                executedPairs: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["from", "to"],
                    properties: {
                      from: { type: "string" },
                      to: { type: "string" }
                    },
                    additionalProperties: false
                  }
                }
              },
              additionalProperties: false
            }
          ]
        },
        additionalReplacementsApplied: {
          type: "array",
          items: {
            type: "object",
            required: ["label", "from", "to", "executedPairs"],
            properties: {
              label: { type: "string" },
              from: { type: "string" },
              to: { type: "string" },
              executedPairs: {
                type: "array",
                items: {
                  type: "object",
                  required: ["from", "to"],
                  properties: {
                    from: { type: "string" },
                    to: { type: "string" }
                  },
                  additionalProperties: false
                }
              }
            },
            additionalProperties: false
          }
        },
        warnings: { type: "array", items: { type: "string" } },
        preflight: {
          type: "object",
          properties: {
            checks: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "ok", "message"],
                properties: {
                  id: {
                    type: "string",
                    enum: ["dump_path", "local_url", "mysql_clients", "db_reachable"]
                  },
                  ok: { type: "boolean" },
                  message: { type: "string" },
                  remediation: { type: "string" },
                  errorCode: { type: "string" }
                },
                additionalProperties: false
              }
            }
          },
          required: ["checks"],
          additionalProperties: false
        },
        verification: {
          type: "object",
          required: [
            "importMethod",
            "wpDbCheckOk",
            "homeOptionMatchesLocal",
            "siteurlOptionMatchesLocal",
            "dryRunReplacementsRemaining",
            "cacheFlushOk",
            "finalAssertionsPassed"
          ],
          properties: {
            importMethod: { type: "string", enum: ["wp_db_import", "wp_db_cli_stdin"] },
            wpDbCheckOk: { type: "boolean" },
            homeOptionMatchesLocal: { type: "boolean" },
            siteurlOptionMatchesLocal: { type: "boolean" },
            multisiteCoreDomainTablesAligned: { type: "boolean" },
            dryRunReplacementsRemaining: { type: "number" },
            cacheFlushOk: { type: "boolean" },
            finalAssertionsPassed: { type: "boolean" }
          },
          additionalProperties: false
        },
        errorCode: { type: "string" },
        errorMessage: { type: "string" },
        errorDetails: { type: "object", additionalProperties: true },
        outsideSandboxRemediation: {
          type: "object",
          description:
            "When `errorCode` is `DB_SYNC_REQUIRES_ELEVATED_CONTEXT`, copy-paste Terminal commands and IDE steps to unblock localhost MySQL from MCP.",
          additionalProperties: true
        }
      },
      additionalProperties: false
    },
    exampleInvocation: {
      dumpPath: "/Users/example/Downloads/live-db.sql.gz",
      liveDomain: "www.example.com",
      localUrl: "https://example.local",
      replacementMappings: [
        {
          from: "api.example.com",
          to: "api-dev.example.com",
          label: "api-host"
        },
        {
          from: "source-token",
          to: "target-token",
          label: "auth-token"
        }
      ],
      multisiteMode: "auto"
    },
    exampleOutput: {
      success: true,
      backupPath: "/var/www/html/.wp-agent-db-backup-20260424-180102Z.sql",
      importedDumpPath: "/Users/example/Downloads/live-db.sql.gz",
      detectedSiteType: "single-site",
      detectedLocalUrl: "https://example.local",
      primaryReplacementApplied: {
        label: "primary-domain",
        from: "www.example.com",
        to: "https://example.local",
        executedPairs: [
          {
            from: "https://www.example.com",
            to: "https://example.local"
          },
          {
            from: "http://www.example.com",
            to: "https://example.local"
          },
          {
            from: "www.example.com",
            to: "example.local"
          }
        ]
      },
      additionalReplacementsApplied: [
        {
          label: "api-host",
          from: "api.example.com",
          to: "api-dev.example.com",
          executedPairs: [
            {
              from: "api.example.com",
              to: "api-dev.example.com"
            }
          ]
        },
        {
          label: "auth-token",
          from: "source-token",
          to: "target-token",
          executedPairs: [
            {
              from: "source-token",
              to: "target-token"
            }
          ]
        }
      ],
      warnings: [],
      preflight: {
        checks: [
          { id: "dump_path", ok: true, message: "Dump file is readable at /Users/example/Downloads/live-db.sql.gz." },
          { id: "local_url", ok: true, message: "localUrl candidate: https://example.local." },
          { id: "mysql_clients", ok: true, message: "mysql, mysqldump, and mysqlcheck are reachable for WP-CLI database commands." },
          { id: "db_reachable", ok: true, message: "`wp db check` succeeded (MySQL client can reach the WordPress database)." }
        ]
      },
      verification: {
        importMethod: "wp_db_import",
        wpDbCheckOk: true,
        homeOptionMatchesLocal: true,
        siteurlOptionMatchesLocal: true,
        dryRunReplacementsRemaining: 0,
        cacheFlushOk: true,
        finalAssertionsPassed: true
      }
    }
  },
  {
    name: "get_theme_profile",
    description: "Use to inspect theme tokens, helper functions, and naming conventions for the active or specified theme.",
    inputSchema: {
      type: "object",
      properties: {
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        },
        themeSlug: {
          type: "string",
          description: "Optional theme slug/stylesheet name. Preferred for multisite or multi-theme projects."
        },
        themePath: {
          type: "string",
          description: "Optional absolute theme directory path override."
        },
        siteUrl: {
          type: "string",
          description: "Optional multisite URL context passed as `--url` to wp-cli."
        },
        blogId: {
          type: "integer",
          minimum: 1,
          description: "Optional multisite blog ID for active-theme resolution."
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["activeTheme", "tokens", "helpers", "conventions"],
          properties: {
            activeTheme: {
              type: "object",
              required: ["name", "path", "isBlockTheme"],
              properties: {
                name: { type: "string" },
                path: { type: "string" },
                isBlockTheme: { type: "boolean" }
              },
              additionalProperties: false
            },
            tokens: {
              type: "object",
              required: ["colors", "typography", "spacing", "customNamespaces"],
              properties: {
                colors: { type: "array", items: { type: "string" } },
                typography: { type: "array", items: { type: "string" } },
                spacing: { type: "array", items: { type: "string" } },
                customNamespaces: { type: "array", items: { type: "string" } }
              },
              additionalProperties: false
            },
            helpers: {
              type: "object",
              required: ["files", "notableFunctions"],
              properties: {
                files: { type: "array", items: { type: "string" } },
                notableFunctions: { type: "array", items: { type: "string" } }
              },
              additionalProperties: false
            },
            conventions: {
              type: "object",
              required: ["naming", "directories", "cssVarPrefixes"],
              properties: {
                naming: {
                  type: "object",
                  required: ["dominantFileCase", "phpFunctionPrefixes"],
                  properties: {
                    dominantFileCase: { type: "string" },
                    phpFunctionPrefixes: { type: "array", items: { type: "string" } }
                  },
                  additionalProperties: false
                },
                directories: { type: "array", items: { type: "string" } },
                cssVarPrefixes: { type: "array", items: { type: "string" } }
              },
              additionalProperties: false
            }
          },
          additionalProperties: true
        }
      }
    },
    exampleInvocation: {
      themeSlug: "tht-child"
    },
    exampleOutput: {
      ok: true,
      data: {
        activeTheme: {
          name: "tht-child",
          path: "/var/www/html/wp-content/themes/tht-child",
          isBlockTheme: true
        },
        tokens: {
          colors: ["--wp--preset--color--base", "--wp--preset--color--accent"],
          typography: ["--wp--preset--font-size--large", "--wp--preset--font-family--system"],
          spacing: ["--wp--preset--spacing--40"],
          customNamespaces: ["brand"]
        },
        helpers: {
          files: ["functions.php", "inc/helpers.php"],
          notableFunctions: ["tt6_child_register_block_styles"]
        },
        conventions: {
          naming: {
            dominantFileCase: "kebab-case",
            phpFunctionPrefixes: ["tt6_child_"]
          },
          directories: ["patterns", "templates", "template-parts"],
          cssVarPrefixes: ["--wp--preset--", "--brand--"]
        }
      }
    }
  },
  {
    name: "get_design_bridge_readiness",
    description:
      "Check WordPress-side readiness for the design implementation bridge and return companion MCP setup guidance for Figma and Playwright.",
    inputSchema: {
      type: "object",
      properties: {
        wpRoot: { type: "string", description: "Optional absolute WordPress root path." },
        themeSlug: { type: "string", description: "Optional target theme slug if already known." }
      },
      additionalProperties: false
    },
    outputSchema: okEnvelopeSchema,
    exampleInvocation: {},
    exampleOutput: {
      ok: true,
      data: {
        wpRoot: { configured: true, valid: true, path: "/var/www/html" },
        index: { ready: true, schemaVersion: 3, lastBuildAt: "2026-01-01T00:00:00.000Z" },
        theme: { resolvable: true, activeTheme: "tht-child", themeSlugProvided: false },
        companionMcps: {
          figma: {
            detectableByWpAgent: false,
            requiredFor: ["figma-url", "figma-node-selection"],
            notRequiredFor: ["screenshot", "manual-description"],
            setupHint: "Enable the Figma MCP server in Cursor Settings → MCP.",
            agentCheck: "Agent should verify Figma MCP availability via GetDynamicTools before calling Figma capture tools."
          },
          playwright: {
            detectableByWpAgent: false,
            requiredFor: ["automated-verification"],
            optional: true,
            setupHint: "Enable Playwright MCP for automated post-implementation checks."
          }
        },
        readyForBridge: true,
        blockers: [],
        assistantMessage:
          "WordPress project is ready for design bridge reconciliation. Workflow: (1) get_design_bridge_readiness, (2) capture via Figma get_design_context or screenshot, (3) structure visualIntent (or pass figmaCapture), (4) bridge_design_to_implementation, (5) implement from spec, (6) verify. If you share a Figma link, ensure Figma MCP is enabled in Cursor; screenshots work without it."
      }
    }
  },
  {
    name: "bridge_design_to_implementation",
    description:
      `Reconcile interpreted visual design intent with this WordPress repo's theme tokens, conventions, and existing components. Returns an implementation spec, not generated code. ${visualIntentHandoffGuide}`,
    inputSchema: {
      type: "object",
      properties: {
        visualIntent: visualIntentInputJsonSchema,
        figmaCapture: figmaCaptureInputJsonSchema,
        wpRoot: { type: "string" },
        themeSlug: {
          type: "string",
          description: "Optional internal override when the agent already resolved a theme slug. Users speak in natural language; prefer componentHint."
        },
        themePath: { type: "string" },
        siteUrl: {
          type: "string",
          description: "Optional multisite URL context. Prefer configured WP_ROOT or siteUrl over blogId."
        },
        blogId: {
          type: "integer",
          minimum: 1,
          description: "Optional internal multisite blog ID for advanced agent context only."
        },
        componentHint: {
          type: "string",
          description: "Agent-populated natural-language excerpt from the user's request (component and optional theme hints)."
        },
        targetSurface: {
          type: "string",
          enum: ["block", "pattern", "template-part", "page-section"]
        }
      },
      additionalProperties: false
    },
    outputSchema: okEnvelopeSchema,
    exampleInvocation: {
      componentHint: "Implement this card hero in our tht theme",
      visualIntent: {
        layout: { structure: "two-column hero with image right", regions: [{ id: "hero", role: "hero" }] },
        typography: [{ role: "heading", emphasis: "primary" }],
        colors: [{ role: "background", emphasis: "primary" }, { role: "text", emphasis: "primary" }],
        spacing: { rhythm: "normal", sectionPadding: "lg" },
        components: [{ label: "hero", kind: "hero" }]
      }
    },
    exampleOutput: {
      ok: true,
      data: {
        queryEcho: {
          visualIntentSummary: "two-column hero with image right | components: hero",
          themeResolution: { mode: "explicit_slug", themeSlug: "tht-child" }
        },
        requiresThemeSelection: false
      }
    }
  },
  {
    name: "audit_component",
    description: "Use to check whether a WordPress component, block, pattern, template, or variant already exists and whether to reuse, extend, or create. For direct usage lookups, use `where_is_used`.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: ["string", "object"],
          description: "Preferred input. Natural-language query string (for example: compact testimonial section). Structured query objects are also supported."
        },
        componentQuerySpec: {
          type: "object",
          description: "Optional structured query object (legacy alias for advanced usage)."
        },
        component_query: {
          type: "string",
          minLength: 1,
          description: "Optional legacy alias for natural-language query."
        },
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100
        }
      },
      anyOf: [{ required: ["query"] }, { required: ["componentQuerySpec"] }, { required: ["component_query"] }],
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["verdict", "bestMatch", "variants", "usage", "recommendation"],
          properties: {
            verdict: { type: "string", enum: ["exists", "partial", "missing"] },
            bestMatch: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  required: ["type", "id", "path", "enableSteps", "usageCount", "reasons"],
                  properties: {
                    type: { type: "string", enum: ["block", "pattern", "template", "content"] },
                    id: { type: "string" },
                    path: { type: ["string", "null"] },
                    enableSteps: { type: "array", items: { type: "string" } },
                    usageCount: { type: "integer" },
                    reasons: { type: "array", items: { type: "string" } }
                  },
                  additionalProperties: false
                }
              ]
            },
            variants: {
              type: "object",
              required: ["existing", "missing", "recommendedMechanism"],
              properties: {
                existing: { type: "array", items: { type: "string" } },
                missing: { type: "array", items: { type: "string" } },
                recommendedMechanism: {
                  type: "object",
                  required: ["id", "reason"],
                  properties: {
                    id: {
                      type: "string",
                      enum: [
                        "block_styles",
                        "block_variations",
                        "pattern_variants",
                        "template_part_variants",
                        "css_modifiers"
                      ]
                    },
                    reason: { type: "string" }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            },
            usage: { type: "object" },
            recommendation: {
              type: "object",
              required: ["action", "approach", "rationale"],
              properties: {
                action: { type: "string", enum: ["reuse", "extend", "create"] },
                approach: { type: "string" },
                rationale: { type: "string" }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      query: "compact testimonial section"
    },
    exampleOutput: {
      ok: true,
      data: {
        verdict: "partial",
        bestMatch: {
          type: "pattern",
          id: "theme/pattern-testimonials-grid",
          path: "/var/www/html/wp-content/themes/tht/patterns/testimonials-grid.php",
          enableSteps: ["Insert pattern `theme/pattern-testimonials-grid`."],
          usageCount: 1,
          reasons: ["name token match: testimonials", "variant hint: compact", "in-use evidence: 1 matches"]
        },
        variants: {
          existing: ["default"],
          missing: ["compact"],
          recommendedMechanism: {
            id: "pattern_variants",
            reason: "Pattern variants are already used for neighboring component variants."
          }
        },
        usage: {
          content: { count: 2, matches: [] },
          patterns: { count: 1, matches: [] },
          templates: { count: 0, matches: [] }
        },
        recommendation: {
          action: "extend",
          approach: "pattern",
          rationale: "Strong nearby match exists and the project already uses pattern variants."
        }
      }
    }
  },
  {
    name: "find_similar_content",
    description: "Use to find similar content or structure by intent across posts, pages, patterns, and templates. For direct exact usage lookup, use `where_is_used`.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Preferred input. Natural-language query, slug, or semantic hint."
        },
        componentName: {
          type: "string",
          minLength: 1,
          description: "Optional legacy alias for query."
        },
        className: {
          type: "string",
          minLength: 1,
          description: "Optional single CSS class name hint."
        },
        classNames: {
          type: "array",
          items: {
            type: "string",
            minLength: 1
          },
          description: "Optional class-name hints for advanced similarity matching."
        },
        blockNames: {
          type: "array",
          items: {
            type: "string",
            minLength: 1
          },
          description: "Optional block-name hints (for example: core/group)."
        },
        snippet: {
          type: "string",
          minLength: 1,
          description: "Optional markup snippet used for marker and fingerprint matching."
        },
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100
        }
      },
      anyOf: [
        { required: ["query"] },
        { required: ["componentName"] },
        { required: ["className"] },
        { required: ["classNames"] },
        { required: ["blockNames"] },
        { required: ["snippet"] }
      ],
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["queryEcho", "matches"],
          properties: {
            queryEcho: {
              type: "object",
              required: ["query", "classNames", "blockNames", "snippet", "limit"],
              properties: {
                query: { type: "string" },
                classNames: { type: "array", items: { type: "string" } },
                blockNames: { type: "array", items: { type: "string" } },
                snippet: { type: "string" },
                limit: { type: "integer" }
              },
              additionalProperties: false
            },
            matches: {
              type: "object",
              required: ["content", "postmeta", "options", "menus", "patterns", "templates", "customTables", "files"],
              properties: {
                content: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "sourceType",
                      "id",
                      "identifier",
                      "postType",
                      "title",
                      "snippet",
                      "score",
                      "reason",
                      "preview",
                      "confidence",
                      "reasons"
                    ],
                    properties: {
                      sourceType: { type: "string", const: "content" },
                      id: { type: "string" },
                      identifier: { type: "string" },
                      postType: { type: "string" },
                      title: { type: "string" },
                      slug: { type: ["string", "null"] },
                      url: { type: ["string", "null"] },
                      snippet: { type: "string" },
                      score: { type: "number" },
                      reason: { type: "string" },
                      preview: { type: "string" },
                      confidence: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                },
                postmeta: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "sourceType",
                      "id",
                      "identifier",
                      "postId",
                      "metaKey",
                      "snippet",
                      "score",
                      "reason",
                      "preview",
                      "confidence",
                      "reasons"
                    ],
                    properties: {
                      sourceType: { type: "string", const: "postmeta" },
                      id: { type: "string" },
                      identifier: { type: "string" },
                      postId: { type: "string" },
                      metaKey: { type: "string" },
                      snippet: { type: "string" },
                      score: { type: "number" },
                      reason: { type: "string" },
                      preview: { type: "string" },
                      confidence: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "sourceType",
                      "id",
                      "identifier",
                      "optionName",
                      "snippet",
                      "score",
                      "reason",
                      "preview",
                      "confidence",
                      "reasons"
                    ],
                    properties: {
                      sourceType: { type: "string", const: "options" },
                      id: { type: "string" },
                      identifier: { type: "string" },
                      optionName: { type: "string" },
                      snippet: { type: "string" },
                      score: { type: "number" },
                      reason: { type: "string" },
                      preview: { type: "string" },
                      confidence: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                },
                menus: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "sourceType",
                      "id",
                      "identifier",
                      "postId",
                      "title",
                      "snippet",
                      "score",
                      "reason",
                      "preview",
                      "confidence",
                      "reasons"
                    ],
                    properties: {
                      sourceType: { type: "string", const: "menus" },
                      id: { type: "string" },
                      identifier: { type: "string" },
                      postId: { type: "string" },
                      title: { type: "string" },
                      snippet: { type: "string" },
                      score: { type: "number" },
                      reason: { type: "string" },
                      preview: { type: "string" },
                      confidence: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                },
                patterns: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "sourceType",
                      "id",
                      "identifier",
                      "slug",
                      "title",
                      "path",
                      "snippet",
                      "score",
                      "reason",
                      "confidence",
                      "reasons"
                    ],
                    properties: {
                      sourceType: { type: "string", const: "patterns" },
                      id: { type: "string" },
                      identifier: { type: "string" },
                      slug: { type: "string" },
                      title: { type: "string" },
                      path: { type: "string" },
                      snippet: { type: "string" },
                      score: { type: "number" },
                      reason: { type: "string" },
                      confidence: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                },
                templates: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "sourceType",
                      "id",
                      "identifier",
                      "type",
                      "path",
                      "snippet",
                      "score",
                      "reason",
                      "confidence",
                      "reasons"
                    ],
                    properties: {
                      sourceType: { type: "string", const: "templates" },
                      id: { type: "string" },
                      identifier: { type: "string" },
                      type: { type: "string" },
                      path: { type: "string" },
                      snippet: { type: "string" },
                      score: { type: "number" },
                      reason: { type: "string" },
                      confidence: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                },
                customTables: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "sourceType",
                      "sourceName",
                      "rowId",
                      "identifier",
                      "snippet",
                      "score",
                      "reason",
                      "confidence",
                      "reasons"
                    ],
                    properties: {
                      sourceType: { type: "string", const: "custom_tables" },
                      sourceName: { type: "string" },
                      rowId: { type: "string" },
                      identifier: { type: "string" },
                      snippet: { type: "string" },
                      score: { type: "number" },
                      reason: { type: "string" },
                      confidence: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                },
                files: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["path", "confidence", "reasons"],
                    properties: {
                      path: { type: "string" },
                      confidence: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      query: "footer disclosure"
    },
    exampleOutput: {
      ok: true,
      data: {
        queryEcho: {
          query: "footer disclosure",
          classNames: [],
          blockNames: [],
          snippet: "",
          limit: 25
        },
        matches: {
          content: [
            {
              sourceType: "content",
              id: "91",
              identifier: "post_id:91",
              postType: "page",
              title: "Home",
              slug: "home",
              url: "https://example.local/home/",
              snippet: "home footer disclosure and legal links",
              score: 0.82,
              reason: "text partial match",
              preview: "home",
              confidence: 0.82,
              reasons: ["name token overlap: hero", "name token overlap: cta"]
            }
          ],
          postmeta: [
            {
              sourceType: "postmeta",
              id: "f11fbd",
              identifier: "post_id:91",
              postId: "91",
              metaKey: "hero_disclosure",
              snippet: "product disclosure for regional visitors...",
              score: 0.46,
              reason: "text partial match",
              preview: "product disclosure for regional visitors...",
              confidence: 0.46,
              reasons: ["name token overlap: disclosure"]
            }
          ],
          options: [],
          menus: [],
          patterns: [],
          templates: [],
          customTables: [],
          files: []
        }
      }
    }
  },
  {
    name: "where_is_used",
    description: "Use this to find where a WordPress component, block, class, shortcode, function, string, template part, pattern, or content fragment is used across files, posts, custom fields, options, menus, and indexed plugin/custom-table data.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Text fragment to locate (for example: `.footer-disclosure`, `mytheme/testimonial-card`, `[gravityform]`)."
        },
        kind: {
          type: "string",
          enum: ["class", "block", "shortcode", "function", "template", "pattern", "string", "auto"],
          description: "Optional hint to force match interpretation."
        },
        scope: {
          type: "object",
          properties: {
            files: { type: "boolean" },
            content: { type: "boolean" },
            postmeta: { type: "boolean" },
            options: { type: "boolean" },
            menus: { type: "boolean" },
            customTables: { type: "boolean" }
          },
          additionalProperties: false
        },
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        },
        limitPerGroup: {
          type: "integer",
          minimum: 1,
          maximum: 50
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["query", "detectedKind", "summary", "groups", "recommendation"],
          properties: {
            query: { type: "string" },
            detectedKind: { type: "string" },
            summary: {
              type: "object",
              required: ["totalMatches", "groupsWithMatches"],
              properties: {
                totalMatches: { type: "integer" },
                groupsWithMatches: { type: "array", items: { type: "string" } }
              },
              additionalProperties: false
            },
            groups: {
              type: "object",
              required: ["templates", "patterns", "files", "content", "menus", "postmeta", "options", "customTables"],
              properties: {
                templates: { type: "array", items: { type: "object" } },
                patterns: { type: "array", items: { type: "object" } },
                files: { type: "array", items: { type: "object" } },
                content: { type: "array", items: { type: "object" } },
                menus: { type: "array", items: { type: "object" } },
                postmeta: { type: "array", items: { type: "object" } },
                options: { type: "array", items: { type: "object" } },
                customTables: { type: "array", items: { type: "object" } }
              },
              additionalProperties: false
            },
            recommendation: { type: "string" }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      query: "footer-disclosure"
    },
    exampleOutput: {
      ok: true,
      data: {
        query: "footer-disclosure",
        detectedKind: "class",
        summary: {
          totalMatches: 4,
          groupsWithMatches: ["templates", "content", "postmeta"]
        },
        groups: {
          templates: [
            {
              sourceType: "templates",
              identifier: "template:wp-content/themes/tht/parts/footer.html",
              path: "wp-content/themes/tht/parts/footer.html",
              score: 0.91,
              snippet: "wp-block-group footer-disclosure legal links",
              reason: "class match"
            }
          ],
          patterns: [],
          files: [
            {
              sourceType: "files",
              identifier: "file:wp-content/themes/tht/parts/footer.html:22",
              path: "wp-content/themes/tht/parts/footer.html",
              line: 22,
              score: 0.9,
              snippet: "<div class=\"footer-disclosure\">",
              reason: "text exact match"
            }
          ],
          content: [],
          menus: [],
          postmeta: [],
          options: [],
          customTables: []
        },
        recommendation: "Primary usage appears in template files. Validate those first before updating content or settings."
      }
    }
  },
  {
    name: "apply_patch",
    description: "Use to apply a validated unified diff patch in the WordPress root and run safety checks.",
    inputSchema: {
      type: "object",
      required: ["patch"],
      properties: {
        patch: {
          type: "string",
          minLength: 1,
          description: "Unified diff text."
        },
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["applied", "filesChanged", "checks"],
          properties: {
            applied: { type: "boolean", const: true },
            filesChanged: { type: "array", items: { type: "string" } },
            checks: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "ok"],
                properties: {
                  name: { type: "string" },
                  ok: { type: "boolean" },
                  file: { type: "string" },
                  command: { type: "string" },
                  output: { type: "string" }
                },
                additionalProperties: false
              }
            }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      patch: "diff --git a/style.css b/style.css\n--- a/style.css\n+++ b/style.css\n@@ -1,1 +1,2 @@\n .btn { color: #111; }\n+.btn--compact { padding: 8px 12px; }\n"
    },
    exampleOutput: {
      ok: true,
      data: {
        applied: true,
        filesChanged: ["style.css"],
        checks: [
          {
            name: "php-lint",
            ok: true
          }
        ]
      }
    }
  },
  {
    name: "read_project_file",
    description: "Use to read a project file in the WordPress root before editing or auditing.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: "Project-relative path or absolute path under wpRoot."
        },
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        },
        maxBytes: {
          type: "integer",
          minimum: 1,
          description: "Optional output byte cap."
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["path", "content", "truncated"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            truncated: { type: "boolean" }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      path: "wp-content/themes/tht/style.css"
    },
    exampleOutput: {
      ok: true,
      data: {
        path: "/var/www/html/wp-content/themes/tht/style.css",
        content: ".hero{display:grid;gap:var(--wp--preset--spacing--40);}\n",
        truncated: false
      }
    }
  },
  {
    name: "search_project_files",
    description:
      "Search project files for plain text or regex (`isRegex`). Optionally narrow with `path` or `scope` (subdirectory under wpRoot), `glob`, and `limit`.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Search term (plain text or regex based on isRegex)."
        },
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        },
        path: {
          type: "string",
          description: "Optional subdirectory or file path under wpRoot. If both `path` and `scope` are set, `path` wins."
        },
        scope: {
          type: "string",
          description:
            "Optional subdirectory under wpRoot (alias for `path`). Models often use `scope` after `where_is_used`; prefer `path` for new calls."
        },
        glob: {
          type: "string",
          description: "Optional glob filter, e.g. `*.php` or `*.{php,html}`."
        },
        isRegex: {
          type: "boolean",
          description: "Interpret `query` as regex when true."
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["queryEcho", "matches"],
          properties: {
            queryEcho: {
              type: "object",
              required: ["query", "isRegex"],
              properties: {
                query: { type: "string" },
                isRegex: { type: "boolean" }
              },
              additionalProperties: false
            },
            matches: {
              type: "array",
              items: {
                type: "object",
                required: ["path", "line", "column", "preview"],
                properties: {
                  path: { type: "string" },
                  line: { type: "integer" },
                  column: { type: "integer" },
                  preview: { type: "string" }
                },
                additionalProperties: false
              }
            }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      query: "is-style-compact",
      glob: "*.php",
      limit: 20
    },
    exampleOutput: {
      ok: true,
      data: {
        queryEcho: {
          query: "is-style-compact",
          isRegex: false
        },
        matches: [
          {
            path: "wp-content/themes/tht/patterns/testimonials-grid.php",
            line: 27,
            column: 16,
            preview: "<div class=\"wp-block-group is-style-compact\">"
          }
        ]
      }
    }
  },
  {
    name: "query_wp_db_readonly",
    description:
      "Run a single read-only `SELECT` against the WordPress MySQL database via `wp db query`. Use for ad hoc reporting (slugs, statuses, meta joins) that the SQLite index does not model. Only `SELECT` is allowed; writes, DDL, cross-schema reads, and dangerous functions are rejected. If the statement has no `LIMIT`, one is appended (capped by `maxRows`). Supports optional multisite context with `siteUrl` or `blogId`. Pass `tablePrefix` from a prior `connect_wordpress` call to skip the prefix-resolution round-trip.",
    inputSchema: {
      type: "object",
      required: ["sql"],
      properties: {
        sql: {
          type: "string",
          minLength: 1,
          description:
            "One `SELECT` statement. Trailing semicolon optional. Must include an explicit `LIMIT` ≤ `maxRows`, or a `LIMIT` will be appended automatically. Both `LIMIT count` and `LIMIT offset, count` forms are accepted."
        },
        wpRoot: {
          type: "string",
          description: "Optional absolute WordPress root path."
        },
        tablePrefix: {
          type: "string",
          description: "Optional pre-resolved table prefix (e.g. `wp_` or `wp_2_`) from a prior `connect_wordpress` call. Supplying it skips an internal `wp eval` round-trip."
        },
        siteUrl: {
          type: "string",
          description: "Optional multisite URL context (passed as `--url`) used for prefix resolution and query execution context."
        },
        blogId: {
          type: "integer",
          minimum: 1,
          description: "Optional multisite blog/site ID. Applies `switch_to_blog(blogId)` for prefix resolution and eval fallback."
        },
        maxRows: {
          type: "integer",
          minimum: 1,
          maximum: 2000,
          description: "Maximum rows when auto-appending `LIMIT` (default 200, hard cap 2000)."
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      ...okEnvelopeSchema,
      properties: {
        ok: { type: "boolean", const: true },
        data: {
          type: "object",
          required: ["wpRoot", "tablePrefix", "context", "sqlExecuted", "columns", "stdout", "stdoutTruncated", "stdoutCharCount"],
          properties: {
            wpRoot: { type: "string" },
            tablePrefix: { type: "string" },
            context: {
              type: "object",
              required: ["siteUrl", "blogId"],
              properties: {
                siteUrl: { type: ["string", "null"] },
                blogId: { type: ["integer", "null"] }
              },
              additionalProperties: false
            },
            sqlExecuted: { type: "string" },
            columns: {
              type: "array",
              items: { type: "string" },
              description: "Column names in select-list order. Use these to map `stdout` rows by position."
            },
            stdout: {
              type: "string",
              description: "Tab-separated data rows (no header line). Map columns to values by position."
            },
            stdoutTruncated: { type: "boolean" },
            stdoutCharCount: { type: "integer" }
          },
          additionalProperties: false
        }
      }
    },
    exampleInvocation: {
      sql: "SELECT ID, post_name, post_status FROM wp_posts WHERE post_type = 'page' AND post_status = 'publish'",
      tablePrefix: "wp_2_",
      blogId: 2,
      maxRows: 50
    },
    exampleOutput: {
      ok: true,
      data: {
        wpRoot: "/var/www/html",
        tablePrefix: "wp_2_",
        context: {
          siteUrl: null,
          blogId: 2
        },
        sqlExecuted:
          "SELECT ID, post_name, post_status FROM wp_posts WHERE post_type = 'page' AND post_status = 'publish' LIMIT 50",
        columns: ["ID", "post_name", "post_status"],
        stdout: "123\thome\tpublish\n",
        stdoutTruncated: false,
        stdoutCharCount: 18
      }
    }
  }
];

export const publicToolDefinitionsByName: Record<string, PublicToolDefinition> =
  Object.fromEntries(publicToolDefinitions.map((tool) => [tool.name, tool]));
