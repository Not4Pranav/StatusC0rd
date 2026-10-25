"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizePresence,
  buildActivity,
  isLocalHost,
  DEFAULT_CONFIG,
  LIMITS
} = require("../src/presence");

const base = { name: "Card", type: 0, details: "one", state: "two" };

test("trims, collapses and clamps text", () => {
  const result = sanitizePresence({ name: `  ${"a".repeat(200)}  `, type: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.value.name.length, LIMITS.name);
  assert.equal(result.value.name.trim(), result.value.name);
});

test("strips control characters from every text field", () => {
  const result = sanitizePresence({ name: "a\u0000b\u001fc", type: 0, state: "x\ny" });
  assert.equal(result.value.name, "abc");
  assert.equal(result.value.state, "x y");
});

test("requires a name", () => {
  assert.equal(sanitizePresence({ name: "   ", type: 0 }).ok, false);
});

test("rejects an unknown activity type instead of guessing", () => {
  const result = sanitizePresence({ ...base, type: 99 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Activity type/);
});

test("streaming needs a twitch or youtube https url", () => {
  assert.equal(sanitizePresence({ ...base, type: 1 }).ok, false);
  assert.equal(sanitizePresence({ ...base, type: 1, url: "https://twitch.tv/someone" }).ok, true);
  assert.equal(sanitizePresence({ ...base, type: 1, url: "https://example.com/s" }).ok, false);
  assert.equal(sanitizePresence({ ...base, type: 1, url: "http://twitch.tv/someone" }).ok, false);
});

test("buttons: https only, two at most, label and url", () => {
  const three = sanitizePresence({
    ...base,
    buttons: [
      { label: "a", url: "https://a.example" },
      { label: "b", url: "https://b.example" },
      { label: "c", url: "https://c.example" }
    ]
  });
  assert.equal(three.value.buttons.length, 2);
  const insecure = sanitizePresence({ ...base, buttons: [{ label: "a", url: "http://a.example" }] });
  assert.equal(insecure.ok, false);
});

test("image URLs must be https, except on loopback", () => {
  assert.equal(sanitizePresence({ ...base, largeImage: "https://x.example/a.png" }).ok, true);
  assert.equal(sanitizePresence({ ...base, largeImage: "http://x.example/a.png" }).ok, false);
  assert.equal(sanitizePresence({ ...base, largeImage: "http://localhost:3000/a.png" }).ok, true);
  assert.equal(sanitizePresence({ ...base, largeImage: "http://192.168.1.9/a.png" }).ok, true);
});

test("local host detection covers the private ranges", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "box.local", "10.1.2.3", "172.16.0.1", "192.168.4.4"]) {
    assert.equal(isLocalHost(host), true, host);
  }
  for (const host of ["example.com", "8.8.8.8", "172.32.0.1"]) {
    assert.equal(isLocalHost(host), false, host);
  }
});

test("a card needs at least one target", () => {
  assert.equal(sanitizePresence({ ...base, targets: { bot: false, profile: false } }).ok, false);
  assert.equal(sanitizePresence({ ...base, targets: { bot: true, profile: false } }).ok, true);
});

test("the timer keeps its start unless a restart is asked for", () => {
  const started = sanitizePresence({ ...base, startedAt: true }, { now: 1000 });
  assert.equal(started.value.startTimestamp, 1000);
  const kept = sanitizePresence({ ...base, startedAt: true }, { current: started.value, now: 5000 });
  assert.equal(kept.value.startTimestamp, 1000);
  const restarted = sanitizePresence(
    { ...base, startedAt: true, restartTimer: true },
    { current: started.value, now: 5000 }
  );
  assert.equal(restarted.value.startTimestamp, 5000);
});

test("the pre-v5 companion flag still maps to the profile target", () => {
  const result = sanitizePresence({ ...base, targets: { bot: true, companion: false } });
  assert.equal(result.value.targets.profile, false);
  assert.equal(result.value.targets.bot, true);
});

test("the bot payload never carries buttons", () => {
  const config = { ...DEFAULT_CONFIG, ...base, enabled: true, buttons: [{ label: "a", url: "https://a.example" }] };
  const activity = buildActivity(config, { target: "bot" });
  assert.equal(activity.buttons, undefined);
  assert.equal(activity.metadata, undefined);
});

test("the profile payload carries buttons and their urls", () => {
  const config = { ...DEFAULT_CONFIG, ...base, enabled: true, buttons: [{ label: "a", url: "https://a.example" }] };
  const activity = buildActivity(config, { target: "profile" });
  assert.deepEqual(activity.buttons, ["a"]);
  assert.deepEqual(activity.metadata.button_urls, ["https://a.example"]);
});

test("images that Discord cannot fetch are dropped from the payload", () => {
  const config = { ...DEFAULT_CONFIG, ...base, enabled: true, largeImage: "asset:0123456789abcdef01" };
  const local = buildActivity(config, { target: "bot", resolveAsset: () => "http://localhost:3000/a.png" });
  const publicUrl = buildActivity(config, { target: "bot", resolveAsset: () => "https://host/a.png" });
  assert.equal(local.assets, undefined);
  assert.equal(publicUrl.assets.large_image, "https://host/a.png");
});

test("a disabled card builds nothing", () => {
  assert.equal(buildActivity({ ...DEFAULT_CONFIG, enabled: false }), null);
});

test("a target that is switched off builds nothing", () => {
  const config = { ...DEFAULT_CONFIG, ...base, enabled: true, targets: { bot: false, profile: true } };
  assert.equal(buildActivity(config, { target: "bot" }), null);
});
