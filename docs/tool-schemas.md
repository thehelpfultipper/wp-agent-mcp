# MCP Public Tool Schemas

This document defines stable, public input/output contracts for the MCP tool surface.
Each tool is intent-first and does not require the model to know HTTP endpoint details.
Direct endpoint invocation is legacy/transitional and not the recommended public interface.

## Shared Output Envelope

All tools return:

```json
{
  "ok": true,
  "data": {}
}
```

Errors return:

```json
{
  "ok": false,
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Human-readable explanation",
    "details": {}
  }
}
```

---

## 1) `connect_wordpress`

- **description:** Use to connect to a WordPress root and verify it is ready before other tools.
- **input schema:**

```json
{
  "type": "object",
  "properties": {
    "wpRoot": { "type": "string" }
  },
  "additionalProperties": false
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["wpRoot", "wpCliPath", "phpVersion", "wpVersion", "isMultisite"],
      "properties": {
        "wpRoot": { "type": "string" },
        "wpCliPath": { "type": "string" },
        "phpVersion": { "type": "string" },
        "wpVersion": { "type": "string" },
        "isMultisite": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Connect to my local WordPress site at /var/www/html and verify it is ready.`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "wpRoot": "/var/www/html",
    "wpCliPath": "/usr/local/bin/wp",
    "phpVersion": "8.3.8",
    "wpVersion": "6.8.1",
    "isMultisite": false
  }
}
```

---

## 2) `build_wp_index`

- **description:** Use to build or refresh the local index before running audit or similarity tools.
- **input schema:**

```json
{
  "type": "object",
  "properties": {
    "wpRoot": { "type": "string" },
    "mode": { "type": "string", "enum": ["full", "filesystem-only", "content-only"] },
    "limit": { "type": "integer", "minimum": 1 }
  },
  "additionalProperties": false
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["status", "summary"],
      "properties": {
        "status": {
          "type": "object",
          "required": ["schemaVersion", "lastBuildAt", "counts"],
          "properties": {
            "schemaVersion": { "type": "integer" },
            "lastBuildAt": { "type": ["string", "null"] },
            "counts": {
              "type": "object",
              "required": ["blocks", "patterns", "templates", "content"],
              "properties": {
                "blocks": { "type": "integer" },
                "patterns": { "type": "integer" },
                "templates": { "type": "integer" },
                "content": { "type": "integer" }
              },
              "additionalProperties": false
            }
          },
          "additionalProperties": false
        },
        "summary": {
          "type": "object",
          "required": ["discovered", "indexed", "debugExports", "rebuiltAt"],
          "properties": {
            "discovered": { "type": "object" },
            "indexed": { "type": "object" },
            "debugExports": {
              "type": "object",
              "required": ["blocks", "patterns", "templates"],
              "properties": {
                "blocks": { "type": "string" },
                "patterns": { "type": "string" },
                "templates": { "type": "string" }
              },
              "additionalProperties": false
            },
            "rebuiltAt": { "type": "string" }
          },
          "additionalProperties": true
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Rebuild the WordPress index in full mode and include up to 500 content entries.`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "status": {
      "schemaVersion": 1,
      "lastBuildAt": "2026-03-18T09:10:32.110Z",
      "counts": { "blocks": 42, "patterns": 31, "templates": 18, "content": 500 }
    },
    "summary": {
      "discovered": { "blocks": 42, "patterns": 31, "templates": 18, "content": 500 },
      "indexed": { "blocks": 42, "patterns": 31, "templates": 18, "content": 500 },
      "debugExports": {
        "blocks": "/var/www/html/.cursor-wp-index/blocks.json",
        "patterns": "/var/www/html/.cursor-wp-index/patterns.json",
        "templates": "/var/www/html/.cursor-wp-index/templates.json"
      },
      "rebuiltAt": "2026-03-18T09:10:32.110Z"
    }
  }
}
```

---

## 3) `get_index_status`

- **description:** Use to check whether the local index is ready and see indexed record counts.
- **input schema:**

```json
{
  "type": "object",
  "properties": {
    "wpRoot": { "type": "string" }
  },
  "additionalProperties": false
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["schemaVersion", "lastBuildAt", "counts"],
      "properties": {
        "schemaVersion": { "type": "integer" },
        "lastBuildAt": { "type": ["string", "null"] },
        "counts": {
          "type": "object",
          "required": ["blocks", "patterns", "templates", "content"],
          "properties": {
            "blocks": { "type": "integer" },
            "patterns": { "type": "integer" },
            "templates": { "type": "integer" },
            "content": { "type": "integer" }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Check whether the local WordPress index is ready and show current counts.`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "schemaVersion": 1,
    "lastBuildAt": "2026-03-18T09:10:32.110Z",
    "counts": { "blocks": 42, "patterns": 31, "templates": 18, "content": 500 }
  }
}
```

---

## 4) `sync_local_db_from_dump`

- **description:** Use to safely import a user-provided SQL dump into the local WordPress database with automatic pre-import backup and deterministic replacement handling. This tool is DB-only (no uploads/files/media sync).
- **input schema:**

```json
{
  "type": "object",
  "required": ["dumpPath"],
  "properties": {
    "dumpPath": { "type": "string", "minLength": 1 },
    "liveDomain": { "type": "string" },
    "localUrl": { "type": "string" },
    "replacementMappings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to"],
        "properties": {
          "from": { "type": "string", "minLength": 1 },
          "to": { "type": "string", "minLength": 1 },
          "label": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "multisiteMode": { "type": ["string", "boolean"], "enum": ["auto", "single-site", "multisite", true, false] },
    "wpRoot": { "type": "string" }
  },
  "additionalProperties": false
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": [
    "success",
    "backupPath",
    "importedDumpPath",
    "detectedSiteType",
    "detectedLocalUrl",
    "primaryReplacementApplied",
    "additionalReplacementsApplied",
    "warnings"
  ],
  "properties": {
    "success": { "type": "boolean" },
    "backupPath": { "type": ["string", "null"] },
    "importedDumpPath": { "type": ["string", "null"] },
    "detectedSiteType": { "type": ["string", "null"], "enum": ["single-site", "multisite", null] },
    "detectedLocalUrl": { "type": ["string", "null"] },
    "primaryReplacementApplied": {
      "anyOf": [
        { "type": "null" },
        {
          "type": "object",
          "required": ["label", "from", "to", "executedPairs"],
          "properties": {
            "label": { "type": "string" },
            "from": { "type": "string" },
            "to": { "type": "string" },
            "executedPairs": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["from", "to"],
                "properties": {
                  "from": { "type": "string" },
                  "to": { "type": "string" }
                },
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }
      ]
    },
    "additionalReplacementsApplied": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["label", "from", "to", "executedPairs"],
        "properties": {
          "label": { "type": "string" },
          "from": { "type": "string" },
          "to": { "type": "string" },
          "executedPairs": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["from", "to"],
              "properties": {
                "from": { "type": "string" },
                "to": { "type": "string" }
              },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    },
    "warnings": { "type": "array", "items": { "type": "string" } },
    "errorCode": { "type": "string" },
    "errorMessage": { "type": "string" }
  },
  "additionalProperties": false
}
```

- **example user prompts:**

`Update local db from this dump`

`Sync my local db from this dump`

`Sync local db from /Users/me/Downloads/live-db.sql.gz`

`Import this SQL dump into local WordPress`

`Refresh local db and replace URLs`

`Import this dump and update the API host URL and token`

`Refresh my local WordPress db from this SQL dump`

- **input notes:**
  - `dumpPath` is required and must point to a local `.sql` or `.sql.gz` file.
  - `localUrl` is optional but may be required when local WordPress option auto-detection is unavailable.
  - `liveDomain` is optional but may be required when safe inference from imported DB options is ambiguous.
  - `replacementMappings` is optional and applies deterministic additional search-replace operations after the primary domain replacement; each mapping must include non-empty, different `from` and `to` strings.
  - `multisiteMode` override must match detected site mode unless set to `auto`.
  - The tool is DB-only and intentionally does not handle uploads/media/file sync. Mixed DB+file sync requests should be split, with file sync routed to a separate future capability.

- **failure notes:**
  - Invalid `dumpPath` values fail deterministically for missing file, invalid path, or unsupported dump extension.
  - Invalid replacement mappings fail deterministically with `TOOL_INPUT_INVALID`.
  - Ambiguous live-domain inference fails deterministically and asks for explicit `liveDomain`.
  - Multisite override mismatch fails deterministically and asks for `auto` or a matching mode.
  - Failures during replacement phase after successful import still return the backup location for rollback.
  - On any post-backup failure, `backupPath` remains available for manual restore.
  - **Preflight / verification:** Before backup, the server runs gated checks (`dump_path`, `local_url`, `mysql_clients`, `db_reachable`). Failures aggregate as `SYNC_PREFLIGHT_FAILED` with `preflight.checks[]` (each may include `remediation`). Sandbox-like DB failures return **`DB_SYNC_REQUIRES_ELEVATED_CONTEXT`** with **`outsideSandboxRemediation`** (`assistantMessage`, Terminal commands, IDE steps; no import). Success responses may include `preflight` plus `verification` (`importMethod`, summed dry-run totals, `home`/`siteurl` alignment, **`finalAssertionsPassed`**, cache flush). If `wp db import` and streaming `wp db cli` both fail, `IMPORT_METHOD_FAILED` includes both stderr payloads in `errorDetails`. Post-sync invariant violations use **`DB_SYNC_ASSERTION_FAILED`**.

- **example output payload:**

```json
{
  "success": true,
  "backupPath": "/var/www/html/.wp-agent-db-backup-20260424-180102Z.sql",
  "importedDumpPath": "/Users/me/Downloads/live-db.sql.gz",
  "detectedSiteType": "multisite",
  "detectedLocalUrl": "https://example.local",
  "primaryReplacementApplied": {
    "label": "primary-domain",
    "from": "www.example.com",
    "to": "https://example.local",
    "executedPairs": [
      { "from": "https://www.example.com", "to": "https://example.local" },
      { "from": "http://www.example.com", "to": "https://example.local" },
      { "from": "www.example.com", "to": "example.local" }
    ]
  },
  "additionalReplacementsApplied": [
    {
      "label": "api-host",
      "from": "api.example.com",
      "to": "api-dev.example.com",
      "executedPairs": [
        {
          "from": "api.example.com",
          "to": "api-dev.example.com"
        }
      ]
    },
    {
      "label": "auth-token",
      "from": "source-token",
      "to": "target-token",
      "executedPairs": [
        {
          "from": "source-token",
          "to": "target-token"
        }
      ]
    }
  ],
  "warnings": []
}
```

---

## 5) `get_theme_profile`

- **description:** Use to inspect active theme tokens, helper functions, and naming conventions.
- **input schema:**

```json
{
  "type": "object",
  "properties": {
    "wpRoot": { "type": "string" }
  },
  "additionalProperties": false
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["activeTheme", "tokens", "helpers", "conventions"],
      "properties": {
        "activeTheme": { "type": "object" },
        "tokens": { "type": "object" },
        "helpers": { "type": "object" },
        "conventions": { "type": "object" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Summarize the active theme's design system for this project.`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "activeTheme": {
      "name": "tht-child",
      "path": "/var/www/html/wp-content/themes/tht-child",
      "isBlockTheme": true
    },
    "tokens": {
      "colors": ["--wp--preset--color--base", "--wp--preset--color--accent"],
      "typography": ["--wp--preset--font-size--large", "--wp--preset--font-family--system"],
      "spacing": ["--wp--preset--spacing--40"],
      "customNamespaces": ["brand"]
    },
    "helpers": {
      "files": ["functions.php", "inc/helpers.php"],
      "notableFunctions": ["tt6_child_register_block_styles"]
    },
    "conventions": {
      "naming": { "dominantFileCase": "kebab-case", "phpFunctionPrefixes": ["tt6_child_"] },
      "directories": ["patterns", "templates", "template-parts"],
      "cssVarPrefixes": ["--wp--preset--", "--brand--"]
    }
  }
}
```

---

## 6) `audit_component`

- **description:** Use to check whether a WordPress component, block, pattern, template, or variant already exists and where it is used.
- **input schema:** (default path is a single natural-language query string)

```json
{
  "type": "object",
  "properties": {
    "query": { "type": ["string", "object"] },
    "componentQuerySpec": { "type": "object" },
    "component_query": { "type": "string", "minLength": 1 },
    "wpRoot": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "anyOf": [
    { "required": ["query"] },
    { "required": ["componentQuerySpec"] },
    { "required": ["component_query"] }
  ],
  "additionalProperties": false
}
```

- **simple invocation (recommended first):**

```json
{ "query": "compact testimonial section" }
```

- **advanced invocation (optional structured query):**

```json
{
  "query": {
    "name": "testimonial section",
    "variantHints": ["compact"],
    "typeHints": ["pattern"],
    "classNames": ["is-style-compact"]
  },
  "limit": 20
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["queryEcho", "verdict", "bestMatch", "variants", "usage", "candidates", "recommendation", "patchPlan"],
      "properties": {
        "queryEcho": { "type": "object" },
        "verdict": { "type": "string", "enum": ["exists", "partial", "missing"] },
        "bestMatch": { "type": ["object", "null"] },
        "variants": { "type": "object" },
        "usage": { "type": "object" },
        "candidates": { "type": "array", "items": { "type": "object" } },
        "recommendation": { "type": "object" },
        "patchPlan": { "type": "object" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Do we already have a compact testimonial section?`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "queryEcho": {
      "source": "query",
      "normalized": {
        "name": "compact testimonial section",
        "variantHints": ["compact"],
        "typeHints": ["pattern"],
        "blockNames": [],
        "classNames": [],
        "snippet": ""
      }
    },
    "verdict": "partial",
    "bestMatch": {
      "type": "pattern",
      "id": "theme/pattern-testimonials-grid",
      "path": "/var/www/html/wp-content/themes/tht/patterns/testimonials-grid.php",
      "enableSteps": ["Insert pattern `theme/pattern-testimonials-grid`."],
      "usage": [{ "kind": "page", "identifier": "42", "title": "About", "reason": "pattern ref" }]
    },
    "variants": {
      "existing": ["default"],
      "missing": ["compact"],
      "recommendedMechanism": {
        "id": "pattern_variants",
        "reason": "Pattern variants match current theme conventions."
      }
    },
    "usage": {
      "content": { "count": 2, "matches": [] },
      "patterns": { "count": 1, "matches": [] },
      "templates": { "count": 0, "matches": [] }
    },
    "candidates": [],
    "recommendation": {
      "action": "extend",
      "lowestRiskApproach": "pattern-variant",
      "why": "Strong nearby match exists and variant mechanism is already used."
    },
    "patchPlan": {
      "files": ["/var/www/html/wp-content/themes/tht/patterns/testimonials-grid-compact.php"],
      "checks": ["php -l changed PHP files"],
      "rollback": "git checkout -- <files>"
    }
  }
}
```

---

## 6) `where_is_used`

- **description:** Use to find direct usages of classes, blocks, shortcodes, functions, template fragments, or strings across indexed files and indexed DB content/meta/options/menus/custom tables.
- **input schema:**

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "kind": {
      "type": "string",
      "enum": ["class", "block", "shortcode", "function", "template", "pattern", "string", "auto"]
    },
    "scope": {
      "type": "object",
      "properties": {
        "files": { "type": "boolean" },
        "content": { "type": "boolean" },
        "postmeta": { "type": "boolean" },
        "options": { "type": "boolean" },
        "menus": { "type": "boolean" },
        "customTables": { "type": "boolean" }
      },
      "additionalProperties": false
    },
    "wpRoot": { "type": "string" },
    "limitPerGroup": { "type": "integer", "minimum": 1, "maximum": 50 }
  },
  "additionalProperties": false
}
```

- **example invocation:**

```json
{
  "query": ".footer-disclosure",
  "kind": "auto",
  "limitPerGroup": 10
}
```

- **stale index behavior:** Returns a clear `INDEX_NOT_READY` error and recommends running `build_wp_index`.

---

## 7) `find_similar_content`

- **note:** Use this for similarity by intent/structure. For direct usage questions ("where is this used?"), use `where_is_used`.
- **examples of direct usage queries:** `.footer-disclosure`, `mytheme/testimonial-card`, `[gravityform]`, `render_disclosure()`, `api-dev.example.com`
- **description:** Use to find similar content or markup usage across posts, pages, patterns, and templates.
- **input schema:** (default path is a single natural-language query string)

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "componentName": { "type": "string", "minLength": 1 },
    "className": { "type": "string", "minLength": 1 },
    "classNames": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "blockNames": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "snippet": { "type": "string", "minLength": 1 },
    "wpRoot": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "anyOf": [
    { "required": ["query"] },
    { "required": ["componentName"] },
    { "required": ["className"] },
    { "required": ["classNames"] },
    { "required": ["blockNames"] },
    { "required": ["snippet"] }
  ],
  "additionalProperties": false
}
```

- **simple invocation (recommended first):**

```json
{ "query": "footer disclosure" }
```

- **advanced invocation (optional additional hints):**

```json
{
  "query": "footer disclosure",
  "classNames": ["site-footer__disclosure", "has-small-print"],
  "blockNames": ["core/group", "core/paragraph"],
  "snippet": "<div class=\"site-footer__disclosure\">...</div>",
  "limit": 25
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["queryEcho", "matches"],
      "properties": {
        "queryEcho": { "type": "object" },
        "matches": {
          "type": "object",
          "required": ["content", "patterns", "templates", "files"],
          "properties": {
            "content": { "type": "array", "items": { "type": "object" } },
            "patterns": { "type": "array", "items": { "type": "object" } },
            "templates": { "type": "array", "items": { "type": "object" } },
            "files": { "type": "array", "items": { "type": "object" } }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Find components similar to a hero with two CTA buttons.`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "queryEcho": {
      "componentName": "hero with two cta buttons",
      "classNames": [],
      "blockNames": [],
      "snippetProvided": false,
      "blockFingerprintProvided": false
    },
    "matches": {
      "content": [
        {
          "id": "91",
          "postType": "page",
          "title": "Home",
          "slug": "home",
          "url": "https://example.local/home/",
          "confidence": 0.82,
          "reasons": ["name token overlap: hero", "name token overlap: cta"]
        }
      ],
      "patterns": [],
      "templates": [],
      "files": []
    }
  }
}
```

---

## 8) `apply_patch`

- **description:** Use to apply a validated unified diff patch in the WordPress root and run safety checks.
- **input schema:**

```json
{
  "type": "object",
  "required": ["patch"],
  "properties": {
    "patch": { "type": "string", "minLength": 1 },
    "wpRoot": { "type": "string" }
  },
  "additionalProperties": false
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["applied", "filesChanged", "checks"],
      "properties": {
        "applied": { "type": "boolean", "const": true },
        "filesChanged": { "type": "array", "items": { "type": "string" } },
        "checks": { "type": "array", "items": { "type": "object" } }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Apply this diff to add a compact button style variant and run safety checks.`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "applied": true,
    "filesChanged": ["style.css"],
    "checks": [{ "name": "php-lint", "ok": true }]
  }
}
```

---

## 9) `read_project_file`

- **description:** Use to read a project file in the WordPress root before editing or auditing.
- **input schema:**

```json
{
  "type": "object",
  "required": ["path"],
  "properties": {
    "path": { "type": "string", "minLength": 1 },
    "wpRoot": { "type": "string" },
    "maxBytes": { "type": "integer", "minimum": 1 }
  },
  "additionalProperties": false
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["path", "content", "truncated"],
      "properties": {
        "path": { "type": "string" },
        "content": { "type": "string" },
        "truncated": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Open wp-content/themes/tht/style.css so we can review existing styles first.`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "path": "/var/www/html/wp-content/themes/tht/style.css",
    "content": ".hero{display:grid;gap:var(--wp--preset--spacing--40);}\n",
    "truncated": false
  }
}
```

---

## 10) `search_project_files`

- **description:** Search project files for plain text or regex; optionally narrow with `path` or `scope` (alias), `glob`, and `limit`.
- **input schema:**

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "wpRoot": { "type": "string" },
    "path": { "type": "string" },
    "scope": { "type": "string" },
    "glob": { "type": "string" },
    "isRegex": { "type": "boolean" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
  },
  "additionalProperties": false
}
```

- **output schema:**

```json
{
  "type": "object",
  "required": ["ok", "data"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": {
      "type": "object",
      "required": ["queryEcho", "matches"],
      "properties": {
        "queryEcho": {
          "type": "object",
          "required": ["query", "isRegex"],
          "properties": {
            "query": { "type": "string" },
            "isRegex": { "type": "boolean" }
          },
          "additionalProperties": false
        },
        "matches": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["path", "line", "column", "preview"],
            "properties": {
              "path": { "type": "string" },
              "line": { "type": "integer" },
              "column": { "type": "integer" },
              "preview": { "type": "string" }
            },
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

- **example user prompt:**

`Find where is-style-compact appears in PHP files and show up to 20 matches.`

- **example output payload:**

```json
{
  "ok": true,
  "data": {
    "queryEcho": { "query": "is-style-compact", "isRegex": false },
    "matches": [
      {
        "path": "wp-content/themes/tht/patterns/testimonials-grid.php",
        "line": 27,
        "column": 16,
        "preview": "<div class=\"wp-block-group is-style-compact\">"
      }
    ]
  }
}
```

---

## Source of Truth in Code

These same contracts are exported from:

- `mcp-server/src/toolDefinitions.ts`

