# Final Architecture (Maintainer Quick View)

This is the stable, tool-first architecture for the WP Agent MCP.
Use this doc as the single orientation point before changing wiring, contracts, or service boundaries.

## 1) Minimal Configuration

- Required: `WP_ROOT` (absolute WordPress root, also sandbox boundary)
- Optional: `WP_CLI` (defaults to `wp` on `PATH`), `PHP_BIN` (defaults to `php` on `PATH`)
- Principle: env vars are the canonical user-facing config surface; legacy JSON config is transitional only

## 2) Public MCP Tool Surface (Stable Contract)

Primary tools maintainers should preserve:

- `connect_wordpress`
- `build_wp_index`
- `get_index_status`
- `get_theme_profile`
- `audit_component`
- `find_similar_content`
- `apply_patch`
- `read_project_file` (planned)
- `search_project_files` (planned)

Internal-only primitives (not for normal planning): `wp_cli`, `db_query`.

## 3) Internal Services (Maintainability Boundary)

Keep business logic in `mcp-server/src/services/`; keep tool handlers thin.

- `configService`: validate/resolve `wpRoot` and sandbox checks
- `wordpressService`: connection workflow
- `indexService`: index build + status
- `auditService`: audit contract boundary
- `similarityService`: similarity contract boundary
- `patchService`: patch contract boundary

## 4) Runtime Shape (Diagram)

```text
User/Agent intent
   -> MCP tool registry (`mcp-server/src/tools/registry.ts`)
      -> Service layer (`mcp-server/src/services/*`)
         -> Internal adapters (WP-CLI, DB, index storage)
            -> WordPress project + `.cursor-wp-index/`

Legacy compatibility path (internal):
Express routes (`mcp-server/src/routes/project.ts`) -> reused logic (transitional)
```

## 5) Legacy Endpoint Status

- Status: **supported for compatibility, deprecated for planning**
- Expected use: transport/backward-compat only while service migration completes
- Rule: new behavior should land in services + MCP tools first; avoid expanding route-first logic
- Migration direction: move remaining route logic (`audit/similarity/patch/theme`) into service implementations incrementally

## 6) Maintainer Guardrails

- Keep the public tool set small and intent-driven
- Preserve deterministic JSON contracts (especially audit/search outputs and error envelope)
- Prefer service-level changes over tool-layer or route-layer branching
- Treat endpoints as internal transport, not the architecture center
