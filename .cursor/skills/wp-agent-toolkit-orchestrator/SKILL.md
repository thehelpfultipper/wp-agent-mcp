---
name: wp-agent-toolkit-orchestrator
description: Orchestrates building WP Agent MCP end-to-end by invoking the bootstrap, MCP, Cursor plugin, helper plugin, and demo skills in the correct order.
---

# WP Agent MCP Orchestrator

## When to use
Use when the user asks to build, scaffold, or implement the WP Agent MCP plugin.

## Responsibilities
- Drive an end-to-end vertical slice: connect -> index -> audit -> similarity -> (optional) patch apply.
- Delegate to the specialized skills below instead of doing everything at once:
  - /wp-agent-toolkit-bootstrap
  - /wp-agent-toolkit-mcp-server
  - /wp-agent-toolkit-cursor-plugin
  - /wp-agent-toolkit-wp-helper-plugin
  - /wp-agent-toolkit-demo

## Execution plan (always follow in order)
1) Ensure `PROJECT_CONTEXT.md` exists and matches the POC spec.
2) Bootstrap repo structure (directories, placeholder manifests, configs).
3) Implement MCP server endpoints + indexer schema + contracts.
4) Implement Cursor plugin packaging (skills, rules, settings guidance).
5) Optional: generate WP helper plugin skeleton (runtime registry).
6) Write demo prompts + acceptance checklist + troubleshooting.
