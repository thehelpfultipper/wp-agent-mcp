# wp-agent-mcp

WordPress-focused MCP server for component discovery, similarity search, and safe patch workflows.

## What you need in this repo

For clone-and-run onboarding:

- `mcp-server/` (executable MCP package: source, bin entrypoint, build config, lockfile)
- `docs/teammate-quickstart.md` (first-time setup flow)
- `docs/mcp-cursor-config.md` and `docs/cursor-mcp-manifest.json` (Cursor MCP wiring)
- root `README.md` (install overview and smoke-test commands)

## Quick start (local source, recommended)

From this folder (Node **20+**; team default **22** — see `.nvmrc`):

```bash
npm install
npm run build
npm run verify:native
```

Then point Cursor to the local entrypoint (pin the same Node you used for `npm install`):

```json
{
  "mcpServers": {
    "wp-agent": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/wp-agent-mcp/mcp-server/bin/wp-agent-mcp.js"],
      "env": {
        "WP_ROOT": "/absolute/path/to/wordpress"
      }
    }
  }
}
```

Set `command` to `command -v node` — not bare `"node"` — so `better-sqlite3` matches the Node that runs MCP. See `../docs/mcp-cursor-config.md` and `../docs/teammate-quickstart.md`.

The `wp-agent-mcp` bin entrypoint starts the bundled server build from `dist/server.js`.

## Environment variables (`.env` and Cursor `env`)

This server loads environment variables with `dotenv`, so you can configure via:

- Cursor MCP manifest `env` (recommended for day-to-day use)
- local `mcp-server/.env` for terminal/dev workflows

Required:

- `WP_ROOT`: absolute path to WordPress root

Optional:

- `WP_CLI`: WP-CLI executable or absolute path (defaults to `wp`)
- `PHP_BIN`: PHP executable or absolute path (defaults to `php`)
- `MCP_PORT`: preferred port (defaults to `7337`; falls back automatically if not explicitly set)

Example `mcp-server/.env`:

```bash
WP_ROOT=/absolute/path/to/wordpress
WP_CLI=wp
PHP_BIN=php
MCP_PORT=7337
```

Notes:

- `.env` files are gitignored. Commit `.env.example` only.
- If you set variables in both `.env` and Cursor manifest `env`, the process environment value takes precedence.

## npm / git / tarball (optional)

If you install from a registry, git URL, or tarball instead of a local clone:

```json
{
  "mcpServers": {
    "wp-agent": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/npx", "-y", "<package-spec>"],
      "env": {
        "WP_ROOT": "/absolute/path/to/wordpress"
      }
    }
  }
}
```

If you hit `npm error 404 ... wp-agent-mcp`, the spec is not on the registry in use. Prefer the local-source config above, or fix registry auth and the package spec. See `../docs/mcp-cursor-config.md`.

## Startup behavior

Server startup is intentionally lightweight and deterministic:

- load environment config
- validate `WP_ROOT`
- initialize and register public tools
- start serving requests

Indexing is lazy by design. The server does **not** build a full index during bootstrap.

- use `build_wp_index` when you want to build or refresh the index
- if audit/search tools are called before a build, the server returns `INDEX_NOT_READY` with a clear `build_wp_index` next step
- if usage lookups appear stale or incomplete, run `build_wp_index` before re-running `where_is_used`

## Extended index coverage

The index build keeps the existing schema and extends content sources for higher discovery accuracy:

- `content` (posts/pages from `wp_posts.post_content`)
- `postmeta_index` (ACF/custom fields, including serialized values normalized to searchable text)
- `options_index` (`theme_mods_*`, `widget_*`, and large content-bearing options)
- `menus_index` (`nav_menu_item` records plus relevant menu-item metadata)
- `patterns` / `templates` (filesystem-driven)

`find_similar_content` can now surface matches from post meta, options, and menus in addition to posts/pages, patterns, and templates.

`where_is_used` is the focused direct-usage lookup tool for:
- `.footer-disclosure` class lookups
- block names like `mytheme/testimonial-card`
- shortcodes like `[gravityform]`
- function calls like `render_disclosure()`
- exact strings across indexed content/meta/options/menus/files

Use `audit_component` for reuse/extend/create decisions and `find_similar_content` for intent-based similarity, not exact usage lookup.

## Related docs

- `../docs/teammate-quickstart.md` (onboarding walkthrough)
- `../docs/mcp-cursor-config.md` (canonical MCP config reference)
- `../docs/cursor-mcp-manifest.json` (copy-paste manifest)
- `../docs/handoff-checklist.md` (smoke-test checklist)
