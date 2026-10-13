# Cursor MCP configuration

Use this doc as the single reference for wiring **WP Agent MCP** in Cursor. Copy-paste JSON is also in [`cursor-mcp-manifest.json`](./cursor-mcp-manifest.json).

## Required setup

1. Clone this repo (for example `wp-agent-mcp` on your machine).
2. Build the server once:

```bash
cd /absolute/path/to/wp-agent-mcp/mcp-server
NODE_BIN="$(command -v node)"
"$NODE_BIN" -v   # must be v20+; v22 recommended (see mcp-server/.nvmrc)
"$NODE_BIN" "$(command -v npm)" install
"$NODE_BIN" "$(command -v npm)" run build
```

3. Resolve the **same** Node binary you will pin in MCP (copy the path):

```bash
command -v node
# example: /Users/you/.nvm/versions/node/v22.12.0/bin/node
```

4. Add an MCP server in Cursor **Settings → MCP** (or your workspace MCP config).
5. Set **`command`** to that absolute Node path — not bare `"node"` (see [Pin Node](#pin-node-better-sqlite3) below).
6. Set **`WP_ROOT`** to the absolute path of your WordPress root (Bedrock: the `web/` directory where `wp-config.php` lives).
7. Restart Cursor (or **Developer: Reload Window**).

## Pin Node (`better-sqlite3`)

This server uses **`better-sqlite3`**, a native addon. The addon must be built for the **exact** Node binary that starts MCP.

Cursor often resolves `"command": "node"` to a different Node than your terminal (nvm in shell vs Cursor-bundled Node, different major, etc.). That causes `NODE_MODULE_VERSION` / ABI errors even after a successful `npm install`.

**Always pin an absolute Node path in `command`:**

```bash
command -v node
```

Use that path in MCP config. Run `npm install` / `npm run build` with the **same** binary (see setup above).

If MCP still fails with an ABI message, the `wp-agent-mcp` bin prints the Node version it saw and suggests pinning `"command"` to that path. Full troubleshooting: [`teammate-quickstart.md` — `NODE_MODULE_VERSION` / `better-sqlite3`](./teammate-quickstart.md#node_module_version--better-sqlite3-abi-mismatch).

## Recommended manifest (local source)

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

Replace all three absolute paths (`command`, server `args[0]`, `WP_ROOT`). The MCP server key is `wp-agent` (tool namespace); the repo/package name is `wp-agent-mcp`.

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
      "command": "/absolute/path/to/node",
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

If you publish or vendor the package instead of pointing at a git clone, still **pin Node** — use the same absolute path for `command` and invoke `npx` from that Node install:

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

(`npx` is usually beside `node` in the same prefix, e.g. `.../bin/npx`.)

Alternative: `npm install -g wp-agent-mcp` with your pinned Node, then set `args` to the global `wp-agent-mcp` shim path and keep `command` as that Node.

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
