import assert from "node:assert/strict";
import test from "node:test";
import {
  contextFromConfigPrefix,
  parseWpTableContext,
  rewriteSqlTableNames,
  synthesizeWpTableContext,
  WP_AGENT_TABLES_MARKER
} from "./wpTableNames";

const custom = synthesizeWpTableContext("xyz_", "xyz_");

test("rewriteSqlTableNames maps core tables and leaves literals, comments, and plugin wp_ names", () => {
  const sql = [
    "SELECT 'wp_posts' AS label, \"{prefix}gf_entry\" AS quoted",
    "/* wp_posts {prefix}no */",
    "FROM wp_posts",
    "JOIN wp_postmeta ON wp_postmeta.post_id = wp_posts.ID",
    "JOIN wp_gf_entry ON wp_gf_entry.id = wp_posts.ID",
    "JOIN `{prefix}gf_entry`",
    "WHERE post_type = 'page' -- wp_posts {prefix}keep"
  ].join("\n");

  const result = rewriteSqlTableNames(sql, custom);

  assert.match(result.sql, /SELECT 'wp_posts' AS label, "\{prefix\}gf_entry" AS quoted/);
  assert.match(result.sql, /\/\* wp_posts \{prefix\}no \*\//);
  assert.match(result.sql, /-- wp_posts \{prefix\}keep/);
  assert.match(result.sql, /FROM xyz_posts/);
  assert.match(result.sql, /JOIN xyz_postmeta ON xyz_postmeta\.post_id = xyz_posts\.ID/);
  assert.match(result.sql, /JOIN wp_gf_entry ON wp_gf_entry\.id = xyz_posts\.ID/);
  assert.match(result.sql, /JOIN `xyz_gf_entry`/);
  assert.deepEqual(result.tablesRewritten, {
    wp_posts: "xyz_posts",
    wp_postmeta: "xyz_postmeta",
    "{prefix}gf_entry": "xyz_gf_entry"
  });
});

test("rewriteSqlTableNames keeps the default prefix unchanged and still expands {prefix}", () => {
  const result = rewriteSqlTableNames(
    "SELECT ID FROM wp_posts JOIN {prefix}gf_entry",
    synthesizeWpTableContext("wp_", "wp_")
  );
  assert.equal(result.sql, "SELECT ID FROM wp_posts JOIN wp_gf_entry");
  assert.deepEqual(result.tablesRewritten, {
    "{prefix}gf_entry": "wp_gf_entry"
  });
});

test("rewriteSqlTableNames does not treat a longer identifier as a core table", () => {
  const result = rewriteSqlTableNames(
    "SELECT ID FROM wp_posts_archive JOIN wp_term_relationships",
    custom
  );
  assert.equal(result.sql, "SELECT ID FROM wp_posts_archive JOIN xyz_term_relationships");
  assert.deepEqual(result.tablesRewritten, {
    wp_term_relationships: "xyz_term_relationships"
  });
});

test("rewriteSqlTableNames follows a filtered $wpdb posts name", () => {
  const parsed = parseWpTableContext(
    `notice before\n${WP_AGENT_TABLES_MARKER}{"prefix":"xyz_","basePrefix":"wp_","tables":{"posts":"custom_content","users":"wp_users"}}`
  );
  assert.ok(parsed);
  assert.equal(parsed.tablePrefix, "xyz_");
  assert.equal(parsed.basePrefix, "wp_");
  assert.equal(parsed.tables.posts, "custom_content");
  assert.equal(parsed.tables.users, "wp_users");
  assert.equal(parsed.tables.postmeta, "xyz_postmeta");

  const result = rewriteSqlTableNames("SELECT ID FROM WP_POSTS JOIN wp_users", parsed);
  assert.equal(result.sql, "SELECT ID FROM custom_content JOIN wp_users");
  assert.deepEqual(result.tablesRewritten, {
    WP_POSTS: "custom_content"
  });
});

test("contextFromConfigPrefix separates multisite blog tables from network tables", () => {
  const context = contextFromConfigPrefix("wp_", 2);
  assert.equal(context.tablePrefix, "wp_2_");
  assert.equal(context.basePrefix, "wp_");
  assert.equal(context.tables.posts, "wp_2_posts");
  assert.equal(context.tables.options, "wp_2_options");
  assert.equal(context.tables.users, "wp_users");
  assert.equal(context.tables.usermeta, "wp_usermeta");
  assert.equal(context.tables.blogs, "wp_blogs");

  const result = rewriteSqlTableNames("SELECT ID FROM wp_posts JOIN wp_users", context);
  assert.equal(result.sql, "SELECT ID FROM wp_2_posts JOIN wp_users");
  assert.deepEqual(result.tablesRewritten, {
    wp_posts: "wp_2_posts"
  });
});

test("parseWpTableContext accepts a bare prefix and an explicit empty prefix", () => {
  const bare = parseWpTableContext("  wp_ \n");
  assert.equal(bare?.tablePrefix, "wp_");
  assert.equal(bare?.tables.posts, "wp_posts");

  const empty = parseWpTableContext(`${WP_AGENT_TABLES_MARKER}{"prefix":"","basePrefix":"","tables":{}}`);
  assert.equal(empty?.tablePrefix, "");
  assert.equal(empty?.tables.posts, "posts");
  const rewritten = rewriteSqlTableNames("SELECT ID FROM wp_posts JOIN {prefix}gf_entry", empty!);
  assert.equal(rewritten.sql, "SELECT ID FROM posts JOIN gf_entry");
});
