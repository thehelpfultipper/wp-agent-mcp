# Handoff Smoke Test Checklist

Use this once before handing the MCP package to a teammate.

## Run (single command)

```bash
WP_ROOT=/absolute/path/to/wordpress ./scripts/smoke-test-handoff.sh
```

You can also pass the path as the first argument:

```bash
./scripts/smoke-test-handoff.sh /absolute/path/to/wordpress
```

## What this verifies

- MCP server starts and reaches healthy state
- public tool registry includes required handoff tools
- `connect_wordpress` works
- `build_wp_index` works
- `audit_component` works on a sample query (`header`)
- `find_similar_content` works on a sample query (`header`)
- `where_is_used` works on a sample query (`header`)

## Pass criteria

Treat the package as handoff-ready when the script exits successfully and prints:

```text
[ok] Handoff smoke test passed. MCP is ready for teammate testing.
```

## If it fails

- Check the script error output first.
- If startup failed, inspect `.smoke-test-tools-server.log` in the repo root.
- Re-run after fixing environment issues (most commonly `WP_ROOT`, `wp`, or `php` path problems).
