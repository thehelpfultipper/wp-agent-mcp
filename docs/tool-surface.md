# MCP Tool Surface (Public-First)

This document defines the user-facing MCP tool surface that replaces endpoint-first workflows.
It keeps the public API small, intent-driven, and stable while allowing lower-level implementation details to evolve.

## Design Principles

- Public tools should map to natural user goals (connect, index, inspect, audit, search, patch, read, search files).
- Public tools should hide transport details (HTTP routes, payload envelopes, probing mechanics).
- Internal primitives should remain available for implementation fallback, not normal model planning.
- Prefer deterministic, contract-stable responses over exposing execution internals.
- Raw endpoint usage is deprecated for public workflows and should be treated as internal/transitional transport.

## Public Tool List

### 1) `connect_wordpress`

- **One-line purpose:** Validate and connect to a WordPress root so all other tools have a known project context.
- **When the model should use it:** First use in a new session, after project path changes, or when connection/permission checks fail.
- **Visibility:** User-facing.

### 2) `build_wp_index`

- **One-line purpose:** Build or refresh the local WordPress component/content index used by audit and similarity tools.
- **When the model should use it:** Before first audit/search in a project, after major content/theme changes, or when index is stale/missing.
- **Visibility:** User-facing.

### 3) `get_index_status`

- **One-line purpose:** Report index readiness, schema version, last build time, and record counts.
- **When the model should use it:** Before expensive analysis, to decide whether rebuild is needed, or to explain index health to the user.
- **Visibility:** User-facing.

### 4) `get_theme_profile`

- **One-line purpose:** Return active theme design-system context (tokens, helpers, conventions) for alignment decisions.
- **When the model should use it:** Before proposing component changes, style variants, or any patch touching presentation/markup conventions.
- **Visibility:** User-facing.

### 5) `sync_local_db_from_dump`

- **One-line purpose:** Import a user-provided SQL dump into the local WordPress database with backup-first safety and deterministic replacement handling.
- **When the model should use it:** When the user asks to update local db, sync local db from a dump, import a SQL dump into local WordPress, refresh local db and replace URLs, or import a dump and update API URL/token replacement mappings.
- **Scope guardrail:** This tool is strictly database-only. It never downloads, restores, or syncs files/media/uploads. If a request combines DB sync and file sync, run only the DB sync path and explicitly guide file sync to a separate future tool.
- **Visibility:** User-facing.

### 6) `audit_component`

- **One-line purpose:** Determine whether a requested component already exists, partially exists, or is missing, with reuse/extend/create guidance.
- **When the model should use it:** Whenever the user asks "do we already have X?", requests a new component variant, or needs implementation recommendation.
- **Visibility:** User-facing.

### 6) `where_is_used`

- **One-line purpose:** Find where a class, block, shortcode, function, template fragment, or string is directly used across indexed files and indexed DB surfaces.
- **When the model should use it:** When the user asks “where is this used?”, “find usages”, “which pages use this class/block/pattern”, or “where does this shortcode/function appear?”.
- **Visibility:** User-facing.

### 7) `find_similar_content`

- **One-line purpose:** Find semantically/structurally similar usage across content, patterns, templates, and indexed project artifacts.
- **When the model should use it:** When the user asks for related examples, precedents, near matches, or migration candidates.
- **Visibility:** User-facing.

### 8) `query_wp_db_readonly`

- **One-line purpose:** Run one allowlisted read-only `SELECT` against the live WordPress database via `wp db query` for reporting (slugs, statuses, joins) without extending the SQLite index.
- **When the model should use it:** When the user needs SQL-shaped answers the index does not store (for example published page slugs with specific meta or plugin table joins).
- **Visibility:** User-facing.

### 9) `apply_patch`

- **One-line purpose:** Apply a validated patch safely within WordPress project boundaries with checks/rollback behavior.
- **When the model should use it:** Only after generating and showing a concrete patch plan and when user intent is to make actual file changes.
- **Visibility:** User-facing.

### 10) `read_project_file`

- **One-line purpose:** Read a project file safely within configured scope for grounded reasoning and patch generation.
- **When the model should use it:** To inspect existing implementation details before recommending or generating changes.
- **Visibility:** User-facing.

### 11) `search_project_files`

- **One-line purpose:** Search project files for symbols, classes, blocks, selectors, or markers related to the user request.
- **When the model should use it:** Early discovery, impact analysis, and candidate gathering before audits or edits.
- **Visibility:** User-facing.

### 12) `get_design_bridge_readiness`

- **One-line purpose:** Check WordPress-side readiness for the design bridge and return companion MCP setup guidance (Figma, Playwright).
- **When the model should use it:** At the start of any Figma/screenshot implementation flow, before design capture.
- **Visibility:** User-facing.

### 13) `bridge_design_to_implementation`

- **One-line purpose:** Reconcile interpreted visual intent with theme tokens, conventions, and existing components; return an implementation spec (not code).
- **When the model should use it:** After semantic visual intent is prepared from Figma or a screenshot; pass `componentHint` with the user's natural-language request (optional theme mention). Prefer this single call over separate theme profile + audit orchestration.
- **Visibility:** User-facing.

## Internal-Only Tools

These are implementation primitives and should not be part of the normal user-facing planning surface.

### `wp_cli` (internal-only)

- **Status:** Internal-only.
- **Reason:** This is a low-level execution primitive used by higher-level tools (connect/index/profile) and should remain hidden unless a diagnostic escape hatch is absolutely required.

### `db_query` (internal-only)

- **Status:** Internal-only.
- **Reason:** Unrestricted query execution is risky. Public workflows should use `query_wp_db_readonly` for allowlisted `SELECT` reporting, or indexed/audit tools for component discovery.

## Rationale for a Small Surface

- A compact set reduces model/tool selection errors.
- Tool names map directly to user intent, not endpoint mechanics.
- High-level tools preserve flexibility to change internals without breaking assistant behavior.
- Internal-only primitives remain available for controlled fallback, not default orchestration.
