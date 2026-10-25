"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { startApp, PNG_DATA_URL } = require("./helpers");
const { TEMPLATES, templateList, applyTemplate } = require("../src/templates");

const json = (extra = {}) => ({ "content-type": "application/json", ...extra });

test("templates are complete, valid presences", async () => {
  const { sanitizePresence, DEFAULT_CONFIG } = require("../src/presence");
  assert.ok(TEMPLATES.length >= 8, "a gallery needs a few choices");
  const ids = new Set();
  for (const template of TEMPLATES) {
    assert.match(template.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(template.id), `duplicate id ${template.id}`);
    ids.add(template.id);
    assert.ok(template.name && template.blurb);

    const merged = applyTemplate(template.id, DEFAULT_CONFIG);
    const result = sanitizePresence(merged, { current: DEFAULT_CONFIG });
    assert.equal(result.ok, true, `${template.id}: ${result.errors.join(", ")}`);
    assert.equal(result.value.name, template.presence.name);
    // Templates never decide where the presence goes or which photo is used.
    assert.deepEqual(result.value.targets, DEFAULT_CONFIG.targets);
    assert.equal(result.value.largeImage, "");
  }
  assert.equal(applyTemplate("nope", DEFAULT_CONFIG), null);
  assert.equal(templateList()[0].presence, undefined, "chips only need metadata");
});

test("a draft is staged without touching the live presence", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  // Publish a baseline first so there is something to protect.
  const live = await ctx.request("/api/presence", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ name: "Live card", details: "line one" })
  });
  assert.equal(live.status, 200);

  const draft = await ctx.request("/api/presence/draft", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ name: "Draft card", details: "not yet" })
  });
  assert.equal(draft.status, 200);
  const staged = await draft.json();
  assert.equal(staged.draft.name, "Draft card");
  assert.ok(staged.draft.savedAt);

  // The live presence, the bot and the state endpoint still show the old card.
  assert.equal(ctx.settings.get().presence.name, "Live card");
  assert.equal(ctx.bot.calls.filter((call) => call.type === "set").length, 1);

  const state = await (await ctx.request("/api/state")).json();
  assert.equal(state.presence.name, "Live card");
  assert.equal(state.draft.name, "Draft card");
});

test("publishing applies the draft and clears it", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  await ctx.request("/api/presence/draft", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ name: "Staged", details: "about to go live" })
  });

  const res = await ctx.request("/api/presence/publish", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({})
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.presence.name, "Staged");
  assert.equal(ctx.settings.get().draft, null);

  const applied = ctx.bot.calls.filter((call) => call.type === "set").at(-1);
  assert.equal(applied.config.name, "Staged");
});

test("discarding a draft restores nothing but removes the staging area", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  await ctx.request("/api/presence/draft", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ name: "Never mind" })
  });
  const res = await ctx.request("/api/presence/draft", {
    method: "DELETE",
    headers: { "x-csrf-token": csrf }
  });
  assert.equal(res.status, 200);
  assert.equal(ctx.settings.get().draft, null);
});

test("publishing an invalid draft is refused with the reason", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const bad = await ctx.request("/api/presence/publish", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ name: "" })
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /name is required/i);

  const empty = await ctx.request("/api/presence/publish", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({})
  });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /nothing staged/i);
});

test("applying a template through the API keeps the current images", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const asset = ctx.assets.save({ dataUrl: PNG_DATA_URL, name: "keep.png" });
  await ctx.request("/api/presence/draft", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ name: "Mine", largeImage: `asset:${asset.asset.id}`, status: "idle" })
  });

  const res = await ctx.request("/api/templates/listening", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: "{}"
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.presence.name, "Lo-fi beats");
  assert.equal(body.presence.type, 2);
  assert.equal(body.presence.largeImage, `asset:${asset.asset.id}`, "the photo survives a template");

  const missing = await ctx.request("/api/templates/nope", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: "{}"
  });
  assert.equal(missing.status, 404);
});

test("a share link renders a public card with link previews", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const asset = ctx.assets.save({ dataUrl: PNG_DATA_URL, name: "share.png" });
  await ctx.request("/api/presence", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({
      name: "Shared card",
      details: "first line",
      state: "second line",
      largeImage: `asset:${asset.asset.id}`,
      buttons: [{ label: "Site", url: "https://example.com" }]
    })
  });

  const created = await ctx.request("/api/share", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: "{}"
  });
  assert.equal(created.status, 200);
  const { share } = await created.json();
  assert.match(share.slug, /^[a-z0-9]{6,32}$/);
  assert.equal(share.url, `https://status.example.com/c/${share.slug}`);

  // No session, no cookies: this is the page a stranger opens.
  const page = await ctx.request(`/c/${share.slug}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<meta property="og:title" content="Shared card"/);
  assert.match(html, /<meta property="og:description" content="first line · second line"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/status\.example\.com\/assets\//);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /Shared card/);
  assert.match(html, /class="card-btn" href="https:\/\/example\.com"/);
  assert.equal(page.headers.get("cache-control"), "no-store");

  // Rotating invalidates the old slug; switching off kills both.
  const rotated = await (await ctx.request("/api/share", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: "{}"
  })).json();
  assert.notEqual(rotated.share.slug, share.slug);
  assert.equal((await ctx.request(`/c/${share.slug}`)).status, 404);

  const off = await ctx.request("/api/share", {
    method: "DELETE",
    headers: { "x-csrf-token": csrf }
  });
  assert.equal(off.status, 200);
  assert.equal((await ctx.request(`/c/${rotated.share.slug}`)).status, 404);
});

test("sharing needs a published card and a sane slug", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const csrf = await ctx.signIn();

  const nothing = await ctx.request("/api/share", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: "{}"
  });
  assert.equal(nothing.status, 400);
  assert.match((await nothing.json()).error, /apply a presence first/i);

  await ctx.request("/api/presence", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ name: "Has a card" })
  });

  const custom = await ctx.request("/api/share", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ slug: "My Cool Card!" })
  });
  const body = await custom.json();
  assert.equal(body.share.slug, "mycoolcard", "slugs are normalised");

  const tooShort = await ctx.request("/api/share", {
    method: "POST",
    headers: json({ "x-csrf-token": csrf }),
    body: JSON.stringify({ slug: "abc" })
  });
  assert.equal(tooShort.status, 400);
});

test("share routes stay behind the session and CSRF", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  assert.equal((await ctx.request("/api/share", { method: "POST", headers: json(), body: "{}" })).status, 401);
  await ctx.signIn();
  const noCsrf = await ctx.request("/api/share", {
    method: "POST",
    headers: json(),
    body: "{}"
  });
  assert.equal(noCsrf.status, 403);
});
