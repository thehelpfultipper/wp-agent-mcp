# WP Agent MCP (Cursor Plugin) — Project Context

## What we’re building
A Cursor Marketplace plugin + local MCP server that connects to a local WordPress project and enables agents to:
- Audit whether any requested component/block/pattern/template already exists and whether a requested variant exists.
- Find similar UI/content usage across posts/pages/CPTs/patterns/templates without manual admin browsing.
- Detect and respect the active theme’s design system (theme.json tokens, CSS variables, helper functions, naming conventions).
- Propose minimal, safe changes (prefer reuse/extend before create-new) and apply changes as patch-only diffs.

## Core capability: Component Existence & Variant Auditor (generic)
Given a user request like “Do we have a compact testimonial section?”, the system returns:
- verdict: exists | partial | missing
- bestMatch: canonical definition location + enable steps
- variants: what exists + what’s missing + recommended mechanism
- usage: where it’s used in content/templates/patterns
- candidates: ranked alternatives with reasoning
- recommendation: reuse/extend/create with lowest-risk approach
- patchPlan: files to change + checks + rollback

## Local-first assumptions
- We run against a local WP project root with wp-cli available.
- DB queries should prefer `wp db query` for portability.
- Index stored at: `.cursor-wp-index/` (SQLite + JSON exports).

## Deliverables (POC)
1) MCP server (Node) with public tools:
- connect_wordpress
- build_wp_index
- audit_component
- find_similar_content
- get_theme_profile
- search_project_files
- read_project_file
- apply_patch

Internal implementation tools may still exist for low-level operations (`wp_cli`, `db_query`) but are not part of normal user prompting.

2) Cursor plugin that packages:
- skills + rules + optional helper plugin scaffolding
- UX: “Connect to local WP root”, “Build index”, “Run audit”, “Find similar”, “Apply patch”

3) Optional WP helper plugin:
- runtime block registry introspection
- theme supports / resolved theme.json where practical

## Safety rules
- Patch-only writes; always show diff.
- php syntax check for changed PHP files.
- Never modify wp-config.php unless explicitly requested.
- Whitelist wp-cli commands; never arbitrary shell commands.

## Preferred approach order
Reuse > Extend > Create
- Pattern/style/variation/template-part before new block code.