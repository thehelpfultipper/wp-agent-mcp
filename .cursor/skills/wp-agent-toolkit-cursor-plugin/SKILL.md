---
name: wp-agent-toolkit-cursor-plugin
description: Packages rules and skills into a Cursor plugin bundle and documents how to connect to the local MCP server and a WP root.
---

# Cursor Plugin Packaging (POC)

## When to use
Use when preparing the Cursor Marketplace plugin bundle and wiring it to the local MCP server.

## Required plugin contents
- .cursor/rules/*.mdc (project rules)
- .cursor/skills/* (skills listed in this repo)
- Documentation for local configuration:
  - choose WP root
  - verify wp-cli is available
  - run "build index"
  - run "audit component"

## UX guidelines
- Provide a "happy path" workflow:
  1) Connect local WP root
  2) Build index
  3) Audit existence/variants
  4) Find similar usage
  5) (Optional) apply patch

## Output requirement
Create a concise README section describing:
- native run vs docker run for MCP server
- troubleshooting steps (wp-cli missing, db access)
