import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { createConfigService } from "./configService";
import { createWpDbReadService } from "./wpDbReadService";
import { clearDiscoveredMysqlSocketCache } from "../wpCli";

const SOCKET_STDERR = "Failed to get current SQL modes. Reason: ERROR 2002 (HY000): Can't connect to local MySQL server through socket '/tmp/mysql.sock' (2)";

test("query_wp_db_readonly rewrites live table names and ignores a conflicting prefix hint", () => {
  const wpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-prefix-"));
  fs.writeFileSync(path.join(wpRoot, "wp-config.php"), "<?php\n");
  const sqlLog = path.join(os.tmpdir(), `wp-agent-sql-${crypto.randomBytes(4).toString("hex")}`);
  const evalCount = path.join(os.tmpdir(), `wp-agent-eval-${crypto.randomBytes(4).toString("hex")}`);
  const wpBin = writeFakeWp(`#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "eval" ]; then
    n=0
    if [ -f "${evalCount}" ]; then
      n=$(cat "${evalCount}")
    fi
    n=$((n + 1))
    printf '%s' "$n" > "${evalCount}"
    printf '%s\\n' 'WP_AGENT_TABLES:{"prefix":"xyz_","basePrefix":"xyz_","tables":{"posts":"xyz_posts","users":"xyz_users"}}'
    exit 0
  fi
  if [ "$arg" = "query" ]; then
    printf '%s\\n' "$@" > "${sqlLog}"
    printf 'ID\\n1\\n'
    exit 0
  fi
done
exit 1
`);
  clearDiscoveredMysqlSocketCache();
  const service = createWpDbReadService({
    wpCli: wpBin,
    config: createConfigService(wpRoot)
  });
  const sql = "SELECT 'wp_posts' AS label /* wp_posts {prefix}no */ FROM wp_posts JOIN wp_gf_entry JOIN `{prefix}gf_entry`";
  try {
    const first = service.queryReadonlySelect({
      wpRoot,
      sql,
      tablePrefix: "wp_",
      maxRows: 10
    });
    const second = service.queryReadonlySelect({
      wpRoot,
      sql,
      tablePrefix: "wp_3_",
      maxRows: 10
    });
    assert.equal(first.tablePrefix, "xyz_");
    assert.equal(second.tablePrefix, "xyz_");
    assert.equal(fs.readFileSync(evalCount, "utf8"), "1");
    const executed = String(first.sqlExecuted);
    assert.match(executed, /SELECT 'wp_posts' AS label \/\* wp_posts \{prefix\}no \*\/ FROM xyz_posts JOIN wp_gf_entry JOIN `xyz_gf_entry` LIMIT 10/);
    assert.deepEqual(first.tablesRewritten, {
      wp_posts: "xyz_posts",
      "{prefix}gf_entry": "xyz_gf_entry"
    });
    assert.match(fs.readFileSync(sqlLog, "utf8"), /FROM xyz_posts JOIN wp_gf_entry JOIN `xyz_gf_entry`/);
    assert.equal(first.stdout, "1");
  } finally {
    clearDiscoveredMysqlSocketCache();
    fs.rmSync(wpRoot, { recursive: true, force: true });
    fs.rmSync(wpBin, { force: true });
    fs.rmSync(sqlLog, { force: true });
    fs.rmSync(evalCount, { force: true });
  }
});

test("query_wp_db_readonly builds multisite names from table_prefix when the database probe fails", () => {
  const wpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-prefix-"));
  fs.writeFileSync(path.join(wpRoot, "wp-config.php"), "<?php\n");
  const sqlLog = path.join(os.tmpdir(), `wp-agent-sql-${crypto.randomBytes(4).toString("hex")}`);
  const wpBin = writeFakeWp(`#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "eval" ]; then
    printf '%s\\n' '<!DOCTYPE html><html><body>Error establishing a database connection</body></html>'
    exit 0
  fi
  if [ "$arg" = "config" ]; then
    printf 'wp_\\n'
    exit 0
  fi
  if [ "$arg" = "query" ]; then
    printf '%s\\n' "$@" > "${sqlLog}"
    printf 'ID\\n7\\n'
    exit 0
  fi
done
echo "${SOCKET_STDERR}" >&2
exit 1
`);
  clearDiscoveredMysqlSocketCache();
  const service = createWpDbReadService({
    wpCli: wpBin,
    config: createConfigService(wpRoot)
  });
  try {
    const result = service.queryReadonlySelect({
      wpRoot,
      sql: "SELECT ID FROM wp_posts JOIN wp_users",
      tablePrefix: "wp_",
      blogId: 2,
      maxRows: 5
    });
    assert.equal(result.tablePrefix, "wp_2_");
    assert.equal(result.sqlExecuted, "SELECT ID FROM wp_2_posts JOIN wp_users LIMIT 5");
    assert.deepEqual(result.tablesRewritten, {
      wp_posts: "wp_2_posts"
    });
    assert.match(fs.readFileSync(sqlLog, "utf8"), /FROM wp_2_posts JOIN wp_users LIMIT 5/);
  } finally {
    clearDiscoveredMysqlSocketCache();
    fs.rmSync(wpRoot, { recursive: true, force: true });
    fs.rmSync(wpBin, { force: true });
    fs.rmSync(sqlLog, { force: true });
  }
});

function writeFakeWp(script: string): string {
  const filePath = path.join(os.tmpdir(), `wp-agent-fake-wp-${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(filePath, script, { mode: 0o755 });
  return filePath;
}
