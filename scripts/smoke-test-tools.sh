#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="${ROOT_DIR}/mcp-server"
MCP_PORT="${MCP_PORT:-7337}"
BASE_URL="http://127.0.0.1:${MCP_PORT}"
WP_ROOT_INPUT="${WP_ROOT:-${1:-}}"
SERVER_STARTED_BY_SCRIPT=0
SERVER_PID=""

usage() {
  echo "Usage: WP_ROOT=/absolute/path/to/wp ./scripts/smoke-test-tools.sh"
  echo "   or: ./scripts/smoke-test-tools.sh /absolute/path/to/wp"
}

cleanup() {
  if [[ "${SERVER_STARTED_BY_SCRIPT}" -eq 1 && -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "[error] Missing required command: ${command_name}" >&2
    exit 1
  fi
}

wait_for_server() {
  local attempts=0
  local max_attempts=45

  until curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge "${max_attempts}" ]]; then
      return 1
    fi
    sleep 1
  done
}

validate_paths() {
  local tool="$1"
  local response="$2"
  shift 2
  node - "${tool}" "${response}" "$@" <<'NODE'
const [tool, rawResponse, ...requiredPaths] = process.argv.slice(2);

let parsed;
try {
  parsed = JSON.parse(rawResponse);
} catch (error) {
  console.error(`[fail] ${tool}: response is not valid JSON`);
  console.error(rawResponse);
  process.exit(1);
}

if (parsed.ok !== true) {
  console.error(`[fail] ${tool}: expected top-level ok=true`);
  console.error(JSON.stringify(parsed, null, 2));
  process.exit(1);
}

function hasPath(value, dottedPath) {
  const segments = dottedPath.split(".");
  let current = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return false;
    }
    current = current[segment];
  }
  return true;
}

const missing = requiredPaths.filter((path) => !hasPath(parsed, path));
if (missing.length > 0) {
  console.error(`[fail] ${tool}: missing keys -> ${missing.join(", ")}`);
  console.error(JSON.stringify(parsed, null, 2));
  process.exit(1);
}

console.log(`[pass] ${tool}`);
NODE
}

assert_tool_registry() {
  local response
  response="$(curl -fsS "${BASE_URL}/tools")"

  node - "${response}" <<'NODE'
const rawResponse = process.argv[2];
const requiredTools = [
  "connect_wordpress",
  "build_wp_index",
  "get_index_status",
  "get_theme_profile",
  "audit_component",
  "find_similar_content",
  "where_is_used",
  "query_wp_db_readonly"
];

const parsed = JSON.parse(rawResponse);
if (parsed.ok !== true || !parsed.data || !Array.isArray(parsed.data.tools)) {
  console.error("[fail] tools registry endpoint missing expected envelope");
  process.exit(1);
}

const names = new Set(
  parsed.data.tools
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => entry.name)
    .filter((name) => typeof name === "string")
);

const missing = requiredTools.filter((tool) => !names.has(tool));
if (missing.length > 0) {
  console.error(`[fail] missing required tools in registry: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("[pass] tool registry");
NODE
}

invoke_tool() {
  local tool="$1"
  local input_json="$2"
  shift 2

  local payload
  payload="$(node - "${tool}" "${input_json}" <<'NODE'
const [tool, rawInput] = process.argv.slice(2);
const input = JSON.parse(rawInput);
process.stdout.write(JSON.stringify({ tool, input }));
NODE
)"

  local response
  response="$(curl -fsS -X POST "${BASE_URL}/tools/call" -H "content-type: application/json" --data "${payload}")"
  validate_paths "${tool}" "${response}" "$@"
}

main() {
  require_command curl
  require_command node
  require_command npm

  if [[ -z "${WP_ROOT_INPUT}" ]]; then
    usage
    exit 1
  fi

  if [[ ! -d "${MCP_DIR}" ]]; then
    echo "[error] Expected MCP server directory at ${MCP_DIR}" >&2
    exit 1
  fi

  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    echo "[info] Reusing MCP server at ${BASE_URL}"
  else
    echo "[info] Starting MCP server on port ${MCP_PORT}"
    (
      cd "${MCP_DIR}"
      WP_ROOT="${WP_ROOT_INPUT}" MCP_PORT="${MCP_PORT}" npm run dev >"${ROOT_DIR}/.smoke-test-tools-server.log" 2>&1
    ) &
    SERVER_PID="$!"
    SERVER_STARTED_BY_SCRIPT=1

    if ! wait_for_server; then
      echo "[error] MCP server failed to become healthy at ${BASE_URL}/health" >&2
      echo "[hint] Check ${ROOT_DIR}/.smoke-test-tools-server.log for startup errors." >&2
      exit 1
    fi
  fi

  local connect_input
  connect_input="$(node - "${WP_ROOT_INPUT}" <<'NODE'
const wpRoot = process.argv[2];
process.stdout.write(JSON.stringify({ wpRoot }));
NODE
)"
  local build_input
  build_input="$(node - "${WP_ROOT_INPUT}" <<'NODE'
const wpRoot = process.argv[2];
process.stdout.write(JSON.stringify({ wpRoot, mode: "filesystem-only", limit: 200 }));
NODE
)"
  local index_status_input
  index_status_input="$(node - "${WP_ROOT_INPUT}" <<'NODE'
const wpRoot = process.argv[2];
process.stdout.write(JSON.stringify({ wpRoot }));
NODE
)"
  local theme_profile_input
  theme_profile_input="$(node - "${WP_ROOT_INPUT}" <<'NODE'
const wpRoot = process.argv[2];
process.stdout.write(JSON.stringify({ wpRoot }));
NODE
)"
  local audit_input
  audit_input="$(node - "${WP_ROOT_INPUT}" <<'NODE'
const wpRoot = process.argv[2];
process.stdout.write(JSON.stringify({ wpRoot, query: "header", limit: 10 }));
NODE
)"
  local similar_input
  similar_input="$(node - "${WP_ROOT_INPUT}" <<'NODE'
const wpRoot = process.argv[2];
process.stdout.write(JSON.stringify({ wpRoot, query: "header", limit: 10 }));
NODE
)"
  local where_used_input
  where_used_input="$(node - "${WP_ROOT_INPUT}" <<'NODE'
const wpRoot = process.argv[2];
process.stdout.write(JSON.stringify({ wpRoot, query: "header", limitPerGroup: 5 }));
NODE
)"

  assert_tool_registry
  invoke_tool "connect_wordpress" "${connect_input}" \
    "data.health.status" \
    "data.health.wordpressVersion" \
    "data.health.phpVersion" \
    "data.health.isMultisite" \
    "data.config.wpRoot" \
    "data.config.wpCliPath" \
    "data.config.tablePrefix"
  invoke_tool "build_wp_index" "${build_input}" \
    "data.status.schemaVersion" \
    "data.status.counts.blocks" \
    "data.status.counts.patterns" \
    "data.status.counts.templates" \
    "data.status.counts.content" \
    "data.summary.rebuiltAt" \
    "data.summary.filesystemRoots.contentRelativePrefix" \
    "data.summary.filesystemRoots.scanRootsExist.themes"
  invoke_tool "get_index_status" "${index_status_input}" \
    "data.schemaVersion" \
    "data.lastBuildAt" \
    "data.counts.blocks" \
    "data.counts.patterns" \
    "data.counts.templates" \
    "data.counts.content" \
    "data.lastFilesystemRoots.contentRelativePrefix"
  invoke_tool "get_theme_profile" "${theme_profile_input}" \
    "data.activeTheme.name" \
    "data.activeTheme.path" \
    "data.activeTheme.isBlockTheme" \
    "data.tokens.colors" \
    "data.helpers.files" \
    "data.conventions.naming.dominantFileCase"
  invoke_tool "audit_component" "${audit_input}" \
    "data.verdict" \
    "data.variants.existing" \
    "data.variants.missing" \
    "data.variants.recommendedMechanism.id" \
    "data.usage.content.count" \
    "data.recommendation.action"
  invoke_tool "find_similar_content" "${similar_input}" \
    "data.matches.content" \
    "data.matches.patterns" \
    "data.matches.templates" \
    "data.matches.files"
  invoke_tool "where_is_used" "${where_used_input}" \
    "data.query" \
    "data.detectedKind" \
    "data.summary.totalMatches" \
    "data.groups.templates" \
    "data.groups.files" \
    "data.recommendation"

  readonly_input="$(node - "${WP_ROOT_INPUT}" <<'NODE'
const wpRoot = process.argv[2];
process.stdout.write(JSON.stringify({ wpRoot, sql: "SELECT 1 AS smoke_ok", maxRows: 5 }));
NODE
)"
  invoke_tool "query_wp_db_readonly" "${readonly_input}" \
    "data.stdout" \
    "data.sqlExecuted" \
    "data.tablePrefix" \
    "data.wpRoot"

  echo "[ok] Smoke test passed for core public MCP tools."
}

main "$@"
