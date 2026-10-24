"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizePresence,
  buildActivity,
  describeActivity,
  isStreamUrl,
  toText,
  DEFAULT_CONFIG
} = require("../src/presence");

const now = 1_700_000_000_000;

function sanitize(body, current = {}) {
  return sanitizePresence(body, { current: { ...DEFAULT_CONFIG, ...current }, now });
}

test("accepts a minimal valid payload", () => {
  const result = sanitize({ name: "Hello", type: "0", status: "online" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.name, "Hello");
  assert.equal(result.value.type, 0);
  assert.equal(result.value.enabled, true);
  assert.equal(result.value.updatedAt, new Date(now).toISOString());
});

test("requires an activity name", () => {
  const result = sanitize({ name: "   " });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /name is required/i);
});

test("normalises whitespace, newlines and length", () => {
  const result = sanitize({ name: "  line\none\t  two  " });
  assert.equal(result.value.name, "line one two");

  const long = sanitize({ name: "x".repeat(300) });
  assert.equal(long.value.name.length, 128);
});

test("rejects unknown activity types but keeps the current one when omitted", () => {
  const bad = sanitize({ name: "x", type: 42 });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /Activity type/);

  const fallback = sanitize({ name: "x" }, { type: 2 });
  assert.equal(fallback.value.type, 2);
});

test("rejects unknown statuses", () => {
  const result = sanitize({ name: "x", status: "away" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /Status must be one of/);
});

test("streaming activities require a twitch/youtube URL", () => {
  assert.equal(sanitize({ name: "x", type: 1 }).ok, false);
  assert.equal(sanitize({ name: "x", type: 1, url: "http://twitch.tv/abc" }).ok, false);
  assert.equal(sanitize({ name: "x", type: 1, url: "https://example.com/abc" }).ok, false);

  const ok = sanitize({ name: "x", type: 1, url: "https://www.twitch.tv/abc" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.url, "https://www.twitch.tv/abc");
});

test("drops the stream URL for non-streaming activities", () => {
  const result = sanitize({ name: "x", type: 0, url: "https://twitch.tv/abc" });
  assert.equal(result.ok, true);
  assert.equal(result.value.url, "");
});

test("image fields must be asset keys, not URLs", () => {
  const urlError = sanitize({ name: "x", largeImage: "https://example.com/a.png" });
  assert.equal(urlError.ok, false);
  assert.match(urlError.errors[0], /asset key, not a URL/);

  const badKey = sanitize({ name: "x", smallImage: "bad key!" });
  assert.equal(badKey.ok, false);
  assert.match(badKey.errors[0], /letters, numbers/);

  const good = sanitize({ name: "x", smallImage: "my_asset-1", smallText: "hi" });
  assert.equal(good.ok, true);
  assert.equal(good.value.smallImage, "my_asset-1");
  assert.equal(good.value.smallText, "hi");
});

test("the elapsed timer is preserved unless restarted", () => {
  const current = { startedAt: true, startTimestamp: 1_600_000_000_000 };

  const preserved = sanitize({ name: "x", startedAt: "true" }, current);
  assert.equal(preserved.value.startTimestamp, 1_600_000_000_000);

  const restarted = sanitize({ name: "x", startedAt: true, restartTimer: true }, current);
  assert.equal(restarted.value.startTimestamp, now);

  const stopped = sanitize({ name: "x", startedAt: false }, current);
  assert.equal(stopped.value.startedAt, false);
  assert.equal(stopped.value.startTimestamp, null);
});

test("unknown fields are discarded", () => {
  const result = sanitize({ name: "x", buttons: [{ label: "a", url: "https://a" }], appId: "123" });
  assert.equal("buttons" in result.value, false);
  assert.equal("appId" in result.value, false);
});

test("buildActivity returns null when nothing should be shown", () => {
  assert.equal(buildActivity(null), null);
  assert.equal(buildActivity({ enabled: false, name: "x" }), null);
  assert.equal(buildActivity({ enabled: true, name: "" }), null);
});

test("buildActivity maps a playing presence", () => {
  const activity = buildActivity({
    enabled: true,
    name: "StatusC0rd",
    type: 0,
    details: "line 1",
    state: "line 2",
    largeImage: "logo",
    largeText: "Made with StatusC0rd",
    smallImage: "dot",
    startedAt: true,
    startTimestamp: now
  });

  assert.deepEqual(activity, {
    name: "StatusC0rd",
    type: 0,
    details: "line 1",
    state: "line 2",
    assets: {
      large_image: "logo",
      large_text: "Made with StatusC0rd",
      small_image: "dot"
    },
    timestamps: { start: now }
  });
});

test("buildActivity adds the stream URL only for streaming", () => {
  const streaming = buildActivity({
    enabled: true,
    name: "live",
    type: 1,
    url: "https://twitch.tv/x"
  });
  assert.equal(streaming.url, "https://twitch.tv/x");

  const playing = buildActivity({ enabled: true, name: "game", type: 0, url: "https://twitch.tv/x" });
  assert.equal("url" in playing, false);
});

test("buildActivity maps a custom status", () => {
  assert.deepEqual(buildActivity({ enabled: true, name: "Working", type: 4, details: "ignored" }), {
    name: "Working",
    type: 4,
    state: "Working"
  });
});

test("describeActivity is human readable", () => {
  assert.equal(describeActivity({ enabled: true, name: "Chess", type: 5 }), "Competing Chess");
  assert.equal(describeActivity({ enabled: false, name: "Chess", type: 5 }), "no activity");
});

test("toText strips control characters and isStreamUrl is strict", () => {
  assert.equal(toText("a\u0000b", 10), "ab");
  assert.equal(isStreamUrl("https://youtu.be/xyz"), true);
  assert.equal(isStreamUrl("https://twitch.tv.evil.com/x"), false);
  assert.equal(isStreamUrl("javascript:alert(1)"), false);
});
