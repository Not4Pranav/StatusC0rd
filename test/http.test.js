"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { createApp } = require("../app");
const { SettingsStore } = require("../src/settings");
const { AssetStore } = require("../src/assets");

const silent = { log() {}, warn() {}, error() {} };
const ADMIN_KEY = "integration-test-key";
const PUBLIC_URL = "https://status.example.com";

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
      error: null,
      note: "No bot token configured - dashboard-only mode.",
      lastAppliedAt: null,
      lastActivity: null,
      uptimeSeconds: 12,
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
  async reconfigure({ token }) {
    this.calls.push({ type: "reconfigure", token });
    return this.getState();
  }
}

function createClient(base) {
  const jar = new Map();
  return async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(base + pathname, { ...options, headers, redirect: "manual" });
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

const csrfFrom = (html) => {
  const match = html.match(/name="csrf-token" content="([^"]+)"/);
  assert.ok(match, "expected a CSRF meta tag");
  return match[1];
};

async function startApp({ env = {}, completeSetup = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-http-"));
  const settings = new SettingsStore(path.join(dataDir, "settings.json"), { env, logger: silent });
  const assets = new AssetStore(path.join(dataDir, "assets"), settings);
  const bot = new FakeBot();
  const app = createApp({ settings, assets, bot, logger: silent, version: "2.1.0" });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = createClient(base);

  const setupToken = settings.setupToken;

  async function signIn(key = ADMIN_KEY) {
    const page = await request("/login");
    const html = await page.text();
    await request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key, _csrf: csrfFrom(html) })
    });
    const state = await (await request("/api/state")).json();
    return state.csrf;
  }

  if (completeSetup) {
    settings.setAdminKey(ADMIN_KEY);
    settings.update({ publicUrl: PUBLIC_URL });
    settings.completeSetup();
  }

  return {
    settings,
    assets,
    bot,
    server,
    base,
    request,
    signIn,
    setupToken,
    async close() {
      app.locals.closeStreams();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

const zlib = require("node:zlib");

/** Build a valid RGB PNG (Discord's minimum is 16x16). */
function makePng(width = 64, height = 64) {
  const row = Buffer.alloc(width * 3 + 1, 0);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = 88;
    row[2 + x * 3] = 101;
    row[3 + x * 3] = 242;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, crcBuffer]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const PNG_DATA_URL = `data:image/png;base64,${makePng().toString("base64")}`;

test("health reports setup state", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  const res = await ctx.request("/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.setup, "required");
});

test("a fresh instance redirects to the setup wizard", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  const root = await ctx.request("/");
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/setup");

  const login = await ctx.request("/login");
  assert.equal(login.headers.get("location"), "/setup");

  const setup = await ctx.request("/setup");
  assert.equal(setup.status, 200);
  const html = await setup.text();
  assert.match(html, /Create your dashboard login/);
  assert.match(setup.headers.get("content-security-policy"), /default-src 'self'/);
});

test("setup is rejected without a valid token from a non-local client", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  // Requests come from 127.0.0.1 in tests, so simulate a public client by
  // requiring the token explicitly.
  const previous = process.env.SETUP_REQUIRE_TOKEN;
  process.env.SETUP_REQUIRE_TOKEN = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.SETUP_REQUIRE_TOKEN;
    else process.env.SETUP_REQUIRE_TOKEN = previous;
  });

  const blocked = await ctx.request("/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminKey: "a-long-dashboard-key" })
  });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).needsToken, true);

  const wrong = await ctx.request("/api/setup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "nope" })
  });
  assert.equal(wrong.status, 403);

  const verified = await ctx.request("/api/setup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: ctx.setupToken })
  });
  assert.equal(verified.status, 200);
});

test("the wizard configures the instance end to end", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  const upload = await ctx.request("/api/setup/asset", {
    method: "POST",
    headers: { "content-type": "application/json", "x-setup-token": ctx.setupToken },
    body: JSON.stringify({ dataUrl: PNG_DATA_URL, name: "logo.png" })
  });
  assert.equal(upload.status, 200);
  const asset = (await upload.json()).asset;

  const complete = await ctx.request("/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-setup-token": ctx.setupToken },
    body: JSON.stringify({
      adminKey: "a-long-dashboard-key",
      publicUrl: "https://demo.example.com",
      keepAlive: true,
      discord: { clientId: "1554342719923560518", clientSecret: "", allowedIds: [] },
      presence: {
        name: "Hello from the wizard",
        type: 0,
        details: "line one",
        largeImage: `asset:${asset.id}`,
        targets: { bot: true, companion: true }
      }
    })
  });
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).redirect, "/");

  // Setup is now closed and the session is signed in.
  const state = await (await ctx.request("/api/state")).json();
  assert.equal(state.user.role, "admin");
  assert.equal(state.meta.setupComplete, true);
  assert.equal(state.presence.name, "Hello from the wizard");
  assert.equal(state.assets.length, 1);

  const reopen = await ctx.request("/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminKey: "another-key-123456" })
  });
  assert.equal(reopen.status, 200, "an authenticated admin may re-run setup");

  const anonymous = createClient(ctx.base);
  const blocked = await anonymous("/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminKey: "hijack-attempt-123" })
  });
  assert.equal(blocked.status, 403);
});

test("setup requires a strong dashboard key", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  const res = await ctx.request("/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-setup-token": ctx.setupToken },
    body: JSON.stringify({ adminKey: "short" })
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at least 12/);
});

test("dashboard requires authentication", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  assert.equal((await ctx.request("/")).status, 302);
  assert.equal((await ctx.request("/api/state")).status, 401);
});

test("login rejects bad keys and missing CSRF tokens", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const noCsrf = await ctx.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: ADMIN_KEY })
  });
  assert.equal(noCsrf.status, 403);

  const page = await (await ctx.request("/login")).text();
  const wrong = await ctx.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: "wrong", _csrf: csrfFrom(page) })
  });
  assert.equal(wrong.status, 303);
  assert.match(wrong.headers.get("location"), /error=invalid/);
});

test("a signed-in admin can load the dashboard and state", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const state = await (await ctx.request("/api/state")).json();
  assert.equal(state.user.role, "admin");
  assert.equal(state.csrf, csrf);
  assert.equal(state.meta.publicUrl, PUBLIC_URL);

  const page = await ctx.request("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Logout|Sign out/);
});

test("presence updates validate, persist and reach the bot", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const invalid = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ name: "x", type: 1, url: "https://example.com" })
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Stream URL/);

  const valid = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({
      name: "Shipping photos",
      type: 0,
      details: "with images",
      largeImage: "https://cdn.example.com/a.png",
      startedAt: true,
      targets: { bot: true, companion: true }
    })
  });
  assert.equal(valid.status, 200);
  const saved = (await valid.json()).presence;
  assert.equal(saved.name, "Shipping photos");
  assert.equal(ctx.settings.get().presence.name, "Shipping photos");
  assert.equal(ctx.bot.calls.at(-1).type, "set");

  const cleared = await ctx.request("/api/presence/clear", {
    method: "POST",
    headers: { "x-csrf-token": csrf }
  });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).presence.enabled, false);
  assert.deepEqual(ctx.bot.calls.at(-1), { type: "clear", status: "online" });
});

test("assets upload, serve and delete", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const upload = await ctx.request("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ dataUrl: PNG_DATA_URL, name: "logo.png" })
  });
  assert.equal(upload.status, 200);
  const asset = (await upload.json()).asset;
  assert.equal(asset.url, `${PUBLIC_URL}/assets/${asset.id}.png`, "uses the configured public URL");

  const served = await ctx.request(`/assets/${asset.id}.png`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  // Discord's proxy fetches these cross-origin.
  assert.equal(served.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.equal(served.headers.get("access-control-allow-origin"), "*");

  assert.equal((await ctx.request(`/assets/${asset.id}.webp`)).status, 404);
  assert.equal((await ctx.request("/assets/../../etc/passwd")).status, 404);

  const list = await (await ctx.request("/api/assets")).json();
  assert.equal(list.assets.length, 1);

  const removed = await ctx.request(`/api/assets/${asset.id}`, {
    method: "DELETE",
    headers: { "x-csrf-token": csrf }
  });
  assert.equal(removed.status, 200);
  assert.equal((await ctx.request(`/assets/${asset.id}.png`)).status, 404);
});

test("uploads reject bad image data", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const res = await ctx.request("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /PNG, JPEG/);
});

test("companion pairing returns a runnable command and a personalized script", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const pairing = await ctx.request("/api/companion/pairings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ label: "Work laptop" })
  });
  assert.equal(pairing.status, 200);
  const { token, command, scriptUrl } = await pairing.json();
  assert.match(command, /^curl -fsSL "https:\/\/status\.example\.com\/companion\.js\?pair=/);
  assert.match(command, /\| node$/);
  assert.equal(scriptUrl, `https://status.example.com/companion.js?pair=${token}`);

  const script = await ctx.request(`/companion.js?pair=${token}`);
  assert.equal(script.status, 200);
  const body = await script.text();
  assert.equal((body.match(/^#!/gm) || []).length, 1, "exactly one shebang");
  assert.match(body, /__STATUSC0RD__/);
  assert.ok(body.includes(token), "script carries the pairing token");
  assert.match(body, /DiscordIpc/);

  assert.equal((await ctx.request("/companion.js?pair=invalid")).status, 404);
});

test("companion config delivers the full RPC payload with public image URLs", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const upload = await ctx.request("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ dataUrl: PNG_DATA_URL, name: "logo.png" })
  });
  const asset = (await upload.json()).asset;

  await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({
      name: "Working on StatusC0rd",
      type: 2,
      details: "Shipping photos",
      state: "v2.1",
      largeImage: `asset:${asset.id}`,
      largeText: "the logo",
      smallImage: "https://cdn.example.com/dot.png",
      buttons: [{ label: "GitHub", url: "https://github.com/Not4Pranav/StatusC0rd" }],
      startedAt: true,
      targets: { bot: true, companion: true }
    })
  });

  const { token } = await (
    await ctx.request("/api/companion/pairings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ label: "laptop" })
    })
  ).json();

  const config = await ctx.request("/api/companion/config", {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(config.status, 200);
  const payload = await config.json();
  assert.equal(payload.activity.assets.large_image, `${PUBLIC_URL}/assets/${asset.id}.png`);
  assert.equal(payload.activity.assets.small_image, "https://cdn.example.com/dot.png");
  assert.equal(payload.activity.assets.large_text, "the logo");
  assert.deepEqual(payload.activity.buttons, ["GitHub"]);
  assert.deepEqual(payload.activity.metadata.button_urls, ["https://github.com/Not4Pranav/StatusC0rd"]);
  assert.equal(payload.status, "active");

  const etag = config.headers.get("etag");
  const cached = await ctx.request("/api/companion/config", {
    headers: { authorization: `Bearer ${token}`, "if-none-match": etag }
  });
  assert.equal(cached.status, 304);

  assert.equal((await ctx.request("/api/companion/config")).status, 401);
});

test("companion heartbeat marks the device online", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const { token } = await (
    await ctx.request("/api/companion/pairings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ label: "laptop" })
    })
  ).json();

  const beat = await ctx.request("/api/companion/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ discordConnected: true, hostname: "laptop" })
  });
  assert.equal(beat.status, 200);

  const state = await (await ctx.request("/api/state")).json();
  assert.equal(state.pairings[0].lastStatus, "connected");
  assert.ok(state.pairings[0].lastSeenAt);
});

test("revoking a pairing invalidates its token", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const { token, pairing } = await (
    await ctx.request("/api/companion/pairings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ label: "old laptop" })
    })
  ).json();

  const revoke = await ctx.request(`/api/companion/pairings/${pairing.id}`, {
    method: "DELETE",
    headers: { "x-csrf-token": csrf }
  });
  assert.equal(revoke.status, 200);
  assert.equal(
    (await ctx.request("/api/companion/config", { headers: { authorization: `Bearer ${token}` } })).status,
    401
  );
});

test("settings can be updated from the dashboard", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const update = await ctx.request("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({
      publicUrl: "https://new.example.com/",
      keepAlive: { enabled: true, intervalMinutes: 7 },
      allowedIds: ["123456789012345678", "bad"]
    })
  });
  assert.equal(update.status, 200);

  const effective = ctx.settings.effective();
  assert.equal(effective.publicUrl, "https://new.example.com");
  assert.deepEqual(effective.allowedDiscordIds, ["123456789012345678"]);
  assert.equal(effective.keepAlive.intervalMinutes, 7);

  const bad = await ctx.request("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ publicUrl: "not a url" })
  });
  assert.equal(bad.status, 400);

  const keyChange = await ctx.request("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ currentAdminKey: ADMIN_KEY, newAdminKey: "a-brand-new-key-1234" })
  });
  assert.equal(keyChange.status, 200);
  assert.equal(ctx.settings.verifyAdminKey("a-brand-new-key-1234"), true);
});

test("unknown routes and malformed JSON are handled", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const api = await ctx.request("/api/nope");
  assert.equal(api.status, 404);
  assert.equal((await api.json()).ok, false);

  const html = await ctx.request("/nope");
  assert.equal(html.status, 404);
  assert.match(await html.text(), /Page not found/);

  const broken = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: "{ nope"
  });
  assert.equal(broken.status, 400);
  assert.match((await broken.json()).error, /valid JSON/);
});

test("logout clears the session", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const res = await ctx.request("/logout", { method: "POST", headers: { "x-csrf-token": csrf } });
  assert.equal(res.status, 303);
  assert.equal((await ctx.request("/api/state")).status, 401);
});
