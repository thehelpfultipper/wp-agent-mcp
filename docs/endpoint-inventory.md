# Internal Transport Inventory (Tool-First Reference)

This file tracks internal transport wiring behind the MCP tool surface.
Normal usage should be described with natural-language prompts and MCP tool intent, not endpoint mechanics.

## Public MCP tools and internal transport mapping

| user intent | public MCP tool | internal transport status |
|---|---|---|
| Connect to a local WordPress project | `connect_wordpress` | Implemented |
| Build or refresh the local index | `build_wp_index` | Implemented |
| Check index readiness and counts | `get_index_status` | Implemented |
| Update/sync local WordPress DB from a local SQL dump (DB-only; uploads/files/media sync is separate) | `sync_local_db_from_dump` | Implemented |
| Audit whether a component/variant already exists | `audit_component` | Implemented |
| Find similar components/usages | `find_similar_content` | Implemented |
| Direct usage / fragment lookup | `where_is_used` | Implemented |
| Read-only SQL reporting (`SELECT` only) | `query_wp_db_readonly` | Implemented |
| Summarize active theme design-system context | `get_theme_profile` | Implemented |
| Check Figma/screenshot → implementation readiness | `get_design_bridge_readiness` | Implemented |
| Reconcile design intent with theme conventions | `bridge_design_to_implementation` | Implemented |
| Apply a validated patch safely | `apply_patch` | Implemented |
| Read a project file safely | `read_project_file` | Implemented |
| Search project files safely | `search_project_files` | Implemented |

## Internal-only capabilities

These are implementation primitives and not part of normal user prompting:

- `wp_cli`
- `db_query`
- `health`/liveness checks

## Error envelope

Implemented tools follow a stable error shape:

`{ ok: false, error: { code, message, details? } }`

Common `code` values include `WP_ROOT_INVALID`, `INVALID_AUDIT_QUERY`, `INVALID_READONLY_SQL`, `INVALID_PATCH_FORMAT`, and `INTERNAL_ERROR`.
