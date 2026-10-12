#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");

const serverEntrypoint = path.resolve(__dirname, "../dist/server.js");

if (!fs.existsSync(serverEntrypoint)) {
  console.error(
    "[wp-agent-mcp] Build output missing at dist/server.js. Run `npm run build` before starting the package."
  );
  process.exit(1);
}

const packageRoot = path.resolve(__dirname, "..");

function verifyNativeModules() {
  try {
    require(path.join(packageRoot, "node_modules/better-sqlite3"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("NODE_MODULE_VERSION")) {
      throw error;
    }

    console.error("[wp-agent-mcp] Native module ABI mismatch for better-sqlite3.");
    console.error(
      `[wp-agent-mcp] This MCP process is running ${process.version} (ABI ${process.versions.modules}).`
    );
    console.error(
      "[wp-agent-mcp] better-sqlite3 must be rebuilt with the same Node binary that starts MCP."
    );
    console.error("[wp-agent-mcp] Fix options:");
    console.error(
      `  1) Rebuild: cd ${packageRoot} && npm rebuild better-sqlite3   (using the same node as MCP)`
    );
    console.error(
      `  2) Pin Node in ~/.cursor/mcp.json: "command": "${process.execPath}"`
    );
    console.error(
      "  3) After changing Node major: rm -rf node_modules && npm ci && npm run build"
    );
    process.exit(1);
  }
}

verifyNativeModules();

require(serverEntrypoint);
