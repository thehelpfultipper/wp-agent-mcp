# Services Architecture (Transport Split)

This server now has an explicit service boundary between MCP tool wiring and implementation logic.

## Layers

- **Tool layer (primary/public)**: public MCP tool registry/dispatch in `mcp-server/src/tools/`.
- **Transport layer (secondary/internal)**: Express routes in `mcp-server/src/routes/project.ts`.
- **Service layer**: business interfaces in `mcp-server/src/services/`.

## Service Modules

- `configService`: resolves and validates `wpRoot` against sandbox constraints.
- `wordpressService`: WordPress connection workflow (`connect_wordpress`).
- `indexService`: index status/build workflow (`get_index_status`, `build_wp_index`).
- `auditService`: audit contract boundary for `audit_component` (transition stub).
- `similarityService`: similarity contract boundary for `find_similar_content` (transition stub).
- `patchService`: patch apply contract boundary for `apply_patch` (transition stub).

## Tool Wiring

Public tools currently registered in `mcp-server/src/tools/registry.ts` call service methods:

- `connect_wordpress` -> `services.wordpress.connectWordpress()`
- `build_wp_index` -> `services.index.buildIndex()`
- `get_index_status` -> `services.index.getIndexStatus()`

This keeps tool adapters focused on input mapping and leaves business behavior in services.

## Transitional State

To avoid rewriting the route implementation in one pass, `audit/similarity/patch/theme` services are defined with explicit not-yet-migrated stubs. Their HTTP endpoints continue to use existing route logic, and those endpoints can be moved to the service implementations incrementally in follow-up changes.

These endpoint handlers are transport internals retained for compatibility. Assistant planning and user-facing flows should use MCP tools, not direct endpoint calls.

