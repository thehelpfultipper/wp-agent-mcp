/**
 * When MCP runs in a sandbox that blocks localhost MySQL, the tool cannot self-elevate.
 * This module produces structured, copy-paste guidance so the assistant can walk the user
 * through the same checks outside the sandbox and then retry the tool.
 */

export type OutsideSandboxShellCommand = {
  /** One-line purpose */
  label: string;
  /** Single line or short script safe for zsh/bash on macOS/Linux */
  command: string;
};

export type OutsideSandboxRemediation = {
  summary: string;
  /** Cursor / IDE steps (no exact UI guarantees across versions) */
  ideConfigurationSteps: string[];
  verifyConnectivityCommands: OutsideSandboxShellCommand[];
  /** After Terminal `wp db check` succeeds */
  retryHint: string;
  /** Markdown the agent should show the user verbatim */
  assistantMessage: string;
};

function escapeForDoubleQuotedShell(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\$/gu, "\\$").replace(/`/gu, "\\`");
}

function doubleQuotedPath(value: string): string {
  return `"${escapeForDoubleQuotedShell(value)}"`;
}

/** WP-CLI executable token for shell (quote if path has spaces). */
export function formatWpCliShellToken(wpCli: string): string {
  const trimmed = wpCli.trim();
  if (trimmed.length === 0) {
    return "wp";
  }
  if (/\s/u.test(trimmed)) {
    return doubleQuotedPath(trimmed);
  }
  return trimmed;
}

export function buildOutsideSandboxRemediation(params: {
  wpRoot: string;
  wpCli: string;
  /** Current MCP WP_AGENT_EXTRA_PATH, if any — included so user can mirror in Terminal */
  wpAgentExtraPath?: string;
}): OutsideSandboxRemediation {
  const wpRoot = params.wpRoot.trim();
  const wpInv = formatWpCliShellToken(params.wpCli);
  const rootVar = doubleQuotedPath(wpRoot);
  const extraPath = typeof params.wpAgentExtraPath === "string" ? params.wpAgentExtraPath.trim() : "";
  const exportExtraLine =
    extraPath.length > 0 ? `export WP_AGENT_EXTRA_PATH=${doubleQuotedPath(extraPath)}\n` : "";
  const exportExtraPrefix =
    extraPath.length > 0 ? `export WP_AGENT_EXTRA_PATH=${doubleQuotedPath(extraPath)} && ` : "";

  const verifyDbCheckMultiline = `${exportExtraLine}export WP_ROOT=${rootVar}\ncd "$WP_ROOT" && ${wpInv} db check`;
  const verifyHomeMultiline = `${exportExtraLine}export WP_ROOT=${rootVar}\ncd "$WP_ROOT" && ${wpInv} option get home`;

  const verifyDbCheckOneLine = `${exportExtraPrefix}export WP_ROOT=${rootVar} && cd "$WP_ROOT" && ${wpInv} db check`;
  const verifyHomeOneLine = `${exportExtraPrefix}export WP_ROOT=${rootVar} && cd "$WP_ROOT" && ${wpInv} option get home`;

  const ideConfigurationSteps = [
    "Open Cursor **Settings → MCP** (or workspace MCP config) for the `wp-agent` server.",
    "If Cursor offers **network**, **host access**, **all permissions**, or **run outside sandbox** for this MCP server or for agent terminal tools, enable it so the child process can open TCP to your local DB (often `127.0.0.1` / `localhost`).",
    "Restart Cursor or reload MCP servers so the new permission takes effect.",
    "Retry the same `sync_local_db_from_dump` call from chat once `wp db check` succeeds in a normal Terminal (see commands below)."
  ];

  const assistantMessage = [
    "### Database sync blocked by sandbox / localhost network",
    "",
    "No backup and no import ran yet — safe to fix environment and retry.",
    "",
    "**1) Prove WordPress can reach MySQL from your own Terminal** (outside MCP):",
    "",
    "```bash",
    verifyDbCheckMultiline,
    "```",
    "",
    "**2) Optional sanity check** (same shell session):",
    "",
    "```bash",
    verifyHomeMultiline,
    "```",
    "",
    "**3) Cursor MCP** — allow host/network access for this server if the UI offers it, then reload MCP and run the tool again.",
    "",
    extraPath.length > 0
      ? `_Note: your MCP manifest sets \`WP_AGENT_EXTRA_PATH\`; the first command mirrors it so Terminal matches the MCP environment._`
      : "_If `wp` or `mysql` works in Terminal but not in MCP, add the same directories to `PATH` or set `WP_AGENT_EXTRA_PATH` in the MCP manifest._"
  ].join("\n");

  return {
    summary:
      "`wp db check` failed in a way that usually means the MCP process cannot reach localhost MySQL. Run the commands below in Terminal, fix MCP permissions if needed, then retry the sync tool.",
    ideConfigurationSteps,
    verifyConnectivityCommands: [
      { label: "Verify DB from host Terminal (same as tool preflight)", command: verifyDbCheckOneLine },
      { label: "Optional: read home URL after DB is reachable", command: verifyHomeOneLine }
    ],
    retryHint:
      "After `wp db check` succeeds in Terminal and MCP is allowed to use the host network, invoke `sync_local_db_from_dump` again with the same arguments.",
    assistantMessage
  };
}
