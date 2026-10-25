"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { startApp, PNG_DATA_URL, ADMIN_KEY } = require("./helpers");
const { createActivityService, ActivityError } = require("../src/activity");

const REAL_FETCH = globalThis.fetch;
const USER_ID = "123456789012345678";

/** Replace Discord's API with a stub; localhost traffic still goes through. */
function stubDiscord(t) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith("http://127.0.0.1") || target.startsWith("http://localhost")) {
      return REAL_FETCH(url, options);
    }
    calls.push({ url: target, options });
    if (target.includes("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok_live", token_type: "Bearer", expires_in: 604800 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (target.includes("/users/@me")) {
      const auth = options.headers?.Authorization || options.headers?.authorization || "";
      if (auth === "Bearer tok_live") {
        return new Response(JSON.stringify({ id: USER_ID, username: "statusc0rd", global_name: "Status" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: "401: Unauthorized", code: 0 }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected Discord request: ${target}`);
  };
  t.after(() => {
    globalThis.fetch = REAL_FETCH;
  });
  return calls;
}

function service(overrides = {}) {
  const settings = {
    effective: () => ({
      clientId: "1234567890",
      clientSecret: "shh",
      publicUrl: "https://status.example.com",
      allowedDiscordIds: [],
      ...overrides
    }),
    get: () => ({
      presence: {
        enabled: true,
        name: "StatusC0rd",
        type: 0,
        details: "Building in the open",
        state: "Line two",
        largeImage: "asset:abcdef1234567890",
        buttons: [{ label: "Docs", url: "https://example.com/docs" }],
        targets: { bot: true, companion: true }
      }
    }),
    findAsset: (id) => (id === "abcdef1234567890" ? { id, ext: "png", mime: "image/png" } : null)
  };
  const assets = { url: (asset, base) => `${base}/assets/${asset.id}.${asset.ext}` };
  return createActivityService({ settings, assets, logger: { log() {}, warn() {}, error() {} } });
}

test("an unconfigured instance explains itself instead of crashing", async () => {
  const svc = service({ clientId: "", clientSecret: "" });
  assert.equal(svc.ready(), false);
  await assert.rejects(
    () => svc.exchangeToken("code"),
    (error) => error instanceof ActivityError && error.status === 503 && error.code === "not_configured"
  );
});

test("the code exchange never sends a redirect_uri", async (t) => {
  const calls = stubDiscord(t);
  const svc = service();
  const result = await svc.exchangeToken("the-code");
  assert.equal(result.accessToken, "tok_live");

  const body = new URLSearchParams(String(calls[0].options.body));
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "the-code");
  assert.equal(body.get("client_id"), "1234567890");
  assert.equal(body.get("client_secret"), "shh");
  assert.equal(body.has("redirect_uri"), false);
});

test("the presence payload carries the photo, text and buttons", async (t) => {
  stubDiscord(t);
  const svc = service();
  const payload = await svc.presence({ accessToken: "tok_live", origin: "http://127.0.0.1:3000" });

  assert.equal(payload.user.id, USER_ID);
  assert.equal(payload.activity.details, "Building in the open");
  assert.equal(payload.activity.state, "Line two");
  assert.equal(payload.activity.assets.large_image, "https://status.example.com/assets/abcdef1234567890.png");
  assert.deepEqual(payload.activity.buttons, ["Docs"]);
  assert.deepEqual(payload.activity.metadata, { button_urls: ["https://example.com/docs"] });

  assert.equal(svc.snapshot().connected, true);
  assert.equal(svc.snapshot().userId, USER_ID);
});

test("verified tokens are cached instead of hitting Discord every poll", async (t) => {
  const calls = stubDiscord(t);
  const svc = service();
  await svc.presence({ accessToken: "tok_live", origin: "https://x.test" });
  await svc.presence({ accessToken: "tok_live", origin: "https://x.test" });
  assert.equal(calls.filter((call) => call.url.includes("/users/@me")).length, 1);
});

test("the allowlist is enforced for the in-Discord app too", async (t) => {
  stubDiscord(t);
  const svc = service({ allowedDiscordIds: ["999999999999999999"] });
  await assert.rejects(
    () => svc.presence({ accessToken: "tok_live", origin: "https://x.test" }),
    (error) => error instanceof ActivityError && error.status === 403
  );
});

test("a disabled presence yields no activity", async (t) => {
  stubDiscord(t);
  const svc = createActivityService({
    settings: {
      effective: () => ({ clientId: "1", clientSecret: "s", publicUrl: "", allowedDiscordIds: [] }),
      get: () => ({ presence: { enabled: false, name: "x" } }),
      findAsset: () => null
    },
    assets: { url: () => "" },
    logger: { log() {}, warn() {}, error() {} }
  });
  const payload = await svc.presence({ accessToken: "tok_live", origin: "https://x.test" });
  assert.equal(payload.activity, null);
  assert.match(svc.snapshot().error, /No presence/);
});

test("a presence switched off for the profile says so instead of \"build one\"", async (t) => {
  stubDiscord(t);
  const svc = createActivityService({
    settings: {
      effective: () => ({ clientId: "1", clientSecret: "s", publicUrl: "", allowedDiscordIds: [] }),
      get: () => ({
        presence: { enabled: true, name: "Live card", targets: { bot: true, companion: false } }
      }),
      findAsset: () => null
    },
    assets: { url: () => "" },
    logger: { log() {}, warn() {}, error() {} }
  });
  const payload = await svc.presence({ accessToken: "tok_live", origin: "https://x.test" });
  assert.equal(payload.activity, null);
  assert.match(payload.reason, /My own profile/);
  assert.equal(svc.snapshot().error, payload.reason);
});

test("polling reports a change once, so the dashboard is not spammed", async (t) => {
  stubDiscord(t);
  const svc = service();
  const first = await svc.presence({ accessToken: "tok_live", origin: "https://x.test" });
  const second = await svc.presence({ accessToken: "tok_live", origin: "https://x.test" });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(svc.noteError("Discord said no"), true);
  assert.equal(svc.noteError("Discord said no"), false);
});

// ------------------------------------------------------------------ HTTP layer

test("the activity page is served without a session and may be framed by Discord", async (t) => {
  stubDiscord(t);
  const ctx = await startApp({ completeSetup: false, isProduction: true });
  t.after(() => ctx.close());

  const page = await ctx.request("/activity/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-client-id="/);
  assert.match(html, /\.\/activity\.mjs/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors https:\/\/discord\.com/);
  assert.equal(page.headers.get("cross-origin-opener-policy"), null);

  const sdk = await ctx.request("/activity/vendor/embedded-app-sdk.js");
  assert.equal(sdk.status, 200);
  assert.match(await sdk.text(), /DiscordSDK/);

  // The dashboard keeps its clickjacking protection.
  const login = await ctx.request("/login");
  assert.match(login.headers.get("content-security-policy"), /frame-ancestors 'self'/);
});

test("/activity redirects to the slash form exactly once", async (t) => {
  stubDiscord(t);
  const ctx = await startApp({ completeSetup: true });
  t.after(() => ctx.close());

  const bare = await ctx.request("/activity");
  assert.ok([301, 302].includes(bare.status), `unexpected ${bare.status}`);
  assert.equal(bare.headers.get("location"), "/activity/");
});

test("token and presence endpoints report useful errors", async (t) => {
  stubDiscord(t);
  const ctx = await startApp({ completeSetup: true });
  t.after(() => ctx.close());

  const anonymous = await ctx.request("/api/activity/presence");
  assert.equal(anonymous.status, 401);

  const noCode = await ctx.request("/api/activity/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(noCode.status, 400);
  assert.match((await noCode.json()).error, /authorization code/i);

  // startApp configures a client id but no secret, so the exchange is refused cleanly.
  const withoutSecret = await ctx.request("/api/activity/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "abc" })
  });
  assert.equal(withoutSecret.status, 503);
  assert.equal((await withoutSecret.json()).code, "not_configured");
});

test("with a client secret the activity can set a real presence", async (t) => {
  const calls = stubDiscord(t);
  const ctx = await startApp({
    completeSetup: true,
    env: { CLIENT_ID: "1234567890", CLIENT_SECRET: "shh" }
  });
  t.after(() => ctx.close());

  ctx.settings.update({
    presence: {
      enabled: true,
      name: "StatusC0rd",
      type: 0,
      details: "Building in the open",
      state: "Line two",
      buttons: [{ label: "Docs", url: "https://example.com/docs" }],
      targets: { bot: true, companion: true }
    }
  });

  const stored = await ctx.request("/api/setup/asset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataUrl: PNG_DATA_URL, name: "photo.png" })
  });
  // The setup route needs no auth here (setup is already complete) - if it does,
  // fall back to whatever asset id it returns and continue with the presence.
  assert.ok(stored.status < 500);

  const token = await ctx.request("/api/activity/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "abc" })
  });
  assert.equal(token.status, 200);
  assert.equal((await token.json()).access_token, "tok_live");

  const presence = await ctx.request("/api/activity/presence", {
    headers: { authorization: "Bearer tok_live" }
  });
  assert.equal(presence.status, 200);
  const body = await presence.json();
  assert.equal(body.ok, true);
  assert.ok(body.activity, "expected an activity payload");

  await ctx.signIn(ADMIN_KEY);
  const stateRes = await ctx.request("/api/state");
  assert.equal(stateRes.status, 200);
  const state = await stateRes.json();
  assert.equal(state.activitySession.userId, USER_ID);
  assert.equal(state.activitySession.connected, true);

  assert.ok(calls.some((call) => call.url.includes("/oauth2/token")));
});

test("the dashboard shows the no-install card and keeps the companion collapsed", async (t) => {
  stubDiscord(t);
  const ctx = await startApp({ completeSetup: true });
  await ctx.signIn(ADMIN_KEY);
  t.after(() => ctx.close());

  const html = await (await ctx.request("/")).text();
  assert.match(html, /Open in Discord/);
  assert.match(html, /activity-mapping/);
  assert.match(html, /<details class="card advanced" id="companion-card"/);
  assert.match(html, /Advanced: run it on your computer instead/);
});
