import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type MysqlSocketSource = "site-config" | "well-known";

export type MysqlSocketResolution = {
  socketPath: string | null;
  source: MysqlSocketSource | null;
  /** Socket named by this site's MySQL config when that file is not present. */
  configuredButMissing: string | null;
  /** More than one global socket exists, so none was chosen. */
  ambiguousSockets: string[];
  /** Local site layout was found, but its run directory could not be mapped. */
  unresolvedLocalSite?: boolean;
};

const SITE_CNF_WALK_LIMIT = 6;

/**
 * WP-CLI prefixes every preliminary mysql failure with this sentence, including
 * auth errors and wrong sockets. Only an absent mysql binary should match.
 */
export function isMissingMysqlClientMessage(stderr: string): boolean {
  if (isMysqlSocketConnectFailure(stderr)) {
    return false;
  }
  const text = stderr.toLowerCase();
  return (
    text.includes("env: mysql:")
    || text.includes("mysql: command not found")
    || text.includes("mysql: not found")
    || /(?:^|[\s:])mysql: no such file or directory/iu.test(stderr)
  );
}

export function isMysqlSocketConnectFailure(stderr: string): boolean {
  return /can't connect to local (?:mysql|mariadb) server through socket/iu.test(stderr)
    || /error\s+2002\b/iu.test(stderr);
}

/**
 * A site-specific socket (Local's run directory, or that site's my.cnf) is safe
 * to attach after a database error page. A machine-wide socket is only safe when
 * the client reported a socket failure; otherwise a stopped TCP port or a bad
 * password would be retried against a different MySQL server.
 */
export function shouldAttachResolvedSocket(
  resolution: MysqlSocketResolution,
  stderr: string
): boolean {
  if (!resolution.socketPath) {
    return false;
  }
  if (resolution.source === "site-config") {
    return true;
  }
  return isMysqlSocketConnectFailure(stderr);
}

export function socketPathFromConnectFailure(stderr: string): string | null {
  const match = /through socket ['"]([^'"]+)['"]/iu.exec(stderr);
  const socketPath = match?.[1]?.trim();
  return socketPath ? socketPath : null;
}

/**
 * `wp eval` exits 0 when WordPress hits `dead_db()` or a custom `db-error.php`.
 * That page is not a query result.
 */
export function isWordpressDatabaseErrorDocument(stdout: string): boolean {
  const trimmed = stdout.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.includes("error establishing a database connection")) {
    return true;
  }
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

export function parseMysqlSocketFromCnf(contents: string): string | null {
  let socketPath: string | null = null;
  for (const line of contents.split(/\r?\n/u)) {
    const stripped = line.trim();
    if (stripped.length === 0 || stripped.startsWith("#") || stripped.startsWith(";")) {
      continue;
    }
    const match = /^(?:socket|mysql_socket)\s*=\s*(.+)$/iu.exec(stripped);
    if (!match?.[1]) {
      continue;
    }
    const value = unquoteCnfValue(match[1].trim());
    if (value.length > 0 && !value.includes("{{")) {
      socketPath = value;
    }
  }
  return socketPath;
}

export function findSiteMysqlCnf(wpRoot: string): string | null {
  let current = path.resolve(wpRoot);
  for (let depth = 0; depth < SITE_CNF_WALK_LIMIT; depth += 1) {
    const candidate = path.join(current, "conf", "mysql", "my.cnf");
    if (isReadableFile(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export function listWellKnownMysqlSockets(): string[] {
  const candidates: string[] = [];

  if (process.platform === "darwin") {
    const home = os.homedir();
    candidates.push(
      "/Applications/MAMP/tmp/mysql/mysql.sock",
      "/opt/homebrew/var/mysql/mysql.sock",
      "/usr/local/var/mysql/mysql.sock",
      "/Applications/XAMPP/xamppfiles/var/mysql/mysql.sock",
      path.join(home, "Library/Application Support/Herd/config/mysql/mysql.sock")
    );
  } else if (process.platform === "linux") {
    candidates.push(
      "/var/run/mysqld/mysqld.sock",
      "/run/mysqld/mysqld.sock",
      "/tmp/mysql.sock",
      "/var/lib/mysql/mysql.sock"
    );
  }

  const sockets: string[] = [];
  for (const candidate of candidates) {
    if (isUnixSocket(candidate)) {
      sockets.push(candidate);
    }
  }
  return sockets;
}

export function listWellKnownMysqlCnfSockets(): string[] {
  if (process.platform !== "darwin") {
    return [];
  }
  const home = os.homedir();
  const cnfPaths = [
    path.join(home, "Library/Application Support/Herd/config/mysql/my.cnf")
  ];
  const sockets: string[] = [];
  for (const cnfPath of cnfPaths) {
    const socketPath = socketFromCnfFile(cnfPath);
    if (socketPath && isUnixSocket(socketPath)) {
      sockets.push(socketPath);
    }
  }
  return sockets;
}

export function defaultLocalSupportDirs(): string[] {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      path.join(home, "Library/Application Support/Local"),
      path.join(home, "Library/Application Support/Local by Flywheel")
    ];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    return appData ? [path.join(appData, "Local")] : [];
  }
  return [path.join(home, ".config/Local")];
}

/**
 * Local writes `conf/mysql/my.cnf.hbs` with `socket = {{socket}}`. The live
 * socket is under Local's Application Support `run/<site-id>/` directory.
 */
export function resolveLocalFlywheelSocket(
  wpRoot: string,
  supportDirs: string[]
): MysqlSocketResolution | null {
  const siteRoot = findLocalSiteRoot(wpRoot);
  if (!siteRoot) {
    return null;
  }

  const siteCanonical = canonicalDir(siteRoot);
  for (const supportDir of supportDirs) {
    const listed = readLocalSites(supportDir).find((site) => canonicalDir(site.sitePath) === siteCanonical);
    const runId = listed?.id ?? findRunIdByNginxRoot(supportDir, wpRoot);
    if (!runId) {
      continue;
    }
    const found = socketFromLocalRunDir(path.join(supportDir, "run", runId));
    if (found.socketPath) {
      return {
        socketPath: found.socketPath,
        source: "site-config",
        configuredButMissing: null,
        ambiguousSockets: []
      };
    }
    return {
      socketPath: null,
      source: null,
      configuredButMissing: found.configuredButMissing,
      ambiguousSockets: []
    };
  }

  return {
    socketPath: null,
    source: null,
    configuredButMissing: null,
    ambiguousSockets: [],
    unresolvedLocalSite: true
  };
}

/**
 * Prefer the MySQL socket for this WordPress root. Local sites resolve through
 * their run directory. A rendered `conf/mysql/my.cnf` is next. A global socket
 * is used only when it is the single candidate, so a machine with both MAMP and
 * Homebrew is not guessed.
 */
export function resolveAlternateMysqlSocket(
  wpRoot: string,
  failedSocket: string | null,
  wellKnownSockets: string[] = uniqueSockets([
    ...listWellKnownMysqlCnfSockets(),
    ...listWellKnownMysqlSockets()
  ]),
  localSupportDirs: string[] = defaultLocalSupportDirs()
): MysqlSocketResolution {
  const localSocket = resolveLocalFlywheelSocket(wpRoot, localSupportDirs);
  if (localSocket) {
    if (localSocket.socketPath && sameSocket(localSocket.socketPath, failedSocket)) {
      return {
        socketPath: null,
        source: null,
        configuredButMissing: null,
        ambiguousSockets: []
      };
    }
    return localSocket;
  }

  const siteCnf = findSiteMysqlCnf(wpRoot);
  if (siteCnf) {
    const configured = socketFromCnfFile(siteCnf);
    if (configured && sameSocket(configured, failedSocket)) {
      return {
        socketPath: null,
        source: null,
        configuredButMissing: isUnixSocket(configured) ? null : configured,
        ambiguousSockets: []
      };
    }
    if (configured && isUnixSocket(configured)) {
      return {
        socketPath: configured,
        source: "site-config",
        configuredButMissing: null,
        ambiguousSockets: []
      };
    }
    if (configured) {
      return {
        socketPath: null,
        source: null,
        configuredButMissing: configured,
        ambiguousSockets: []
      };
    }
  }

  const alternates = uniqueSockets(wellKnownSockets).filter((socketPath) => !sameSocket(socketPath, failedSocket));
  if (alternates.length === 1) {
    return {
      socketPath: alternates[0] ?? null,
      source: "well-known",
      configuredButMissing: null,
      ambiguousSockets: []
    };
  }

  return {
    socketPath: null,
    source: null,
    configuredButMissing: null,
    ambiguousSockets: alternates
  };
}

function findLocalSiteRoot(wpRoot: string): string | null {
  let current = path.resolve(wpRoot);
  for (let depth = 0; depth < SITE_CNF_WALK_LIMIT; depth += 1) {
    if (isReadableFile(path.join(current, "conf", "mysql", "my.cnf.hbs"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function canonicalDir(inputPath: string): string {
  const resolved = path.resolve(expandHome(inputPath));
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isSafeRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(id);
}

function readLocalSites(localDir: string): Array<{ id: string; sitePath: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(localDir, "sites.json"), "utf8")) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const sites: Array<{ id: string; sitePath: string }> = [];
  for (const [id, site] of Object.entries(parsed)) {
    if (!isSafeRunId(id) || !site || typeof site !== "object") {
      continue;
    }
    const sitePath = (site as { path?: unknown }).path;
    if (typeof sitePath !== "string" || sitePath.trim().length === 0) {
      continue;
    }
    sites.push({ id, sitePath });
  }
  return sites;
}

function socketFromLocalRunDir(runDir: string): { socketPath: string | null; configuredButMissing: string | null } {
  const fromCnf = socketFromCnfFile(path.join(runDir, "conf", "mysql", "my.cnf"));
  const configured = fromCnf ?? path.join(runDir, "mysql", "mysqld.sock");
  if (isUnixSocket(configured)) {
    return { socketPath: configured, configuredButMissing: null };
  }
  return { socketPath: null, configuredButMissing: configured };
}

function findRunIdByNginxRoot(localDir: string, wpRoot: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(localDir, "run"), { withFileTypes: true });
  } catch {
    return null;
  }
  const wpCanonical = canonicalDir(wpRoot);
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeRunId(entry.name)) {
      continue;
    }
    let contents: string;
    try {
      contents = fs.readFileSync(path.join(localDir, "run", entry.name, "conf", "nginx", "site.conf"), "utf8");
    } catch {
      continue;
    }
    const match = /^\s*root\s+["']([^"']+)["']/mu.exec(contents);
    if (match?.[1] && canonicalDir(match[1]) === wpCanonical) {
      return entry.name;
    }
  }
  return null;
}

function unquoteCnfValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function socketFromCnfFile(cnfPath: string): string | null {
  if (!isReadableFile(cnfPath)) {
    return null;
  }
  try {
    return parseMysqlSocketFromCnf(fs.readFileSync(cnfPath, "utf8"));
  } catch {
    return null;
  }
}

function isReadableFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isUnixSocket(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isSocket();
  } catch {
    return false;
  }
}

function sameSocket(candidate: string, failedSocket: string | null): boolean {
  if (!failedSocket) {
    return false;
  }
  return path.resolve(candidate) === path.resolve(failedSocket);
}

function uniqueSockets(sockets: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const socketPath of sockets) {
    const resolved = path.resolve(socketPath);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    unique.push(socketPath);
  }
  return unique;
}
