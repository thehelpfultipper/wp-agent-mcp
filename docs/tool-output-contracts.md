# Tool Output Contracts

This document defines model-friendly output contracts for public tools.
The goal is concise, stable, task-useful payloads without transport noise.
Public usage should occur via MCP tools; endpoint payloads are internal implementation details.

## Shared Response Shape

All successful tool calls return:

```json
{
  "ok": true,
  "data": {}
}
```

All failures return:

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

`error.details` is optional and only included when useful structured context exists.

## `connect_wordpress`

Returns a compact health/config summary.

```json
{
  "ok": true,
  "data": {
    "health": {
      "status": "ok",
      "wordpressVersion": "6.8.1",
      "phpVersion": "8.3.8",
      "isMultisite": false
    },
    "config": {
      "wpRoot": "/var/www/html",
      "wpCliPath": "/usr/local/bin/wp"
    }
  }
}
```

## `audit_component`

Returns only decision-ready audit output fields:
- `verdict`
- `bestMatch`
- `variants`
- `usage`
- `recommendation`

```json
{
  "ok": true,
  "data": {
    "verdict": "partial",
    "bestMatch": {
      "type": "pattern",
      "id": "theme/pattern-testimonials-grid",
      "path": "/var/www/html/wp-content/themes/tht/patterns/testimonials-grid.php",
      "enableSteps": ["Insert pattern `theme/pattern-testimonials-grid`."],
      "usageCount": 1,
      "reasons": [
        "name token match: testimonials",
        "variant hint: compact",
        "in-use evidence: 1 matches"
      ]
    },
    "variants": {
      "existing": ["default"],
      "missing": ["compact"],
      "recommendedMechanism": {
        "id": "pattern_variants",
        "reason": "Pattern variants are already used for neighboring component variants."
      }
    },
    "usage": {
      "content": { "count": 2, "matches": [] },
      "patterns": { "count": 1, "matches": [] },
      "templates": { "count": 0, "matches": [] }
    },
    "recommendation": {
      "action": "extend",
      "approach": "pattern",
      "rationale": "Strong nearby match exists and the project already uses pattern variants."
    }
  }
}
```

Internal candidate lists, query normalization traces, and patch skeleton details are kept internal and not exposed in the public tool payload.

## `find_similar_content`

Returns grouped matches by content surface.
Each match includes machine-usable confidence plus explicit reasons.

```json
{
  "ok": true,
  "data": {
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

Use `find_similar_content` for similarity-by-intent. For direct usage lookups, use `where_is_used`.

## `where_is_used`

Returns grouped direct-usage matches with source-aware ranking and snippets.

```json
{
  "ok": true,
  "data": {
    "query": ".footer-disclosure",
    "detectedKind": "class",
    "summary": {
      "totalMatches": 7,
      "groupsWithMatches": ["templates", "files", "content", "postmeta"]
    },
    "groups": {
      "templates": [],
      "patterns": [],
      "files": [],
      "content": [],
      "menus": [],
      "postmeta": [],
      "options": [],
      "customTables": []
    },
    "recommendation": "Primary usage appears in top template matches; validate those before editing lower-signal settings/meta entries."
  }
}
```

## `sync_local_db_from_dump`

Returns deterministic DB import state with backup path, detected site mode, and structured replacement actions.
This tool is DB-only and does not perform uploads/files/media sync.

```json
{
  "success": true,
  "backupPath": "/var/www/html/.wp-agent-db-backup-20260424-180102Z.sql",
  "importedDumpPath": "/Users/me/Downloads/live-db.sql.gz",
  "detectedSiteType": "single-site",
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
        { "from": "api.example.com", "to": "api-dev.example.com" }
      ]
    }
  ],
  "warnings": [],
  "preflight": {
    "checks": [
      { "id": "dump_path", "ok": true, "message": "..." },
      { "id": "local_url", "ok": true, "message": "..." },
      { "id": "mysql_clients", "ok": true, "message": "..." },
      { "id": "db_reachable", "ok": true, "message": "`wp db check` succeeded." }
    ]
  },
  "verification": {
    "importMethod": "wp_db_import",
    "wpDbCheckOk": true,
    "homeOptionMatchesLocal": true,
    "siteurlOptionMatchesLocal": true,
    "multisiteCoreDomainTablesAligned": false,
    "dryRunReplacementsRemaining": 0,
    "cacheFlushOk": true,
    "finalAssertionsPassed": true
  }
}
```

Notes:
- `backupPath` is the local pre-import backup location under the WordPress root.
- If `success` is `false` and `backupPath` is present, warnings include a manual restore hint.
- `primaryReplacementApplied` captures the main live-domain-to-local rewrite.
- `additionalReplacementsApplied` captures optional `replacementMappings` in deterministic input order.
- Additional replacement mappings must provide non-empty, different `from` and `to` values.
- If auto-detection cannot safely determine `localUrl` or `liveDomain`, the tool fails with a clear message requesting explicit input.
- Multisite override mismatches are treated as deterministic validation failures (no ambiguous mode switching).
- If a request attempts to combine DB sync with file/media/uploads sync, the tool fails with guidance to use a separate file-sync capability.
- If replacement fails after import succeeds, failure output still includes `backupPath` for rollback.
- If MySQL client programs are missing from the MCP process PATH, preflight fails with `SYNC_PREFLIGHT_FAILED` and a `mysql_clients` check (or auto-discovery warning on success when PATH was augmented).
- If the DB cannot be reached (including sandbox blocks on `127.0.0.1`), preflight fails with `db_reachable` check and remediation; sandbox-like failures return **`DB_SYNC_REQUIRES_ELEVATED_CONTEXT`** before any backup/import, with **`outsideSandboxRemediation`** (`assistantMessage`, Terminal commands, IDE steps) so the agent can guide the user outside the sandbox—no partial import.
- On success, `preflight.checks` lists passed gates; `verification` reports `importMethod` (`wp_db_import` vs `wp_db_cli_stdin`), option alignment, multisite core table alignment when applicable, summed dry-run replacement counts (canonical + mapping pairs), `finalAssertionsPassed`, and cache flush status.
- If both import strategies fail, `IMPORT_METHOD_FAILED` includes primary and fallback stderr/status in `errorDetails`.

Failure shape from this tool is also deterministic in-band:

```json
{
  "success": false,
  "backupPath": "/var/www/html/.wp-agent-db-backup-20260424-180102Z.sql",
  "importedDumpPath": "/Users/me/Downloads/live-db.sql.gz",
  "detectedSiteType": "multisite",
  "detectedLocalUrl": "https://example.local",
  "primaryReplacementApplied": null,
  "additionalReplacementsApplied": [],
  "warnings": [],
  "errorCode": "DB_IMPORT_FAILED",
  "errorMessage": "Failed to import the provided SQL dump."
}
```

## `get_design_bridge_readiness`

Returns WordPress-side readiness plus companion MCP guidance:

- `wpRoot`, `index`, `theme`
- `companionMcps.figma` / `companionMcps.playwright` (WP Agent cannot detect them; includes setup hints)
- `readyForBridge`, `blockers[]`, optional `assistantMessage`

## `bridge_design_to_implementation`

Accepts **`visualIntent`** or **`figmaCapture`**, plus optional **`componentHint`** (agent-populated natural-language excerpt from the user, including optional theme mentions). Optional internal fields: `siteUrl`, `themeSlug` (agent override only).

Returns an `implementationSpec` object:

- `queryEcho`, `interpretedIntent`, `themeContext`
- `tokenReconciliation` (mapped preset CSS vars, optional `scssSuggestion` on spacing entries, plus `unresolved`)
- `componentPlan` (embedded audit with weighted block/component label matching + suggested structure)
- `implementationGuidance` (`useTokens`, `avoidRawValues`, conventions)
- `verificationChecks`
- Optional `requiresThemeSelection` + `themeCandidates` (ask user in natural language; do not prompt for themeSlug)

Theme resolution modes in `queryEcho.themeResolution`:

- `text_match` — inferred from natural-language corpus
- `best_match` — token/color ranking
- `active_site` — unambiguous active/default theme
- `pending_selection` — multiple viable themes; no reconciliation until user chooses

Errors:

- `BRIDGE_INTENT_TOO_RAW` when visual intent contains only raw Figma measurements
- `TOOL_INPUT_INVALID` when both `visualIntent` and `figmaCapture` are missing, or `figmaCapture` cannot be mapped
- `INDEX_NOT_READY` when index has not been built

## Notes

- Internal debugging context is still computed and can be logged internally.
- Public outputs intentionally avoid endpoint implementation details.
- Output contracts are mirrored in `mcp-server/src/toolDefinitions.ts`.
