"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  startApp,
  createClient,
  csrfFrom,
  PNG_DATA_URL,
  ADMIN_KEY,
  PUBLIC_URL
} = require("./helpers");

test("the public health check reveals nothing but uptime", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  const res = await ctx.request("/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.ok(body.uptimeSeconds >= 0);
  for (const secret of ["version", "storage", "setup", "bot"]) {
    assert.equal(secret in body, false, `${secret} should not be public`);
  }
});

test("the operator gets the full health report behind the session", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  assert.equal((await ctx.request("/api/health")).status, 401);

  await ctx.signIn();
  const res = await ctx.request("/api/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.version, require("../package.json").version);
  assert.equal(body.storage, "ok");
  assert.equal(body.setup, "complete");
  assert.ok("activity" in body);
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

test("login lockout cannot be dodged with a forged X-Forwarded-For", async (t) => {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "false";
  const ctx = await startApp();
  t.after(() => {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
    return ctx.close();
  });

  // A successful sign-in clears the failure counter for this client, so start clean.
  await ctx.signIn();
  const page = await (await ctx.request("/")).text();
  const csrf = csrfFrom(page);
  const attempt = (ip) =>
    ctx.request("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": ip
      },
      body: new URLSearchParams({ key: "definitely-wrong", _csrf: csrf })
    });

  // Four failures stay under the limit (the fifth trips it); each one arrives
  // with a different forged header.
  for (let i = 0; i < 4; i += 1) {
    const res = await attempt(`203.0.113.${i}`);
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /error=invalid/);
  }

  const forged = await attempt("203.0.113.200");
  assert.equal(forged.status, 303);
  assert.match(forged.headers.get("location"), /error=locked/, "one shared bucket per socket, not per spoofed header");
});

test("the wizard rejects a public URL that is not a URL", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  const res = await ctx.request("/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-setup-token": ctx.setupToken },
    body: JSON.stringify({ adminKey: "a-long-dashboard-key", publicUrl: "status.example.com" })
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /must start with https/);
  // The wizard must still be reachable: a rejected payload cannot lock setup.
  const setup = await ctx.request("/setup");
  assert.equal(setup.status, 200);
  assert.match(await setup.text(), /Create your dashboard login/);
});

test("uploaded photos resolve to public URLs in every presence payload", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const upload = await ctx.request("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ dataUrl: PNG_DATA_URL, name: "avatar.png" })
  });
  const asset = (await upload.json()).asset;

  const saved = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ name: "Photo test", largeImage: `asset:${asset.id}`, type: 0 })
  });
  assert.equal(saved.status, 200);

  const read = await (await ctx.request("/api/presence")).json();
  const expected = `${PUBLIC_URL}/assets/${asset.id}.png`;
  assert.equal(read.activity.assets.large_image, expected, "GET /api/presence resolves the upload");
  assert.equal(read.botActivity.assets.large_image, expected);

  const state = await (await ctx.request("/api/state")).json();
  assert.equal(state.activity.assets.large_image, expected);
});

test("favicon requests are redirected to the svg", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const res = await ctx.request("/favicon.ico");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/favicon.svg");
});

test("HTTPS gets a secure session cookie and HSTS, plain http still works", async (t) => {
  const ctx = await startApp({ isProduction: true });
  t.after(() => ctx.close());

  const page = await (await ctx.request("/login")).text();
  const secureLogin = await ctx.request("/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-proto": "https"
    },
    body: new URLSearchParams({ key: ADMIN_KEY, _csrf: csrfFrom(page) })
  });
  const setCookie = (secureLogin.headers.getSetCookie?.() || []).join("\n");
  assert.match(setCookie, /statusc0rd\.sid=/, "session cookie issued");
  assert.match(setCookie, /secure/i, "cookie is marked Secure behind HTTPS");
  assert.match(secureLogin.headers.get("strict-transport-security") || "", /max-age=/, "HSTS sent");

  const plain = await ctx.request("/login");
  assert.equal(plain.headers.get("strict-transport-security"), null, "no HSTS on plain http");
});

test("the setup guide is readable without signing in", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  const res = await ctx.request("/guide");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);

  const html = await res.text();
  // Rendered from docs/free-setup.md, so a heading from that file must be here.
  assert.match(html, /<h1 id="[^"]*"/);
  assert.match(html, /Path A/);
  assert.match(html, /href="#1-what-the-user-gets"/);
  assert.match(html, /<div class="md-table">/);
  // No template tokens may survive the render.
  assert.ok(!html.includes("{{{"));
  assert.ok(!html.includes("{{"));
});

test("the guide survives an unreadable docs folder", async (t) => {
  const { renderMarkdown } = require("../src/markdown");
  const { loadGuide } = require("../src/guide");
  const guide = loadGuide("/nonexistent/free-setup.md");
  assert.equal(guide.available, false);
  assert.match(guide.html, /missing from this deployment/);
  assert.deepEqual(guide.headings, []);
  // The page still renders with the fallback block.
  assert.equal(typeof renderMarkdown, "function");
});

test("the overview page points a first-time visitor at setup", async (t) => {
  const ctx = await startApp({ completeSetup: false });
  t.after(() => ctx.close());

  const res = await ctx.request("/welcome");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /class="btn primary lg" href="\/setup">Start setup</);
  assert.match(html, /href="\/guide"/);
});

test("the overview page offers sign-in once setup is done", async (t) => {
  const ctx = await startApp({ completeSetup: true });
  t.after(() => ctx.close());

  const html = await (await ctx.request("/welcome")).text();
  assert.match(html, /class="btn primary lg" href="\/login">Sign in</);

  const csrf = await ctx.signIn();
  assert.ok(csrf);
  const signedIn = await (await ctx.request("/welcome")).text();
  assert.match(signedIn, /class="btn primary lg" href="\/">Open dashboard</);
});

test("the login page links to the free guide", async (t) => {
  const ctx = await startApp({ completeSetup: true });
  t.after(() => ctx.close());

  const html = await (await ctx.request("/login")).text();
  assert.match(html, /href="\/guide">Free setup guide</);
});
