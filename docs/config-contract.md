# Config Contract (Minimal MCP)

This note defines the user-facing configuration contract for the WP Agent MCP.
It is documentation-only and does not imply runtime behavior changes yet.

## Required Env Vars

- `WP_ROOT` (required)
  - Absolute path to the target WordPress installation root.
  - Used as the filesystem sandbox boundary and index location root.

## Optional Env Vars (Auto-Detected When Omitted)

- `WP_CLI` (optional)
  - WP-CLI executable path or command name.
  - If omitted, startup auto-detects `wp` from `PATH` and validates it is callable.

- `PHP_BIN` (optional)
  - PHP executable path or command name.
  - If omitted, startup auto-detects `php` from `PATH` and validates it is callable.

## Contract Rules

- Env vars are the canonical user configuration surface.
- Custom JSON config is not part of the primary setup path.
- Any existing project-local config file from earlier iterations is legacy and optional only.

## No Longer User-Configurable (User Contract Scope)

- Additional custom JSON config shapes and keys.
- Multiple competing config entry points for runtime command selection.
- Any settings not listed above are out of scope for the minimal user-facing contract.
