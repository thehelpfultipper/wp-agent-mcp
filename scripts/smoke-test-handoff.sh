#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_SMOKE_TEST="${ROOT_DIR}/scripts/smoke-test-tools.sh"
WP_ROOT_INPUT="${WP_ROOT:-${1:-}}"

usage() {
  echo "Usage: WP_ROOT=/absolute/path/to/wp ./scripts/smoke-test-handoff.sh"
  echo "   or: ./scripts/smoke-test-handoff.sh /absolute/path/to/wp"
}

if [[ -z "${WP_ROOT_INPUT}" ]]; then
  usage
  exit 1
fi

if [[ ! -x "${TOOLS_SMOKE_TEST}" ]]; then
  echo "[error] Missing executable script: ${TOOLS_SMOKE_TEST}" >&2
  exit 1
fi

echo "[info] Running handoff smoke test..."
WP_ROOT="${WP_ROOT_INPUT}" "${TOOLS_SMOKE_TEST}" "${WP_ROOT_INPUT}"
echo "[ok] Handoff smoke test passed. MCP is ready for teammate testing."
