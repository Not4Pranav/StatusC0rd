"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SettingsStore, ADMIN_USER_ID, MAX_USERS } = require("../src/settings");
const { AssetStore } = require("../src/assets");
const { KeepAlive } = require("../src/keepalive");
const { RateLimiter, LoginLimiter, safeEqual } = require("../src/auth");
const { parseUpload } = require("../src/assets");
const { normalizeEnv } = require("../src/env");

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sc-${label}-`));
}

function store(dir, env = {}) {
  return new SettingsStore(path.join(dir, "settings.json"), { env });
}

const PNG_16 = (() => {
  const zlib = require("node:zlib");
  const W = 16;
  const H = 16;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  function crc32(buf) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    let x = 0xffffffff;
    for (const byte of buf) x = table[(x ^ byte) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
})();

test("a fresh store needs setup and creates a session secret", () => {
  const s = store(tmpDir("fresh"));
  assert.equal(s.needsSetup(), true);
  assert.ok(s.sessionSecret().length >= 32);
});

test("the dashboard key is stored hashed and verified in constant time", () => {
  const s = store(tmpDir("key"));
  s.setAdminKey("a-long-enough-key");
  assert.equal(s.verifyAdminKey("a-long-enough-key"), true);
  assert.equal(s.verifyAdminKey("a-long-enough-kez"), false);
  assert.equal(s.get().admin.keyHash.includes("a-long-enough-key"), false);
  assert.throws(() => s.setAdminKey("short"), /12 characters/);
});

test("DASHBOARD_KEY in the environment completes the instance without a wizard", () => {
  const s = store(tmpDir("envkey"), { DASHBOARD_KEY: "environment-key-1" });
  assert.equal(s.needsSetup(), false);
  assert.equal(s.verifyAdminKey("environment-key-1"), true);
  assert.equal(s.hasAdminKey, true);
});

test("members are created, verified and never leak hashes", () => {
  const s = store(tmpDir("users"));
  const user = s.createUser({ email: "A@Example.com ", password: "longenough1", name: "A" });
  assert.equal(user.email, "a@example.com");
  assert.equal(user.passHash, undefined);
  assert.equal(s.verifyCredentials("a@example.com", "longenough1").id, user.id);
  assert.equal(s.verifyCredentials("a@example.com", "wrong-password"), null);
  assert.throws(() => s.createUser({ email: "a@example.com", password: "longenough1" }), /already exists/);
  assert.throws(() => s.createUser({ email: "bad", password: "longenough1" }), /email/i);
  assert.throws(() => s.createUser({ email: "b@example.com", password: "short" }), /10 characters/);
});

test("accounts are always members, whatever the caller asks for", () => {
  const s = store(tmpDir("roles"));
  const user = s.createUser({ email: "c@example.com", password: "longenough1", role: "admin" });
  assert.equal(user.role, "member");
  assert.throws(() => s.updateUser(user.id, { role: "admin" }), /members/);
  assert.equal(s.updateUser(user.id, { name: "Renamed" }).name, "Renamed");
});

test("a password reset retires the older sessions", () => {
  const s = store(tmpDir("reset"));
  const user = s.createUser({ email: "d@example.com", password: "longenough1" });
  const before = s.findUserById(user.id).passwordChangedAt;
  s.setUserPassword(user.id, "an-other-password");
  const after = s.findUserById(user.id).passwordChangedAt;
  assert.notEqual(before, after);
  assert.equal(s.verifyCredentials("d@example.com", "longenough1"), null);
  assert.ok(s.verifyCredentials("d@example.com", "an-other-password"));
});

test("cards are per account and never deep-merged", () => {
  const s = store(tmpDir("cards"));
  s.setPresence(ADMIN_USER_ID, { name: "Owner", buttons: [{ label: "a", url: "https://a.example" }] });
  s.setPresence("u_abcdef1234", { name: "Member" });
  assert.equal(s.presenceFor(ADMIN_USER_ID).name, "Owner");
  assert.equal(s.presenceFor("u_abcdef1234").name, "Member");
  s.setPresence("u_abcdef1234", { name: "Member", buttons: [] });
  assert.equal(s.presenceFor("u_abcdef1234").buttons.length, 0);
  assert.notEqual(s.presenceFor(ADMIN_USER_ID), undefined);
});

test("deleting an account removes its card, links and photo entries", () => {
  const s = store(tmpDir("delete"));
  const user = s.createUser({ email: "e@example.com", password: "longenough1" });
  s.setPresence(user.id, { name: "Mine" });
  s.linkDiscord("111111111111111111", user.id);
  s.addAsset({ id: "abcdef0123", ext: "png", mime: "image/png" }, user.id);
  const result = s.deleteUser(user.id);
  assert.equal(result.removed, true);
  assert.deepEqual(result.assetIds, ["abcdef0123"]);
  assert.equal(s.presenceFor(user.id), null);
  assert.equal(s.userIdForDiscord("111111111111111111"), null);
  assert.equal(s.findAsset("abcdef0123"), null);
});

test("a Discord account can only be linked to one account", () => {
  const s = store(tmpDir("links"));
  const a = s.createUser({ email: "f@example.com", password: "longenough1" });
  const b = s.createUser({ email: "g@example.com", password: "longenough1" });
  s.linkDiscord("222222222222222222", a.id);
  assert.equal(s.userIdForDiscord("222222222222222222"), a.id);
  assert.throws(() => s.linkDiscord("222222222222222222", b.id), /already linked/);
  s.unlinkDiscord(a.id);
  assert.equal(s.userIdForDiscord("222222222222222222"), null);
  assert.equal(s.discordIdForUser(a.id), null);
});

test("the account cap is enforced", () => {
  const s = store(tmpDir("cap"));
  assert.equal(MAX_USERS, 500);
  assert.equal(s.countUsers(), 0);
});

test("a corrupt settings file is preserved and never eats the photos", () => {
  const dir = tmpDir("corrupt");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "abcdef0123456789abcd.png"), PNG_16);
  fs.writeFileSync(path.join(dir, "settings.json"), '{"version":5,"assets":[');
  const s = store(dir);
  assert.equal(s.recovered, true);
  assert.equal(s.needsSetup(), true);
  const backups = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
  assert.equal(backups.length, 1);
  const assets = new AssetStore(path.join(dir, "assets"), s);
  assert.equal(assets.prune(), 0);
  assert.equal(fs.readdirSync(path.join(dir, "assets")).length, 1);
});

test("an asset file shared by two accounts survives one of them", () => {
  const dir = tmpDir("shared");
  const s = store(dir);
  const assets = new AssetStore(path.join(dir, "assets"), s);
  const dataUrl = `data:image/png;base64,${PNG_16.toString("base64")}`;
  const one = assets.save({ dataUrl, owner: "admin" });
  const two = assets.save({ dataUrl, owner: "u_abcdef1234" });
  assert.equal(one.asset.id, two.asset.id);
  assets.remove(one.asset.id, "admin");
  assert.equal(fs.existsSync(assets.filePath(one.asset)), true, "still needed by the other account");
  assets.remove(two.asset.id, "u_abcdef1234");
  assert.equal(fs.existsSync(assets.filePath(two.asset)), false);
});

test("uploads are sniffed, sized and dimensioned", () => {
  const good = parseUpload(`data:image/png;base64,${PNG_16.toString("base64")}`);
  assert.equal(good.ok, true);
  assert.equal(good.width, 16);
  assert.equal(parseUpload("data:image/png;base64,aGVsbG8=").ok, false);
  assert.equal(parseUpload("data:image/svg+xml;base64,PHN2Zy8+").ok, false);
  assert.equal(parseUpload("").ok, false);
  const tiny = (() => {
    const png = Buffer.from(PNG_16);
    png.writeUInt32BE(8, 16);
    png.writeUInt32BE(8, 20);
    return parseUpload(`data:image/png;base64,${png.toString("base64")}`);
  })();
  assert.equal(tiny.ok, false);
  assert.match(tiny.error, /16/);
});

test("flags and intervals coming from the environment are normalised", () => {
  const s = store(tmpDir("env"), {
    BOT_ENABLED: "0",
    KEEP_ALIVE_INTERVAL_MINUTES: "500",
    CLIENT_ID: "123456789012345678"
  });
  assert.equal(s.effective().botEnabled, false);
  assert.equal(s.effective().keepAlive.intervalMinutes, 60);
  const { problems } = normalizeEnv({ KEEP_ALIVE_INTERVAL_MINUTES: "soon", LOG_REQUESTS: "maybe" });
  assert.equal(problems.length, 2);
});

test("the keep-alive refuses to ping without a public url and clamps the interval", async () => {
  const pings = [];
  const keepAlive = new KeepAlive({
    getPublicUrl: () => "https://example.onrender.com",
    intervalMinutes: 1,
    fetchImpl: async (url) => {
      pings.push(url);
      return { ok: true, status: 200 };
    }
  });
  const off = keepAlive.configure({ enabled: true, publicUrl: "" });
  assert.equal(off.enabled, false);
  assert.equal(off.lastStatus, "no-url");
  const on = keepAlive.configure({ enabled: true, publicUrl: "https://example.onrender.com/", intervalMinutes: 1 });
  assert.equal(on.intervalMinutes, 5);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(pings, ["https://example.onrender.com/health"]);
  keepAlive.stop();
});

test("rate limiters count, block and recover", () => {
  let now = 0;
  const limiter = new RateLimiter({ windowMs: 1000, max: 2, now: () => now });
  assert.equal(limiter.hit("ip").allowed, true);
  assert.equal(limiter.hit("ip").allowed, true);
  assert.equal(limiter.hit("ip").allowed, false);
  now = 1500;
  assert.equal(limiter.hit("ip").allowed, true);

  let clock = 0;
  const login = new LoginLimiter({ now: () => clock });
  for (let i = 0; i < 5; i += 1) login.fail("ip");
  assert.equal(login.status("ip").blocked, true);
  clock = 16 * 60_000;
  assert.equal(login.status("ip").blocked, false);
});

test("safeEqual treats different lengths and empties as different", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("", ""), false);
  assert.equal(safeEqual(undefined, "x"), false);
});
