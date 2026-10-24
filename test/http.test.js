"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { createApp } = require("../app");
const { loadConfig } = require("../src/env");
const { JsonFileStore } = require("../src/store");
const { DEFAULT_CONFIG } = require("../src/presence");

const silent = { log() {}, warn() {}, error() {} };
const DASHBOARD_KEY = "test-dashboard-key";

class FakeBot extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.state = {
      enabled: false,
      status: "disabled",
      connected: false,
      tag: null,
      id: null,
      error: "Bot disabled (test).",
      lastAppliedAt: null,
      lastActivity: null,
      uptimeSeconds: 3,
      pending: false
    };
  }

  getState() {
    return { ...this.state };
  }

  setPresence(config) {
    this.calls.push({ type: "set", config });
  }

  clearPresence(status) {
    this.calls.push({ type: "clear", status });
  }
}

/** Minimal cookie jar on top of fetch. */
function createClient(base) {
  const jar = new Map();

  return async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (jar.size > 0) {
      headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    const response = await fetch(base + pathname, {
      ...options,
      headers,
      redirect: "manual"
    });

    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }

    return response;
  };
}

function csrfFrom(html) {
  const match = html.match(/name="csrf-token" content="([^"]+)"/);
  assert.ok(match, "expected a CSRF meta tag");
  return match[1];
}

async function startApp(envOverrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-http-"));
  const config = loadConfig({
    NODE_ENV: "test",
    CLIENT_ID: "1554342719923560518",
    SESSION_SECRET: "s".repeat(40),
    DASHBOARD_KEY,
    BOT_ENABLED: "false",
    ...envOverrides
  });
  const store = new JsonFileStore(path.join(dataDir, "config.json"), {
    defaults: DEFAULT_CONFIG,
    logger: silent
  });
  const bot = new FakeBot();
  const app = createApp({ config, store, bot, logger: silent });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = createClient(base);

  async function signIn() {
    const loginPage = await request("/login");
    const html = await loginPage.text();
    await request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: DASHBOARD_KEY, _csrf: csrfFrom(html) })
    });
    const state = await (await request("/api/state")).json();
    return state.csrf;
  }

  return {
    config,
    store,
    bot,
    server,
    base,
    request,
    signIn,
    async close() {
      app.locals.closeStreams();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

test("health endpoint reports ok", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const res = await ctx.request("/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.storage, "ok");
});

test("dashboard and API require authentication", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const root = await ctx.request("/");
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/login");

  const api = await ctx.request("/api/state");
  assert.equal(api.status, 401);
  assert.equal((await api.json()).ok, false);
});

test("login page renders with a CSRF token", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const res = await ctx.request("/login");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Dashboard key/);
  assert.equal(csrfFrom(html).length, 48);
  assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
});

test("login rejects a missing CSRF token", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const res = await ctx.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: DASHBOARD_KEY })
  });
  assert.equal(res.status, 403);
});

test("login rejects the wrong key", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const html = await (await ctx.request("/login")).text();
  const res = await ctx.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: "nope", _csrf: csrfFrom(html) })
  });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /error=invalid/);
});

test("a signed-in session can read state and load the dashboard", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const csrf = await ctx.signIn();
  const state = await (await ctx.request("/api/state")).json();
  assert.equal(state.ok, true);
  assert.equal(state.user.role, "admin");
  assert.equal(state.presence.name, DEFAULT_CONFIG.name);
  assert.equal(state.meta.clientId, "1554342719923560518");

  const page = await ctx.request("/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Live preview/);
  assert.match(html, /scope=bot/);
  assert.equal(csrfFrom(html), csrf);
});

test("presence updates are validated, persisted and pushed to the bot", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const invalid = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ name: "x", type: 1, url: "https://example.com" })
  });
  assert.equal(invalid.status, 400);
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.ok, false);
  assert.match(invalidBody.error, /Stream URL/);
  assert.equal(ctx.bot.calls.length, 0);

  const missingCsrf = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x" })
  });
  assert.equal(missingCsrf.status, 403);

  const valid = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({
      name: "Building StatusC0rd",
      type: 2,
      status: "dnd",
      details: "Line one",
      state: "Line two",
      startedAt: true
    })
  });
  assert.equal(valid.status, 200);
  const body = await valid.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.activity, {
    name: "Building StatusC0rd",
    type: 2,
    details: "Line one",
    state: "Line two",
    timestamps: { start: body.presence.startTimestamp }
  });

  assert.equal(ctx.store.get().name, "Building StatusC0rd");
  assert.equal(ctx.bot.calls.at(-1).type, "set");
  assert.equal(ctx.bot.calls.at(-1).config.status, "dnd");
});

test("clearing presence disables it and tells the bot", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const res = await ctx.request("/api/presence/clear", {
    method: "POST",
    headers: { "x-csrf-token": csrf }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.presence.enabled, false);
  assert.equal(body.activity, null);
  assert.deepEqual(ctx.bot.calls.at(-1), { type: "clear", status: "online" });
});

test("unknown API routes return JSON 404 and static assets are served", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const api = await ctx.request("/api/nope");
  assert.equal(api.status, 404);
  assert.equal((await api.json()).ok, false);

  const css = await ctx.request("/styles.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  assert.match(await css.text(), /--accent/);
});

test("discord sign-in redirects with a helpful error when not configured", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const res = await ctx.request("/auth/discord");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login?error=discord_disabled");
});

test("logout clears the session", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const res = await ctx.request("/logout", { method: "POST", headers: { "x-csrf-token": csrf } });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login");

  const state = await ctx.request("/api/state");
  assert.equal(state.status, 401);
});

test("discord sign-in builds a state-protected authorize URL", async (t) => {
  const ctx = await startApp({
    CLIENT_SECRET: "client-secret",
    ALLOWED_DISCORD_IDS: "123456789012345678"
  });
  t.after(() => ctx.close());

  const res = await ctx.request("/auth/discord");
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location"));
  assert.equal(location.origin + location.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(location.searchParams.get("client_id"), "1554342719923560518");
  assert.equal(location.searchParams.get("scope"), "identify");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.match(location.searchParams.get("redirect_uri"), /\/auth\/discord\/callback$/);
  assert.equal(location.searchParams.get("state").length, 48);

  const finalRedirect = await ctx.request("/auth/discord/callback?code=abc&state=tampered");
  assert.equal(finalRedirect.status, 302);
  assert.equal(finalRedirect.headers.get("location"), "/login?error=state");

  const loginPage = await ctx.request("/login");
  assert.match(await loginPage.text(), /data-discord-enabled="true"/);
});

test("oauth callback rejects a cancelled authorization", async (t) => {
  const ctx = await startApp({
    CLIENT_SECRET: "client-secret",
    ALLOWED_DISCORD_IDS: "123456789012345678"
  });
  t.after(() => ctx.close());

  const res = await ctx.request("/auth/discord/callback?error=access_denied");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login?error=cancelled");
});
