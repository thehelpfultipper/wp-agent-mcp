import assert from "node:assert/strict";
import test from "node:test";
import { buildOutsideSandboxRemediation, formatWpCliShellToken } from "./dbSyncOutsideSandboxRemediation";

test("formatWpCliShellToken quotes paths with spaces", () => {
  assert.equal(formatWpCliShellToken("wp"), "wp");
  assert.equal(formatWpCliShellToken("/opt/wp-cli/bin/wp"), "/opt/wp-cli/bin/wp");
  assert.equal(formatWpCliShellToken("/my dir/wp"), '"/my dir/wp"');
});

test("buildOutsideSandboxRemediation embeds WP_ROOT and wp db check", () => {
  const r = buildOutsideSandboxRemediation({
    wpRoot: "/var/www/html",
    wpCli: "wp"
  });
  assert.ok(r.assistantMessage.includes("wp db check"));
  assert.ok(r.verifyConnectivityCommands[0].command.includes("/var/www/html"));
  assert.ok(r.verifyConnectivityCommands[0].command.includes("db check"));
  assert.equal(r.ideConfigurationSteps.length >= 3, true);
});

test("buildOutsideSandboxRemediation mirrors WP_AGENT_EXTRA_PATH when provided", () => {
  const r = buildOutsideSandboxRemediation({
    wpRoot: "/srv/wp",
    wpCli: "wp",
    wpAgentExtraPath: "/opt/mysql/bin"
  });
  assert.ok(r.verifyConnectivityCommands[0].command.includes("WP_AGENT_EXTRA_PATH"));
  assert.ok(r.verifyConnectivityCommands[0].command.includes("/opt/mysql/bin"));
});
