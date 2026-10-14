import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./errors";
import {
  findSiteMysqlCnf,
  isMissingMysqlClientMessage,
  isWordpressDatabaseErrorDocument,
  parseMysqlSocketFromCnf,
  resolveAlternateMysqlSocket
} from "./mysqlUnixSocket";
import { createConfigService } from "./services/configService";
import { createWpDbReadService, decodeReadonlyEvalCell } from "./services/wpDbReadService";
import { clearDiscoveredMysqlSocketCache, runWpCli } from "./wpCli";

const SOCKET_STDERR = "Failed to get current SQL modes. Reason: ERROR 2002 (HY000): Can't connect to local MySQL server through socket '/tmp/mysql.sock' (2)";

test("socket failures are not treated as a missing mysql client", () => {
  assert.equal(isMissingMysqlClientMessage(SOCKET_STDERR), false);
  assert.equal(
    isMissingMysqlClientMessage("Failed to get current SQL modes. Reason: env: mysql: No such file or directory"),
    true
  );
  assert.equal(isMissingMysqlClientMessage("sh: mysql: command not found"), true);
});

test("database connection HTML is recognized", () => {
  assert.equal(isWordpressDatabaseErrorDocument("<!DOCTYPE html><html>Bluehost</html>"), true);
  assert.equal(isWordpressDatabaseErrorDocument("<h1>Error establishing a database connection</h1>"), true);
  assert.equal(isWordpressDatabaseErrorDocument("wp_"), false);
  assert.equal(isWordpressDatabaseErrorDocument("dG90YWw=\nMw=="), false);
});

test("decodeReadonlyEvalCell rejects a database error page", () => {
  assert.throws(
    () => decodeReadonlyEvalCell("<!DOCTYPE html>"),
    (err: unknown) => err instanceof AppError && err.code === "DB_UNREACHABLE"
  );
  assert.equal(decodeReadonlyEvalCell("dG90YWw="), "total");
  assert.equal(decodeReadonlyEvalCell(""), "");
});

test("parseMysqlSocketFromCnf keeps paths that contain spaces", () => {
  const contents = [
    "# comment",
    "[mysqld]",
    "port = 10004",
    "socket = \"/Users/me/Library/Application Support/Local/run/site/mysql/mysqld.sock\"",
    "[client]",
    "socket = '/Users/me/Library/Application Support/Local/run/site/mysql/mysqld.sock'"
  ].join("\n");
  assert.equal(
    parseMysqlSocketFromCnf(contents),
    "/Users/me/Library/Application Support/Local/run/site/mysql/mysqld.sock"
  );
});

test("findSiteMysqlCnf walks from a Local app/public root", () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-site-"));
  const wpRoot = path.join(site, "app", "public");
  const cnf = path.join(site, "conf", "mysql", "my.cnf");
  fs.mkdirSync(path.dirname(cnf), { recursive: true });
  fs.mkdirSync(wpRoot, { recursive: true });
  fs.writeFileSync(cnf, "socket = /tmp/example.sock\n");
  assert.equal(findSiteMysqlCnf(wpRoot), cnf);
});

test("resolveAlternateMysqlSocket prefers the site config over other sockets", async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-site-"));
  const wpRoot = path.join(site, "app", "public");
  const socketPath = path.join(os.tmpdir(), `wp-agent-${process.pid}-pref.sock`);
  const server = await listenSocket(socketPath);
  try {
    fs.mkdirSync(path.join(site, "conf", "mysql"), { recursive: true });
    fs.mkdirSync(wpRoot, { recursive: true });
    fs.writeFileSync(path.join(site, "conf", "mysql", "my.cnf"), `socket = "${socketPath}"\n`);
    const resolved = resolveAlternateMysqlSocket(wpRoot, "/tmp/mysql.sock", [
      "/tmp/other-a.sock",
      "/tmp/other-b.sock"
    ]);
    assert.equal(resolved.socketPath, socketPath);
    assert.equal(resolved.source, "site-config");
    assert.deepEqual(resolved.ambiguousSockets, []);
  } finally {
    server.close();
    fs.rmSync(socketPath, { force: true });
    fs.rmSync(site, { recursive: true, force: true });
  }
});

test("resolveAlternateMysqlSocket does not guess when several global sockets exist", () => {
  const wpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-plain-"));
  const resolved = resolveAlternateMysqlSocket(wpRoot, "/tmp/mysql.sock", [
    "/tmp/other-a.sock",
    "/tmp/other-b.sock"
  ]);
  assert.equal(resolved.socketPath, null);
  assert.deepEqual(resolved.ambiguousSockets, ["/tmp/other-a.sock", "/tmp/other-b.sock"]);
  fs.rmSync(wpRoot, { recursive: true, force: true });
});

test("parseMysqlSocketFromCnf ignores Local template placeholders", () => {
  assert.equal(parseMysqlSocketFromCnf("socket = {{socket}}\n"), null);
});

test("resolveAlternateMysqlSocket uses Local's run socket when the site config is a template", async () => {
  const layout = await createLocalRunLayout();
  try {
    const resolved = resolveAlternateMysqlSocket(
      layout.wpRoot,
      "/tmp/mysql.sock",
      ["/tmp/other-a.sock", "/tmp/other-b.sock"],
      [layout.supportDir]
    );
    assert.equal(resolved.socketPath, layout.socketPath);
    assert.equal(resolved.source, "site-config");
    assert.equal(resolved.configuredButMissing, null);
  } finally {
    await layout.cleanup();
  }
});

test("resolveAlternateMysqlSocket does not use another Local site's socket", async () => {
  const layout = await createLocalRunLayout();
  const otherSocket = path.join(os.tmpdir(), `wp-agent-other-${process.pid}.sock`);
  const otherServer = await listenSocket(otherSocket);
  try {
    const otherRun = path.join(layout.supportDir, "run", "otherSite");
    fs.mkdirSync(path.join(otherRun, "conf", "mysql"), { recursive: true });
    fs.writeFileSync(path.join(otherRun, "conf", "mysql", "my.cnf"), `socket = "${otherSocket}"\n`);
    const sites = JSON.parse(fs.readFileSync(path.join(layout.supportDir, "sites.json"), "utf8")) as Record<string, { path: string }>;
    sites.otherSite = { path: path.join(layout.supportDir, "other-site") };
    fs.writeFileSync(path.join(layout.supportDir, "sites.json"), JSON.stringify(sites));
    const resolved = resolveAlternateMysqlSocket(layout.wpRoot, "/tmp/mysql.sock", [], [layout.supportDir]);
    assert.equal(resolved.socketPath, layout.socketPath);
  } finally {
    otherServer.close();
    fs.rmSync(otherSocket, { force: true });
    await layout.cleanup();
  }
});

test("resolveAlternateMysqlSocket reports a stopped Local site instead of guessing", () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-local-site-"));
  const support = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-local-support-"));
  const wpRoot = path.join(site, "app", "public");
  const missing = path.join(support, "run", "site1", "mysql", "mysqld.sock");
  fs.mkdirSync(path.join(site, "conf", "mysql"), { recursive: true });
  fs.mkdirSync(wpRoot, { recursive: true });
  fs.writeFileSync(path.join(site, "conf", "mysql", "my.cnf.hbs"), "socket = {{socket}}\n");
  fs.mkdirSync(path.dirname(missing), { recursive: true });
  fs.writeFileSync(path.join(support, "sites.json"), JSON.stringify({ site1: { path: site } }));
  const resolved = resolveAlternateMysqlSocket(wpRoot, "/tmp/mysql.sock", ["/tmp/only-one.sock"], [support]);
  assert.equal(resolved.socketPath, null);
  assert.equal(resolved.configuredButMissing, missing);
  fs.rmSync(site, { recursive: true, force: true });
  fs.rmSync(support, { recursive: true, force: true });
});

test("resolveAlternateMysqlSocket accepts a tilde site path and an nginx root fallback", async () => {
  const layout = await createLocalRunLayout({ tildePath: true, nginxOnly: true });
  try {
    const resolved = resolveAlternateMysqlSocket(layout.wpRoot, "/tmp/mysql.sock", [], [layout.supportDir]);
    assert.equal(resolved.socketPath, layout.socketPath);
  } finally {
    await layout.cleanup();
  }
});
test("resolveAlternateMysqlSocket reports a configured socket that is not running", () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-site-"));
  const wpRoot = path.join(site, "app", "public");
  const missing = path.join(os.tmpdir(), `wp-agent-missing-${process.pid}.sock`);
  fs.mkdirSync(path.join(site, "conf", "mysql"), { recursive: true });
  fs.mkdirSync(wpRoot, { recursive: true });
  fs.writeFileSync(path.join(site, "conf", "mysql", "my.cnf"), `socket=${missing}\n`);
  const resolved = resolveAlternateMysqlSocket(wpRoot, "/tmp/mysql.sock", ["/tmp/only-one.sock"], []);
  assert.equal(resolved.socketPath, null);
  assert.equal(resolved.configuredButMissing, missing);
  fs.rmSync(site, { recursive: true, force: true });
});

test("query_wp_db_readonly retries a Local socket instead of decoding the database error page", async () => {
  const fixture = await createLocalFixture();
  clearDiscoveredMysqlSocketCache();
  const service = createWpDbReadService({
    wpCli: fixture.wpBin,
    config: createConfigService(fixture.wpRoot)
  });
  try {
    const result = service.queryReadonlySelect({
      wpRoot: fixture.wpRoot,
      sql: "SELECT COUNT(*) AS total FROM wp_posts WHERE post_status = 'publish'"
    });
    assert.equal(result.tablePrefix, "wp_");
    assert.deepEqual(result.columns, ["total"]);
    assert.equal(result.stdout, "3");
    const iniDirName = crypto.createHash("sha256").update(fixture.socketPath).digest("hex").slice(0, 16);
    const ini = fs.readFileSync(path.join(os.tmpdir(), "wp-agent-mcp-mysql-socket", iniDirName, "socket.ini"), "utf8");
    assert.match(ini, /mysqli\.default_socket/);
    assert.match(ini, /pdo_mysql\.default_socket/);
    assert.ok(ini.includes(fixture.socketPath));
  } finally {
    clearDiscoveredMysqlSocketCache();
    await fixture.cleanup();
  }
});

test("query_wp_db_readonly returns the connection error when no site socket exists", () => {
  const wpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-wp-"));
  fs.writeFileSync(path.join(wpRoot, "wp-config.php"), "<?php\n");
  const wpBin = writeFakeWp(`#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "config" ]; then
    printf 'wp_\\n'
    exit 0
  fi
  if [ "$arg" = "eval" ]; then
    printf '%s\\n' '<!DOCTYPE html><html><body>Error establishing a database connection</body></html>'
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
    assert.throws(
      () => service.queryReadonlySelect({
        wpRoot,
        sql: "SELECT COUNT(*) AS total FROM wp_posts WHERE post_status = 'publish'"
      }),
      (err: unknown) => err instanceof AppError && err.code === "DB_UNREACHABLE"
    );
  } finally {
    clearDiscoveredMysqlSocketCache();
    fs.rmSync(wpRoot, { recursive: true, force: true });
    fs.rmSync(wpBin, { force: true });
  }
});

test("query_wp_db_readonly still uses wp eval when the mysql binary is missing", () => {
  const wpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-wp-"));
  fs.writeFileSync(path.join(wpRoot, "wp-config.php"), "<?php\n");
  const wpBin = writeFakeWp(`#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "query" ]; then
    echo "Failed to get current SQL modes. Reason: env: mysql: No such file or directory" >&2
    exit 1
  fi
  if [ "$arg" = "eval" ]; then
    if printf '%s' "$*" | grep -q base64_decode; then
      printf 'dG90YWw=\\nMw==\\n'
      exit 0
    fi
    printf 'wp_\\n'
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
  try {
    const result = service.queryReadonlySelect({
      wpRoot,
      sql: "SELECT COUNT(*) AS total FROM wp_posts WHERE post_status = 'publish'"
    });
    assert.equal(result.tablePrefix, "wp_");
    assert.deepEqual(result.columns, ["total"]);
    assert.equal(result.stdout, "3");
  } finally {
    clearDiscoveredMysqlSocketCache();
    fs.rmSync(wpRoot, { recursive: true, force: true });
    fs.rmSync(wpBin, { force: true });
  }
});

test("runWpCli surfaces a socket failure instead of returning the HTML page", () => {
  const wpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-wp-"));
  const wpBin = writeFakeWp(`#!/bin/sh
printf '%s\\n' '<!DOCTYPE html><html>Error establishing a database connection</html>'
exit 0
`);
  clearDiscoveredMysqlSocketCache();
  try {
    assert.throws(
      () => runWpCli(wpRoot, ["eval", "echo 1;"], wpBin),
      (err: unknown) => err instanceof AppError && err.code === "DB_UNREACHABLE"
    );
  } finally {
    clearDiscoveredMysqlSocketCache();
    fs.rmSync(wpRoot, { recursive: true, force: true });
    fs.rmSync(wpBin, { force: true });
  }
});

async function createLocalFixture(): Promise<{
  wpRoot: string;
  wpBin: string;
  socketPath: string;
  cleanup: () => Promise<void>;
}> {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-local-"));
  const wpRoot = path.join(site, "app", "public");
  const socketPath = path.join(os.tmpdir(), `wp-agent ${process.pid}.sock`);
  fs.mkdirSync(wpRoot, { recursive: true });
  fs.writeFileSync(path.join(wpRoot, "wp-config.php"), "<?php\n");
  fs.mkdirSync(path.join(site, "conf", "mysql"), { recursive: true });
  fs.writeFileSync(path.join(site, "conf", "mysql", "my.cnf"), `[client]\nsocket = "${socketPath}"\n`);
  const server = await listenSocket(socketPath);
  const wpBin = writeFakeWp(`#!/bin/sh
EXPECTED='${socketPath.replace(/'/gu, "'\\''")}'
if [ "$MYSQL_UNIX_PORT" = "$EXPECTED" ]; then
  printf '%s' "$PHP_INI_SCAN_DIR" | grep -q wp-agent-mcp-mysql-socket || exit 3
  for arg in "$@"; do
    if [ "$arg" = "eval" ]; then
      printf 'wp_\\n'
      exit 0
    fi
    if [ "$arg" = "query" ]; then
      printf 'total\\n3\\n'
      exit 0
    fi
  done
  exit 0
fi
for arg in "$@"; do
  if [ "$arg" = "eval" ]; then
    printf '%s\\n' '<!DOCTYPE html><html><body>Error establishing a database connection</body></html>'
    exit 0
  fi
done
echo "${SOCKET_STDERR}" >&2
exit 1
`);
  return {
    wpRoot,
    wpBin,
    socketPath,
    cleanup: async () => {
      server.close();
      fs.rmSync(socketPath, { force: true });
      fs.rmSync(site, { recursive: true, force: true });
      fs.rmSync(wpBin, { force: true });
    }
  };
}

async function createLocalRunLayout(options: { tildePath?: boolean; nginxOnly?: boolean } = {}): Promise<{
  wpRoot: string;
  supportDir: string;
  socketPath: string;
  cleanup: () => Promise<void>;
}> {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-local-site-"));
  const supportDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-agent-local-support-"));
  const wpRoot = path.join(site, "app", "public");
  const socketPath = path.join(os.tmpdir(), `wp-agent-run-${process.pid}-${crypto.randomBytes(2).toString("hex")}.sock`);
  const runDir = path.join(supportDir, "run", "site1");
  fs.mkdirSync(path.join(site, "conf", "mysql"), { recursive: true });
  fs.mkdirSync(wpRoot, { recursive: true });
  fs.writeFileSync(path.join(site, "conf", "mysql", "my.cnf.hbs"), "[client]\nsocket = {{socket}}\n");
  fs.mkdirSync(path.join(runDir, "conf", "mysql"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "conf", "nginx"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "conf", "mysql", "my.cnf"), `[client]\nsocket = "${socketPath}"\n`);
  fs.writeFileSync(path.join(runDir, "conf", "nginx", "site.conf"), `root "${wpRoot}";\n`);
  const relativeToHome = path.relative(os.homedir(), site);
  const listedPath = options.tildePath ? `~/${relativeToHome}` : site;
  const sites = options.nginxOnly ? {} : { site1: { path: listedPath } };
  fs.writeFileSync(path.join(supportDir, "sites.json"), JSON.stringify(sites));
  const server = await listenSocket(socketPath);
  return {
    wpRoot,
    supportDir,
    socketPath,
    cleanup: async () => {
      server.close();
      fs.rmSync(socketPath, { force: true });
      fs.rmSync(site, { recursive: true, force: true });
      fs.rmSync(supportDir, { recursive: true, force: true });
    }
  };
}

function writeFakeWp(script: string): string {
  const filePath = path.join(os.tmpdir(), `wp-agent-fake-wp-${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(filePath, script, { mode: 0o755 });
  return filePath;
}

function listenSocket(socketPath: string): Promise<net.Server> {
  fs.rmSync(socketPath, { force: true });
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}
