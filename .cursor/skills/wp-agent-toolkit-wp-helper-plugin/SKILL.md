---
name: wp-agent-toolkit-wp-helper-plugin
description: Generates an optional local WP helper plugin to expose runtime introspection (registered blocks, variations, styles, and theme supports) to the MCP server.
---

# WP Helper Plugin (Optional)

## When to use
Use when filesystem + wp-cli is not enough and we need runtime truth:
- registered blocks/variations/styles
- theme supports and runtime-resolved settings

## Requirements (POC)
- Keep it optional and safe for local dev only.
- Provide endpoints or wp-cli callable hooks that return:
  - list of registered blocks and metadata
  - list of block styles and variations
  - basic theme supports and template info

## Output requirement
Document how to install/activate locally and how MCP server detects it.
