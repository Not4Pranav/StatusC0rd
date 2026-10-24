"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  loadConfig,
  validateConfig,
  warningsFor,
  isDiscordLoginEnabled,
  parseBool,
  parseIdList
} = require("../src/env");
const { createRenderer, escapeHtml } = require("../src/views");

const BASE_ENV = {
  CLIENT_ID: "1554342719923560518",
  SESSION_SECRET: "s".repeat(40),
  DASHBOARD_KEY: "a-long-dashboard-key",
  DISCORD_TOKEN: "token",
  NODE_ENV: "production",
  REDIRECT_URI: "https://example.com/auth/discord/callback"
};

test("parseBool understands common spellings", () => {
  assert.equal(parseBool("true"), true);
  assert.equal(parseBool("1"), true);
  assert.equal(parseBool("ON"), true);
  assert.equal(parseBool("false"), false);
  assert.equal(parseBool("0"), false);
  assert.equal(parseBool(undefined, true), true);
  assert.equal(parseBool("nonsense", true), true);
});

test("parseIdList splits, filters and dedupes", () => {
  assert.deepEqual(parseIdList("123456789012345678, 223456789012345678"), [
    "123456789012345678",
    "223456789012345678"
  ]);
  assert.deepEqual(parseIdList("123456789012345678 123456789012345678 abc 123"), [
    "123456789012345678"
  ]);
  assert.deepEqual(parseIdList(""), []);
});

test("loadConfig derives sane defaults", () => {
  const config = loadConfig({ NODE_ENV: "production", CLIENT_ID: "123456789" });
  assert.equal(config.isProduction, true);
  assert.equal(config.port, 3000);
  assert.equal(config.trustProxy, 1);
  assert.equal(config.botEnabled, true);
  assert.equal(config.redirectUri, "");
  assert.match(config.dataDir, /data$/);

  const dev = loadConfig({ NODE_ENV: "development" });
  assert.equal(dev.trustProxy, false);
});

test("validateConfig accepts a complete production environment", () => {
  assert.deepEqual(validateConfig(loadConfig(BASE_ENV)), []);
});

test("validateConfig reports every blocking problem", () => {
  const problems = validateConfig(
    loadConfig({
      NODE_ENV: "production",
      CLIENT_ID: "",
      SESSION_SECRET: "short",
      BOT_ENABLED: "true",
      DASHBOARD_KEY: ""
    })
  ).join("\n");

  assert.match(problems, /CLIENT_ID/);
  assert.match(problems, /SESSION_SECRET is too short/);
  assert.match(problems, /DISCORD_TOKEN is required/);
  assert.match(problems, /No sign-in method configured/);
});

test("a missing bot token is fatal only in production", () => {
  const production = validateConfig(loadConfig({ ...BASE_ENV, DISCORD_TOKEN: "" }));
  assert.match(production.join(" "), /DISCORD_TOKEN/);

  const development = validateConfig(loadConfig({ ...BASE_ENV, NODE_ENV: "development", DISCORD_TOKEN: "" }));
  assert.deepEqual(development, []);
  assert.match(warningsFor(loadConfig({ ...BASE_ENV, NODE_ENV: "development", DISCORD_TOKEN: "" })).join(" "), /dashboard-only/);
});

test("redirect URIs are validated", () => {
  assert.match(validateConfig(loadConfig({ ...BASE_ENV, REDIRECT_URI: "not a url" })).join(" "), /absolute URL/);
  assert.match(
    validateConfig(loadConfig({ ...BASE_ENV, REDIRECT_URI: "http://example.com/cb" })).join(" "),
    /https/
  );
});

test("Discord login requires both a client secret and an allowlist", () => {
  const withSecret = loadConfig({ ...BASE_ENV, CLIENT_SECRET: "secret" });
  assert.equal(isDiscordLoginEnabled(withSecret), false);
  assert.match(validateConfig(loadConfig({ ...BASE_ENV, ALLOWED_DISCORD_IDS: "123456789012345678" })).join(" "), /CLIENT_SECRET/);

  const full = loadConfig({
    ...BASE_ENV,
    CLIENT_SECRET: "secret",
    ALLOWED_DISCORD_IDS: "123456789012345678"
  });
  assert.equal(isDiscordLoginEnabled(full), true);
  assert.deepEqual(validateConfig(full), []);
});

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml("a & b"), "a &amp; b");
});

test("the template renderer escapes values and leaves unknown tokens empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-views-"));
  fs.writeFileSync(path.join(dir, "page.html"), "<p>{{GREETING}}</p><i>{{UNKNOWN}}</i>");
  const render = createRenderer(dir, { cache: false });
  assert.equal(render("page.html", { GREETING: "<b>hi</b>" }), "<p>&lt;b&gt;hi&lt;/b&gt;</p><i></i>");
});
