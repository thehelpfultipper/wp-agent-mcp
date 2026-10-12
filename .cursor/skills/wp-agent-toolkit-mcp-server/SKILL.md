---
name: wp-agent-toolkit-mcp-server
description: Implements the local Node MCP server, indexing engine, and the generic component existence/variant auditor + similarity search tools.
---

# MCP Server + Indexer + Auditor (POC)

## When to use
Use when implementing or modifying the MCP server, indexing, auditing, similarity search, or patch workflow.

## Hard requirements (POC)
1) Public MCP tool set (names are for implementers and agent routing; **end users only use natural language**):
- connect_wordpress
- build_wp_index
- get_index_status
- audit_component
- find_similar_content
- where_is_used
- query_wp_db_readonly (single validated read-only `SELECT` via `wp db query`)
- get_theme_profile
- get_design_bridge_readiness
- bridge_design_to_implementation
- search_project_files
- read_project_file
- apply_patch

Internal / low-level primitives stay out of normal user prompts (e.g. unconstrained `wp db`); `query_wp_db_readonly` is the supported path for ad hoc read-only reporting.

2) Index:
- SQLite schema per rules file "Index & API Contracts"
- JSON debug exports for blocks/patterns/templates

3) Safety:
- allowlist wp-cli commands
- WP root path sandboxing
- patch-only writes; validate diff targets within WP root
- php lint checks on changed PHP files when applying patch

## Implementation approach
- Build index in layers:
  1) filesystem discovery (block.json, patterns, templates, css/js markers)
  2) content indexing via `wp db query` on wp_posts (post_content)
- Implement candidate ranking with a clear scoring breakdown:
  - name match
  - marker match
  - structural match (blockFingerprint)
  - usage weighting
  - variant mechanism proximity

## Output requirement
All tools return stable structured JSON with error codes on failure.
