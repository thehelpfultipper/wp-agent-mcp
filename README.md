# WP Agent MCP

WordPress-focused MCP server for component discovery, similarity search, and safe patch workflows.

Clone or unpack this repo as `wp-agent-mcp` and point Cursor MCP at `mcp-server/bin/wp-agent-mcp.js` inside that directory.

## Install in Cursor

See **[`docs/mcp-cursor-config.md`](docs/mcp-cursor-config.md)** for the full guide (env vars, WSL, optional `npx` install).

Copy-paste manifest: [`docs/cursor-mcp-manifest.json`](docs/cursor-mcp-manifest.json)

Recommended manifest (pin Node — required for `better-sqlite3`):

```json
{
  "mcpServers": {
    "wp-agent": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/wp-agent-mcp/mcp-server/bin/wp-agent-mcp.js"],
      "env": {
        "WP_ROOT": "/path/to/wordpress"
      }
    }
  }
}
```

Edit three paths:

- **`command`**: output of `command -v node` from the Node you use for `npm install` in `mcp-server/` (do not use bare `"node"` — Cursor may pick a different binary).
- **`args[0]`**: absolute path to `mcp-server/bin/wp-agent-mcp.js` in your clone.
- **`WP_ROOT`**: absolute path to your WordPress root.

Run `npm install` and `npm run build` in `mcp-server/` with that same Node before starting MCP.

ABI troubleshooting: [`docs/teammate-quickstart.md`](docs/teammate-quickstart.md#node_module_version--better-sqlite3-abi-mismatch).

Optional advanced manifest (explicit `wp` / `php` paths). Add these when `wp --info` works in Terminal but Cursor reports `Connection closed` or the server stays on `initializing`. Cursor launched from the Dock or Finder uses a short process `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), so Homebrew and nvm binaries are invisible at startup. Homebrew `wp` is a `#!/usr/bin/env php` script, so `WP_CLI` alone still fails until the directory that contains `php` is on `PATH`. `WP_AGENT_EXTRA_PATH` only helps MySQL client tools during DB sync; it does not satisfy this startup check.

```json
{
  "mcpServers": {
    "wp-agent": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/wp-agent-mcp/mcp-server/bin/wp-agent-mcp.js"],
      "env": {
        "WP_ROOT": "/path/to/wordpress",
        "WP_CLI": "/absolute/path/to/wp",
        "PHP_BIN": "/absolute/path/to/php",
        "PATH": "/absolute/path/to/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      }
    }
  }
}
```

Resolve the paths in Terminal with `command -v wp` and `command -v php`. The `PATH` prefix is that `bin` directory (Apple Silicon Homebrew is often `/opt/homebrew/bin`; a custom prefix such as `~/homebrew/bin` uses that directory instead).

After saving config, restart Cursor and ask: `What MCP tools do you have from wp-agent?`

## Other install options

- **Local clone (recommended):** pinned absolute Node in `command` + path to `mcp-server/bin/wp-agent-mcp.js` (shown above). Run `npm install` and `npm run build` in `mcp-server` with that same Node.
- **npm / git / tarball:** use `npx` with a package spec (public `wp-agent-mcp@latest` when published, or your own registry/git URL). Details in [`docs/mcp-cursor-config.md`](docs/mcp-cursor-config.md).

If you see `npm error 404 ... wp-agent-mcp`, the spec is not on the registry Cursor is using—use the local source manifest or configure the correct registry.

## Local Development (Repo)

Use this when developing the server or validating changes locally:

```bash
cd mcp-server
npm install
npm run dev
```

## Smoke Test Public Tools

Full validation flow (recommended before sharing the repo or cutting a release):

```bash
WP_ROOT=/absolute/path/to/wordpress ./scripts/smoke-test-handoff.sh
```

See `docs/handoff-checklist.md` for the full handoff checklist.

Run one command from the repo root to verify the core public MCP tools end-to-end:

```bash
WP_ROOT=/absolute/path/to/wordpress ./scripts/smoke-test-tools.sh
```

You can also pass `WP_ROOT` as the first argument:

```bash
./scripts/smoke-test-tools.sh /absolute/path/to/wordpress
```

Run focused local DB sync harness coverage (no live WordPress required):

```bash
./scripts/smoke-test-local-db-sync.sh
```

Local DB sync harness coverage includes:
- DB-only import path
- Import with additional replacement mappings (for example API URL + token)
- Multisite-aware replacement/update path
- Rejection of mixed DB+file-sync request shapes
- Failure after backup when import/replacement does not complete

What this smoke test does:
- boots a local MCP server if one is not already running on `MCP_PORT` (default `7337`)
- exercises the public MCP tool surface end-to-end
- validates required output keys for:
  - `connect_wordpress`
  - `build_wp_index`
  - `get_index_status`
  - `sync_local_db_from_dump`
  - `get_theme_profile`
  - `audit_component`
  - `find_similar_content`
  - `where_is_used`
  - `query_wp_db_readonly`

If startup fails, inspect `.smoke-test-tools-server.log` in the repo root.

## Sync Local DB From Dump

Use the public MCP tool `sync_local_db_from_dump` when you already downloaded a live SQL dump locally and want to safely import it into your local WordPress database.

This tool is intentionally DB-only. It does not download, copy, restore, or sync uploads/media/files.
If a prompt combines DB sync with uploads/media/file sync, split the request: run DB sync first; file sync is a separate workflow.

- Required input: `dumpPath` (supports `.sql` and `.sql.gz`).
- Optional input: `liveDomain`, `localUrl`, `replacementMappings[]`, `multisiteMode` (`auto`, `single-site`, `multisite`, boolean override), `wpRoot`.
- If `localUrl` is omitted, the tool attempts to detect it from local WordPress options (`home`, `siteurl`) before import.
- If `liveDomain` is omitted, the tool attempts a safe inference from imported DB options; if that cannot be done deterministically, it returns a clear message asking for `liveDomain`.
- `replacementMappings` allows deterministic additional replacements after the primary domain rewrite (for example API hosts, tokens, or other environment-specific values). Each mapping must include non-empty, different `from` and `to` values.
- Safety: always exports a pre-import backup to your WordPress project root (example: `.wp-agent-db-backup-<timestamp>.sql`) before destructive steps.
- **Preflight** runs before backup: dump path, `localUrl`, MySQL clients, then `wp db check` (surfaces sandbox / localhost DB reachability in `SYNC_PREFLIGHT_FAILED` + `preflight.checks`).
- WP-CLI `db export` / `db import` require MySQL client programs (`mysql`, `mysqldump`, `mysqlcheck`) on PATH for the MCP process, or under directories listed in `WP_AGENT_EXTRA_PATH` (prepended to PATH). The server also tries common install locations on macOS and Windows when PATH is minimal; if it finds them, the response includes a warning with the directory to add to `WP_AGENT_EXTRA_PATH` for persistence.
- Import uses `wp db import` first; if that fails with SOURCE/SQL-style errors, the server **streams the same SQL file into `wp db cli`** (same idea as `wp db cli < dump.sql`). Success responses include `verification.importMethod`.
- Multisite: optional bulk alignment of `{prefix}site` / `{prefix}blogs` domain columns (set `WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS=0` to skip for subdomain-style networks). Post-sync **verification** reports dry-run replacement totals, home/siteurl match, and cache flush.
- Dump path safety: dump files must live under allowed local roots (`WP_ROOT`, current working dir, home dir, or extra roots in `WP_AGENT_ALLOWED_DUMP_ROOTS`).
- If import/rewrite fails, the tool returns `success: false` with `errorCode` / `errorMessage`, keeps the backup file on disk, and includes a restore hint in warnings.
- If replacement fails after import succeeds, the response still includes `backupPath` so rollback remains deterministic.
- Multisite: runs network-aware search-replace and site/network domain updates when multisite is detected (or forced by override).
- Multisite mismatch safety: if `multisiteMode` override conflicts with auto-detected WordPress mode, the tool fails fast with a clear conflict message.
- Cross-platform notes:
  - macOS: dump paths like `/Users/<you>/Downloads/live.sql.gz` are valid by default (home directory is allowed).
  - WSL/Linux: use Linux-mounted absolute paths (for example `/home/<you>/Downloads/live.sql`); Windows drive-style paths (`C:\...`) are not valid inside WSL shells.
- Natural prompts:
  - `Update local db from this dump`
  - `Sync my local db from this dump`
  - `Import this SQL dump into local WordPress`
  - `Refresh local db and replace URLs`
  - `Import this dump and update the API host URL and token`
  - `Import this live DB dump into my local WordPress`
  - `Sync local db from /path/to/dump.sql`
  - `Refresh my local WordPress db from this SQL dump`
- Advanced natural prompt:
  - `Import this dump, map the live domain to my local URL, replace the API host, and replace the token value.`
- Internal schema examples remain in `docs/tool-schemas.md`.

## Notes

- Database connectivity has been hand-tested mainly with Local, MAMP, and Homebrew MySQL sites. Other local stacks can work when `wp` on the host can already reach that site's database; they have not had the same pass.
- User-facing config is env-based (`WP_ROOT`, optional `WP_CLI`, optional `PHP_BIN`, optional `PATH` when Cursor’s GUI `PATH` cannot see `php`, optional `WP_AGENT_EXTRA_PATH` for MySQL client `bin` dirs, optional `WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS=0` to skip multisite `{prefix}site`/`{prefix}blogs` domain bulk alignment).
- MCP startup is lightweight (config + `WP_ROOT` validation + tool registration) and avoids full index builds during boot.
- Build the index explicitly with `build_wp_index`; audit/search tools return a clear `INDEX_NOT_READY` instruction if no index build exists yet.
- Usage lookups rely on the local index. If results look stale or missing, run `build_wp_index` and retry.
- **Bedrock:** set `WP_ROOT` to the Bedrock `web/` directory (where `wp-config.php` lives). The indexer resolves theme/plugin paths from WordPress (`WP_CONTENT_DIR` / `get_theme_root()`), so both classic `wp-content/` and Bedrock `app/` layouts are supported. Rebuild the index after upgrading wp-agent-mcp if blocks were previously missing.
- MCP tools are the public interface for assistant workflows. If AI model doesn't trigger wp-agent, include `use wp-agent` in the prompt to explicitly trigger it.
- Use natural-language prompts (for example: `Do we already have a compact testimonial section?`) instead of transport-shaped instructions.
- Prompts should never require explicit skill headers, HTTP route syntax, or payload body scaffolding; tool routing and payload handling stay internal to the MCP integration.

### Natural-language routing (examples)

Ask in plain language only. The assistant is responsible for choosing the right wp-agent capability; you should not need to name MCP tools or SQL transport.

- **Usage / fragments:** e.g. “Where is `.footer-disclosure` used?”, “Find every use of `[gravityform]`”, “Which pages use this shortcode?”
- **Existence / variants:** e.g. “Do we already have this component?”, “Should we reuse, extend, or create this variant?”
- **Live database reporting** (slugs, published vs draft, meta joins, plugin tables—things the local index does not fully model): e.g. “List published page slugs in the tht theme that include a multipage Gravity Form so I can test.”

## Extended Index Coverage

`build_wp_index` now extends content indexing beyond `wp_posts.post_content` to improve discovery accuracy:

- posts/pages (`content`)
- post meta (`postmeta_index`) including ACF/custom fields and serialized values
- options (`options_index`) with focus on `theme_mods_*`, `widget_*`, and larger content-bearing options
- menus (`menus_index`) from `nav_menu_item` entries plus relevant menu-item metadata
- patterns/templates (filesystem index; resolves `wp-content/` or Bedrock `app/` via WordPress content paths)

This means queries like “find all places this disclosure exists” now return matches from post content, ACF/custom fields, theme/widget options, and menu items.
