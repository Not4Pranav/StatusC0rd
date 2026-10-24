"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizePresence,
  buildActivity,
  describeActivity,
  isStreamUrl,
  imageKind,
  resolveImage,
  toText,
  DEFAULT_CONFIG
} = require("../src/presence");

const now = 1_700_000_000_000;

function sanitize(body, current = {}) {
  return sanitizePresence(body, { current: { ...DEFAULT_CONFIG, ...current }, now });
}

test("accepts a minimal payload and marks it enabled", () => {
  const result = sanitize({ name: "Hello" });
  assert.equal(result.ok, true);
  assert.equal(result.value.enabled, true);
  assert.deepEqual(result.value.targets, { bot: true, companion: true });
  assert.equal(result.value.updatedAt, new Date(now).toISOString());
});

test("requires a name and at least one target", () => {
  assert.match(sanitize({ name: " " }).errors[0], /name is required/i);
  const noTargets = sanitize({ name: "x", targets: { bot: false, companion: false } });
  assert.equal(noTargets.ok, false);
  assert.match(noTargets.errors.join(" "), /at least one place/);
});

test("classifies and validates image fields", () => {
  assert.deepEqual(imageKind(""), { kind: "empty", value: "" });
  assert.equal(imageKind("asset:abc123").kind, "asset");
  assert.equal(imageKind("asset:abc123").id, "abc123");
  assert.equal(imageKind("https://cdn.example.com/a.png").kind, "url");
  assert.equal(imageKind("my_asset-1").kind, "key");

  // uploaded assets, https URLs and Discord asset keys are all accepted
  assert.equal(sanitize({ name: "x", largeImage: "asset:abc123" }).ok, true);
  assert.equal(sanitize({ name: "x", largeImage: "https://cdn.example.com/a.png" }).ok, true);
  assert.equal(sanitize({ name: "x", largeImage: "my_asset-1" }).ok, true);

  // http URLs are rejected: Discord only proxies https
  const insecure = sanitize({ name: "x", largeImage: "http://cdn.example.com/a.png" });
  assert.equal(insecure.ok, false);
  assert.match(insecure.errors[0], /https/);

  const badKey = sanitize({ name: "x", smallImage: "bad key!" });
  assert.equal(badKey.ok, false);
  assert.match(badKey.errors[0], /asset key/);
});

test("buttons need a label and an https link, max two", () => {
  const ok = sanitize({
    name: "x",
    buttons: [
      { label: "GitHub", url: "https://github.com/x" },
      { label: "Site", url: "https://example.com" },
      { label: "Third", url: "https://example.com/3" }
    ]
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.buttons.length, 2);

  assert.equal(sanitize({ name: "x", buttons: [{ label: "Bad", url: "http://example.com" }] }).ok, false);
  assert.equal(sanitize({ name: "x", buttons: [{ label: "", url: "https://example.com" }] }).ok, false);
});

test("streaming requires a twitch or youtube url", () => {
  assert.equal(sanitize({ name: "x", type: 1 }).ok, false);
  assert.equal(sanitize({ name: "x", type: 1, url: "https://example.com/x" }).ok, false);
  assert.equal(sanitize({ name: "x", type: 1, url: "https://twitch.tv/x" }).ok, true);
  // and a stream url is dropped for other types
  assert.equal(sanitize({ name: "x", type: 0, url: "https://twitch.tv/x" }).value.url, "");
});

test("the elapsed timer is preserved unless restarted", () => {
  const current = { startedAt: true, startTimestamp: 1_600_000_000_000 };
  assert.equal(sanitize({ name: "x", startedAt: true }, current).value.startTimestamp, 1_600_000_000_000);
  assert.equal(sanitize({ name: "x", startedAt: true, restartTimer: true }, current).value.startTimestamp, now);
  assert.equal(sanitize({ name: "x", startedAt: false }, current).value.startTimestamp, null);
});

test("resolveImage handles every image kind", () => {
  const resolver = (id) => (id === "abc123def456" ? "https://host/assets/abc123def456.png" : "");
  assert.equal(resolveImage("", {}), "");
  assert.equal(resolveImage("https://cdn.example.com/a.png", {}), "https://cdn.example.com/a.png");
  assert.equal(
    resolveImage("asset:abc123def456", { resolveAsset: resolver }),
    "https://host/assets/abc123def456.png"
  );
  // unknown asset references must not produce a broken URL
  assert.equal(resolveImage("asset:deadbeef99", { resolveAsset: resolver }), "");
  assert.equal(resolveImage("asset:abc123def456", {}), "");
  assert.equal(resolveImage("discord_key", {}), "discord_key");
});

test("buildActivity for the bot omits photos and buttons", () => {
  const activity = buildActivity(
    {
      enabled: true,
      name: "StatusC0rd",
      type: 0,
      details: "line 1",
      state: "line 2",
      largeImage: "asset:abc123",
      smallImage: "https://cdn.example.com/dot.png",
      buttons: [{ label: "Site", url: "https://example.com" }],
      startedAt: true,
      startTimestamp: now,
      targets: { bot: true, companion: true }
    },
    { target: "bot", resolveAsset: () => "https://host/assets/abc123.png" }
  );
  assert.deepEqual(activity, {
    name: "StatusC0rd",
    type: 0,
    details: "line 1",
    state: "line 2",
    assets: { large_image: "https://host/assets/abc123.png", small_image: "https://cdn.example.com/dot.png" },
    timestamps: { start: now }
  });
  assert.equal("buttons" in activity, false);
});

test("buildActivity for the companion includes buttons and metadata", () => {
  const activity = buildActivity(
    {
      enabled: true,
      name: "StatusC0rd",
      type: 2,
      largeImage: "asset:abc123",
      largeText: "logo",
      buttons: [
        { label: "Site", url: "https://example.com" },
        { label: "GitHub", url: "https://github.com/x" }
      ],
      targets: { bot: true, companion: true }
    },
    { target: "companion", resolveAsset: () => "https://host/assets/abc123.png" }
  );
  assert.deepEqual(activity.buttons, ["Site", "GitHub"]);
  assert.deepEqual(activity.metadata, { button_urls: ["https://example.com", "https://github.com/x"] });
  assert.equal(activity.assets.large_image, "https://host/assets/abc123.png");
  assert.equal(activity.assets.large_text, "logo");
});

test("targets decide who gets the activity", () => {
  const base = { enabled: true, name: "x", type: 0 };
  assert.equal(buildActivity({ ...base, targets: { bot: false, companion: true } }, { target: "bot" }), null);
  assert.ok(buildActivity({ ...base, targets: { bot: false, companion: true } }, { target: "companion" }));
  assert.equal(buildActivity({ ...base, targets: { bot: true, companion: false } }, { target: "companion" }), null);
  assert.equal(buildActivity({ ...base, enabled: false }), null);
});

test("custom status renders as state text only", () => {
  assert.deepEqual(buildActivity({ enabled: true, name: "Working", type: 4, details: "x" }), {
    name: "Working",
    type: 4,
    state: "Working"
  });
});

test("describeActivity and toText", () => {
  assert.equal(describeActivity({ enabled: true, name: "Chess", type: 5 }), "Competing Chess");
  assert.equal(describeActivity({ enabled: false, name: "Chess" }), "no activity");
  assert.equal(toText("  a\nb\u0000c  ", 20), "a bc");
  assert.equal(toText("x".repeat(300), 128).length, 128);
  assert.equal(isStreamUrl("https://twitch.tv.evil.com/x"), false);
});
