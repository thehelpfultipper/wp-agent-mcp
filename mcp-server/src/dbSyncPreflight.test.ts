import assert from "node:assert/strict";
import test from "node:test";
import { isSandboxOrNetworkBlocked } from "./dbSyncPreflight";

test("isSandboxOrNetworkBlocked detects connection refused", () => {
  assert.equal(isSandboxOrNetworkBlocked("connect ECONNREFUSED 127.0.0.1:3306", ""), true);
});

test("isSandboxOrNetworkBlocked requires both socket and blocked for generic socket wording", () => {
  assert.equal(isSandboxOrNetworkBlocked("error on mysql socket /tmp/mysql.sock", ""), false);
  assert.equal(isSandboxOrNetworkBlocked("socket blocked by policy", ""), true);
});
