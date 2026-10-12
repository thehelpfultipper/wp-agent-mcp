# Cursor MCP configuration

Use this doc as the single reference for wiring **WP Agent MCP** in Cursor. Copy-paste JSON is also in [`cursor-mcp-manifest.json`](./cursor-mcp-manifest.json).

## Required setup

1. Clone this repo (for example `wp-agent-mcp` on your machine).
2. Build the server once:

```bash
cd /absolute/path/to/wp-agent-mcp/mcp-server
npm install
npm run build
```

3. Add an MCP server in Cursor **Settings → MCP** (or your workspace MCP config).
4. Set **`WP_ROOT`** to the absolute path of your WordPress root (Bedrock: the `web/` directory where `wp-config.php` lives).
5. Restart Cursor (or **Developer: Reload Window**).

## Recommended manifest (local source)

```json
{
  "mcpServers": {
    "wp-agent": {
      "command": "node",
      "args": ["/absolute/path/to/wp-agent-mcp/mcp-server/bin/wp-agent-mcp.js"],
      "env": {
        "WP_ROOT": "/absolute/path/to/wordpress"
      }
    }
  }
}
```

Replace both absolute paths. The MCP server key is `wp-agent` (tool namespace); the repo/package name is `wp-agent-mcp`.

## Optional environment variables

Add to the same `env` block when needed:

| Variable | Purpose |
|----------|---------|
| `WP_CLI` | Path to `wp` if not on PATH for the MCP process |
| `PHP_BIN` | Path to `php` if not on PATH |
| `WP_AGENT_EXTRA_PATH` | Directory containing `mysql`, `mysqldump`, `mysqlcheck` (DB sync) |
| `WP_AGENT_ALLOWED_DUMP_ROOTS` | Extra allowed roots for SQL dump paths (path-separated) |
| `WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS=0` | Skip multisite domain column bulk alignment |

Example with explicit binaries:

```json
{
  "mcpServers": {
    "wp-agent": {
      "command": "node",
      "args": ["/absolute/path/to/wp-agent-mcp/mcp-server/bin/wp-agent-mcp.js"],
      "env": {
        "WP_ROOT": "/absolute/path/to/wordpress",
        "WP_CLI": "/absolute/path/to/wp",
        "PHP_BIN": "/absolute/path/to/php"
      }
    }
  }
}
```

## WSL (Linux paths inside WSL)

See [`cursor-mcp-manifest-wsl.json`](./cursor-mcp-manifest-wsl.json). Use Linux paths (`/home/...`), not Windows `C:\...` paths, when Cursor runs the server in WSL.

## Install via npm, git, or tarball (optional)

If you publish or vendor the package instead of pointing at a git clone:

```json
{
  "mcpServers": {
    "wp-agent": {
      "command": "npx",
      "args": ["-y", "<package-spec>"],
      "env": {
        "WP_ROOT": "/absolute/path/to/wordpress"
      }
    }
  }
}
```

Examples for `<package-spec>`:

- `wp-agent-mcp@latest` (public npm, when published)
- `@your-scope/wp-agent-mcp@latest` (private registry)
- `git+https://github.com/your-org/wp-agent-mcp.git#main`
- `/absolute/path/to/wp-agent-mcp/mcp-server` (local package directory)
- `https://artifacts.example.com/wp-agent-mcp-1.0.0.tgz`

If you see `npm error 404 ... wp-agent-mcp`, Cursor is resolving a spec that is not on the registry you use. Prefer the **local source** manifest above, or fix registry auth and the package spec.

## Optional companion MCP servers

Not required for WP Agent MCP to run:

- **Figma MCP** — Figma URL capture for the design bridge (screenshot-only flows work without it).
- **Playwright MCP** — optional automated verification after implementation.

## Verify

After reload, ask in chat: `What MCP tools do you have from wp-agent?`

Full first-run flow: [`teammate-quickstart.md`](./teammate-quickstart.md).
