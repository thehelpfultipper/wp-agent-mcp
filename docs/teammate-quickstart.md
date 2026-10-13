# WP Agent MCP — Quickstart

First-time setup for anyone cloning this repo. You do not need to know the internal architecture.

## 1) Prerequisites

Before opening Cursor, make sure you have:

- Cursor installed
- A local WordPress project on your machine
- The absolute path to that WordPress root (example: `/Users/you/Sites/my-wp-site`)
- **Node 20+** (`node`/`npm` installed). Team default: **Node 22 LTS** (see `mcp-server/.nvmrc`)
- A clone of this repository (`wp-agent-mcp`) on your machine
- WordPress CLI available (`wp` in your shell path)
- PHP available (`php` in your shell path)
- For **`sync_local_db_from_dump`**: MySQL client programs (`mysql`, `mysqldump`, `mysqlcheck`) on the same PATH Cursor uses for MCP, **or** set `WP_AGENT_EXTRA_PATH` in the MCP manifest to your MySQL `bin` directory (see **Common troubleshooting → DB sync: preflight** below)

Quick checks in a terminal:

```bash
node -v    # must be v20+; use v22 if your team follows mcp-server/.nvmrc
npm -v
wp --info
php -v
```

**Important:** `npm install` and Cursor MCP must use the **same** `node` binary. Cursor often resolves bare `"command": "node"` to a different Node than your terminal (for example nvm 22 in shell vs Cursor bundled Node 24). Pin an absolute path in `~/.cursor/mcp.json` after install:

```bash
command -v node   # copy this path into mcp.json "command"
```

If `wp` or `php` is not on your path, you can still test by setting `WP_CLI` and/or `PHP_BIN` explicitly in the manifest (shown in troubleshooting).

### Bedrock projects

If your WordPress site uses [Bedrock](https://roots.io/bedrock/) (Composer layout with `web/app/` instead of `web/wp-content/`):

- Set **`WP_ROOT` to the Bedrock `web/` directory** (where `wp-config.php` lives), **not** the Composer project root.
- Example: `/Users/you/my-bedrock-site/web`
- After connecting, run **`Build the WordPress index.`** and confirm the build summary shows:
  - `filesystemRoots.contentRelativePrefix: "app"`
  - Non-zero `discovered.blocks` when your theme/plugins contain `block.json` files
- `get_index_status` also exposes `lastFilesystemRoots` after a successful filesystem index build.
- If you indexed before Bedrock support was added, **rebuild the index** so blocks/patterns/templates are rescanned under `app/themes` and `app/plugins`.

## 2) Add the MCP manifest in Cursor

Use one of these manifests.

### Option A (recommended): run from a local clone

1. Build once from your checked-out repo:

```bash
cd /absolute/path/to/wp-agent-mcp/mcp-server
npm install
npm run build
```

2. Add this MCP manifest (replace pinned Node, server path, and `WP_ROOT`):

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

Use the path from `command -v node` for `command` (see prerequisites above).

### Option B: npm, git, or tarball

If you install from a registry, git URL, or tarball instead of a clone, use `npx` with your package spec:

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

Examples for `<your-internal-package-spec>` (rename to match your spec):
- `wp-agent-mcp@latest` (npm, when published)
- `@your-scope/wp-agent-mcp@latest` (scoped/private registry)
- `git+https://github.com/your-org/wp-agent-mcp.git#main`
- `/absolute/path/to/wp-agent-mcp/mcp-server` (local package directory)
- `https://artifacts.example.com/wp-agent-mcp-1.0.0.tgz`

More detail: [`mcp-cursor-config.md`](./mcp-cursor-config.md).

In Cursor:

1. Open MCP settings/config for your workspace.
2. Add the `wp-agent` server entry from Option A or Option B.
3. Replace `WP_ROOT` with your real absolute WordPress path.
4. Save.

Use [`docs/cursor-mcp-manifest.json`](./cursor-mcp-manifest.json) or [`docs/mcp-cursor-config.md`](./mcp-cursor-config.md) as copy/paste references.

## 3) Restart Cursor

After saving MCP config, restart Cursor so the server is reloaded:

- Best: fully quit Cursor and open it again
- Faster option: run **Developer: Reload Window** from the command palette

Confirm in **Settings → MCP** that the `wp-agent` server is enabled, shows no startup error, and lists tools after reload. The manifest should point `node` at `mcp-server/bin/wp-agent-mcp.js` with `WP_ROOT` set to your WordPress root.

## 4) First prompts to try

Run these in order in Cursor chat:

1. `Connect to my WordPress project.`
2. `Build the WordPress index.`
3. `Do we already have a compact testimonial section?`
4. `Find pages or templates that use a footer disclosure.`
5. `Update local db from this dump` (or tag your `@db-sync-defaults.mdc` rules file — see **4.1**)

Use plain teammate language for prompts. Do not format requests with explicit skill headers, HTTP route lines, or payload-body scaffolding.

Optional verification prompt:

- `What MCP tools do you have from wp-agent?`

## 4.1) Local DB sync (natural language)

Use plain language. You do **not** need to name MCP tools or paste JSON payloads.

**What you need first:** a local SQL dump (`.sql` or `.sql.gz`) — for example one you downloaded from production.

**What the tool does:** imports that dump into your local WordPress database, backs up your current local DB first, rewrites live URLs/tokens to local values, and verifies the result. **DB only** — it does not sync uploads/media/files.

### Two ways to run it

#### Path 1 — tagged rules file (recommended for repeat syncs)

1. Copy the sample rules file from this repo into **your WordPress project**:
   - Template: [`docs/templates/db-sync-defaults.mdc`](templates/db-sync-defaults.mdc)
   - Suggested location: `.cursor/rules/db-sync-defaults.mdc` (or any name you prefer)
2. Edit the placeholders (`YOUR_LIVE_DOMAIN`, local URL, API host, token, etc.).
3. Tag that file in chat and say what dump to use:

```
@db-sync-defaults.mdc update my local db from live-db.sql.gz
```

The assistant reads your rules file, maps **Source → live**, **Target → local**, and any extra replacement sections → API/token mappings, then runs the sync. No follow-up questions unless the dump path is missing.

**Rules file sections (convention):**

| Section | Maps to |
|---|---|
| Primary Domain Replacement → Source | production domain / URL |
| Primary Domain Replacement → Target | local WordPress URL |
| Other named sections (API, Token, …) | additional search-replace pairs |
| Required Safety Rules / Prompting Behavior | informational — already enforced by the tool |

#### Path 2 — no rules file (first time or one-off)

Say something like:

- `Update local db from this dump`
- `Sync my local db from live-db.sql.gz`

The assistant will ask a short series of questions (production domain, local URL with common presets, optional API/token replacements) before running the sync. Answer in the chat UI — you still never hand-author tool payloads.

### Example prompts

- `Update local db from this dump`
- `Sync my local db from this dump`
- `@db-sync-defaults.mdc refresh local db from /Users/me/Downloads/live.sql.gz`
- `Import this dump and update the API host URL and token` (with or without a rules file)

**Split these** — DB sync first, files separately:

- `Import this dump and sync uploads too`
- `Refresh local db and pull media files`

### Reference (optional)

**Dump path:** mention the filename or full path in your message (e.g. `live-db.sql.gz` in project root). Allowed roots: `WP_ROOT`, home, cwd, or `WP_AGENT_ALLOWED_DUMP_ROOTS`.

**MCP manifest env (only if needed):**

- `WP_AGENT_EXTRA_PATH` — MySQL client `bin` dir when `mysql`/`mysqldump` work in Terminal but not in MCP
- `WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS=0` — skip multisite core domain bulk alignment (subdomain-style networks)

**What happens during sync:**
- **Preflight** (before backup): validates dump path, `localUrl` (explicit or detectable), MySQL client tools on PATH / `WP_AGENT_EXTRA_PATH`, and `wp db check` (DB + MySQL pipeline; catches many sandbox “cannot reach localhost DB” cases). When `wp db check` fails and the stderr looks like a sandbox or network block, the tool returns **`DB_SYNC_REQUIRES_ELEVATED_CONTEXT`** (no backup/import). The JSON includes **`outsideSandboxRemediation`** (same object is under **`errorDetails`**) with an **`assistantMessage`** the agent should paste for you: copy-paste **Terminal** commands (`wp db check` using your `WP_ROOT`) plus **Cursor MCP** steps (enable host/network access if the UI offers it, then reload MCP). There is no in-chat “Allow elevated?” button—the MCP process cannot self-elevate; you run the checks outside the sandbox or fix MCP permissions, then retry.
- A local backup is always created next at `<WP_ROOT>/.wp-agent-db-backup-<timestamp>.sql`
- Dump import tries `wp db import` first; on SOURCE/SQL edge failures it **falls back** to streaming the decompressed SQL through `wp db cli`
- Search/replace rewrites live-domain URLs to local URLs (multisite uses `--network`)
- On multisite (unless `WP_AGENT_MS_ALIGN_DOMAIN_COLUMNS=0`), core `{prefix}site` / `{prefix}blogs` domain columns are aligned to `localUrl`, then `wp site` / `wp network` updates run
- `home` / `siteurl` are set to `localUrl`, then cache flush
- **Verification** payload on success: `importMethod`, option match flags, multisite alignment flag (when applicable), summed dry-run replacement counts for primary pairs, cache flush status

Failure behavior:
- The tool returns `success: false` with stable `errorCode` and `errorMessage`; aggregated preflight failures use `SYNC_PREFLIGHT_FAILED` with `preflight.checks[]` (each entry has `remediation` where applicable).
- Codes include `DB_UNREACHABLE` (inside preflight checks), **`DB_SYNC_REQUIRES_ELEVATED_CONTEXT`** (sandbox-like DB failure—use `outsideSandboxRemediation` / Terminal + MCP steps, then retry; no partial import), **`DB_SYNC_ASSERTION_FAILED`** (post-sync URL/domain/dry-run invariants), `IMPORT_METHOD_FAILED` (import + `wp db cli` fallback both failed), and existing `DB_IMPORT_FAILED` / `DB_BACKUP_FAILED` / etc.
- If backup was created, it stays on disk and warnings include a restore hint (`wp db import "<backupPath>"`)
- Replacement-stage failures after import still include the backup path so rollback is always available
- No remote download/upload automation is attempted by this tool

Cross-platform path notes:
- macOS: use paths like `/Users/<you>/Downloads/live.sql.gz`
- WSL/Linux: use Linux absolute paths like `/home/<you>/Downloads/live.sql`; do not pass Windows drive-letter paths from inside WSL shells

## 5) What success looks like

You should see all of the following:

- The connect step confirms `WP_ROOT` is valid (structured JSON with `wpRoot`, theme path hints, and no `WP_ROOT_INVALID` / `WPCLI_NOT_FOUND` errors).
- Index build completes (or reports clear progress/completion state); `get_index_status` should show a recent build when finished.
- The testimonial prompt (or similar component existence prompt) returns a structured **audit** payload (`verdict`, `candidates`, `recommendation`) — not a generic guess.
- The footer disclosure prompt returns specific **usage** matches (content/templates/patterns/files) or a clear “none found”, with confidence and reasons per match.
- Responses are actionable (for example, includes where matches were found and what to do next).
- DB sync responses include **preflight** results (passed checks) and, on success, **verification** (import path used, summed dry-run replacements across canonical + mapping pairs, `home`/`siteurl` alignment, multisite core domain alignment when applicable, **`finalAssertionsPassed`**, cache flush). Failures return stable `errorCode` / `errorMessage` and often `preflight.checks[]` with remediation text.

## 6) Common troubleshooting steps

### MCP server does not start

- Recheck JSON formatting in MCP config (no trailing commas, valid braces).
- If using Option A, verify build artifacts exist: `/absolute/path/to/wp-agent-mcp/mcp-server/dist/server.js`.
- If using Option B, confirm `npx` works in terminal: `npx -v`.
- Restart Cursor again after any manifest change.

### `NODE_MODULE_VERSION` / `better-sqlite3` ABI mismatch

`better-sqlite3` is a native addon. The `.node` binary must be compiled for the **exact** Node binary that starts MCP — not merely the same major from a different install path.

Typical error:

```text
better_sqlite3.node was compiled against NODE_MODULE_VERSION 127.
This version of Node.js requires NODE_MODULE_VERSION 137.
```

| ABI | Node |
|-----|------|
| 115 | 20 |
| 127 | 22 |
| 137 | 24 |

**Fix (pick one and keep install + MCP aligned):**

1. **Pin Node in `~/.cursor/mcp.json`** (recommended):

```bash
cd /absolute/path/to/wp-agent-mcp/mcp-server
nvm use 22          # or your team Node
NODE_BIN="$(command -v node)"
echo "$NODE_BIN"
rm -rf node_modules
npm ci
npm run build
```

Set `"command": "/home/you/.nvm/versions/node/v22.x.x/bin/node"` (your real path), fully quit Cursor, reopen.

2. **Rebuild for whatever Node MCP already uses:**

```bash
cd /absolute/path/to/wp-agent-mcp/mcp-server
# Run rebuild with the same node binary shown in the MCP startup error / process.execPath
npm rebuild better-sqlite3
```

3. **Sanity check before retrying tools:**

```bash
node -p "process.version + ' ABI ' + process.versions.modules"
npm run verify:native
```

Both commands must succeed under the Node you pinned in `mcp.json`.

### `EADDRINUSE ... port 7337`

This means another process is already using the same port.

- If `MCP_PORT` is **not set**, wp-agent now auto-selects an open fallback port.
- If `MCP_PORT` **is set explicitly**, either stop the process using that port or change `MCP_PORT` in the manifest.
- If you want to pin a different port, add for example: `"MCP_PORT": "7338"` under `env`.

### `npm error 404 ... wp-agent-mcp@* is not in this registry`

This means the `npx` package spec is not available on the registry Cursor/npm is using (for example the package is not published yet, or you need a private registry).

- Preferred fix: switch to Option A (pinned absolute Node in `command` + path to `bin/wp-agent-mcp.js`).
- If you use `npx`, set `<package-spec>` to a resolvable name (public npm, scoped package, git URL, or tarball). See [`mcp-cursor-config.md`](./mcp-cursor-config.md).
- For private registries, verify auth in terminal first:
  - `npm config get registry`
  - `npm view @your-scope/wp-agent-mcp version`
- After changing MCP config, restart Cursor.

### “WordPress root invalid” or connect fails

- Verify `WP_ROOT` is absolute and points to the actual WP install root.
- Confirm expected WP files exist under that folder (for example `wp-config.php`, and either `wp-content/` or Bedrock `app/`).
- **Bedrock:** use the `web/` directory, not the Composer project root.
- Avoid symlink confusion; use the resolved real path if needed.

### Index build finds zero blocks on Bedrock

- Confirm `WP_ROOT` points to Bedrock `web/` (not project root).
- Rebuild the index: `Build the WordPress index.`
- Check build output for `filesystemRoots.contentRelativePrefix` — should be `"app"` on Bedrock.
- If `discovered.blocks` is still `0` but themes exist, check for `warnings` in the build summary (for example themes dir exists but no `block.json` files were found).

### `wp` or `php` command not found

Add explicit binary paths in your manifest:

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

Then save and restart Cursor.

### Index-related prompts return `INDEX_NOT_READY`

- Run `Build the WordPress index.` first.
- Wait for the build to finish, then retry audit/search prompts.

### DB sync: `SYNC_PREFLIGHT_FAILED`, MySQL clients, or localhost blocked

- **`SYNC_PREFLIGHT_FAILED`** — read `preflight.checks[]`: each row has `id` (`dump_path`, `local_url`, `mysql_clients`, `db_reachable`), `ok`, `message`, and often `remediation`.
- **MySQL / `mysql_clients` false** — install client tools (e.g. Homebrew `mysql-client`) and either put them on system PATH or set **`WP_AGENT_EXTRA_PATH`** in the MCP manifest to the `bin` directory, then restart Cursor. If it works in Terminal but not in MCP, PATH in the IDE is usually the issue.
- **`db_reachable` false / sandbox** — if the error code is **`DB_SYNC_REQUIRES_ELEVATED_CONTEXT`**, open **`outsideSandboxRemediation`** in the tool response: run the **`verifyConnectivityCommands`** in your Mac/Linux Terminal first; if those succeed, adjust Cursor **MCP** settings so the server can use the host network (wording varies by version), reload MCP, and retry. The tool cannot show an in-editor approval dialog; the agent should walk you through that payload, not stop at “blocked.”
- **`IMPORT_METHOD_FAILED`** — both `wp db import` and streaming `wp db cli` failed; use `errorDetails` for both stderr payloads and confirm dump integrity / MySQL max packet / disk space.

Example manifest snippet (macOS Homebrew MySQL client):

```json
"env": {
  "WP_ROOT": "/absolute/path/to/wordpress",
  "WP_AGENT_EXTRA_PATH": "/opt/homebrew/opt/mysql-client/bin"
}
```

### DB sync asks for `liveDomain` or `localUrl`

Usually means you used **Path 2** (no rules file) and auto-detection was not enough, or the assistant still needs one value.

- **Fastest fix for repeat syncs:** use **Path 1** — copy [`docs/templates/db-sync-defaults.mdc`](templates/db-sync-defaults.mdc) into your WordPress project, fill in Source/Target, tag `@db-sync-defaults.mdc` in the prompt.
- **One-off:** answer the assistant’s questions (production domain, local URL e.g. `http://localhost:8888`, optional API/token pairs).
- Provide `localUrl` if your local WordPress `home` / `siteurl` options are empty.
- Provide `liveDomain` when the imported DB does not expose a single deterministic production origin.

### Results seem too broad or unclear

- Ask follow-ups with concrete constraints, for example:
  - `Limit to templates and template parts only.`
  - `Show the top 5 closest matches and why.`

## Quick tester checklist

- Connected successfully
- Built index successfully
- Ran all 5 starter prompts
- Got structured and specific answers for both audit and similarity search
