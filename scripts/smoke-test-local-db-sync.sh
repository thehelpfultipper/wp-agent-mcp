#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="${ROOT_DIR}/mcp-server"

if [[ ! -d "${MCP_DIR}" ]]; then
  echo "[error] Expected MCP server directory at ${MCP_DIR}" >&2
  exit 1
fi

echo "[info] Running local DB sync smoke harness..."
(
  cd "${MCP_DIR}"
  npm run test:local-db-sync
)
echo "[ok] local DB sync smoke harness passed."
