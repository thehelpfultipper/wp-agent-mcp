---
name: wp-agent-toolkit-bootstrap
description: Creates the repository layout and baseline docs for WP Agent MCP (Cursor plugin + Node MCP server + optional WP helper plugin).
---

# Bootstrap WP Agent MCP Repo

## When to use
Use when starting the project or when the repo needs the correct structure to proceed.

## Create/verify directories
- mcp-server/
- cursor-plugin/ (or plugin root if you package everything at repo root)
- wp-helper-plugin/ (optional)
- .cursor/rules/
- .cursor/skills/
- .cursor-wp-index/ (gitignored)

## Create/verify baseline files
- PROJECT_CONTEXT.md
- README.md (install + local run instructions)
- .gitignore (include `.cursor-wp-index/`, node_modules, vendor, dist)

## Output requirement
After bootstrapping, print the intended next skill to run:
- "Next: run /wp-agent-toolkit-mcp-server"
