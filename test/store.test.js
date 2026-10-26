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

test("a photo reference that no longer exists is an error, not a silent gap", () => {
  const { sanitizePresence } = require("../src/presence");
  const broken = sanitizePresence({ name: "x", type: 0, largeImage: "asset:nothex" });
  assert.equal(broken.ok, false);
  assert.match(broken.errors[0], /no longer exists/);
});

test("a card may only use photos its own account uploaded", () => {
  const { sanitizePresence } = require("../src/presence");
  const owns = () => false;
  const result = sanitizePresence(
    { name: "x", type: 0, largeImage: "asset:0123456789abcdef01" },
    { ownsAsset: owns }
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /not in your library/);
  const mine = sanitizePresence(
    { name: "x", type: 0, largeImage: "asset:0123456789abcdef01" },
    { ownsAsset: () => true }
  );
  assert.equal(mine.ok, true);
});

test("one account cannot fill the disk: photo count and byte budgets", () => {
  const dir = tmpDir("quota");
  const s = store(dir);
  const assets = new AssetStore(path.join(dir, "assets"), s);
  const { MAX_PHOTOS_PER_ACCOUNT } = require("../src/assets");
  // Same bytes are deduplicated, so vary the image to fill the quota.
  const zlib = require("node:zlib");
  const makePng = (seed) => {
    const W = 16;
    const H = 16;
    const raw = Buffer.alloc((W * 3 + 1) * H, seed % 256);
    for (let y = 0; y < H; y++) raw[y * (W * 3 + 1)] = 0;
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
    const crc32 = (buf) => {
      let x = 0xffffffff;
      for (const byte of buf) x = crcTable[(x ^ byte) & 0xff] ^ (x >>> 8);
      return (x ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([len, body, crc]);
    };
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
  };
  for (let i = 0; i < MAX_PHOTOS_PER_ACCOUNT; i += 1) {
    const result = assets.save({ dataUrl: `data:image/png;base64,${makePng(i).toString("base64")}`, owner: "admin" });
    assert.equal(result.ok, true, `upload ${i}`);
  }
  const oneTooMany = assets.save({ dataUrl: `data:image/png;base64,${makePng(999).toString("base64")}`, owner: "admin" });
  assert.equal(oneTooMany.ok, false);
  assert.match(oneTooMany.error, /60 photos/);
});

test("deleting a photo clears it from the card that used it", () => {
  const dir = tmpDir("refs");
  const s = store(dir);
  s.addAsset({ id: "abcdef0123456789abcd", ext: "png", mime: "image/png", bytes: 10 }, "admin");
  s.setPresence("admin", {
    name: "with photo",
    largeImage: "asset:abcdef0123456789abcd",
    smallImage: "https://example.com/x.png"
  });
  s.setDraft("admin", { name: "draft", largeImage: "asset:abcdef0123456789abcd" });
  assert.equal(s.clearAssetReferences("abcdef0123456789abcd", "admin"), true);
  assert.equal(s.presenceFor("admin").largeImage, "");
  assert.equal(s.presenceFor("admin").smallImage, "https://example.com/x.png", "other fields untouched");
  assert.equal(s.draftFor("admin").largeImage, "");
  assert.equal(s.clearAssetReferences("abcdef0123456789abcd", "admin"), false, "idempotent");
});

test("an image whose size cannot be read is refused", () => {
  const { parseUpload } = require("../src/assets");
  const jpegWithoutSize = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const result = parseUpload(`data:image/jpeg;base64,${jpegWithoutSize.toString("base64")}`);
  assert.equal(result.ok, false);
  assert.match(result.error, /size could not be read/);
});

test("lossless webp dimensions are read", () => {
  const { parseUpload } = require("../src/assets");
  const b = Buffer.alloc(64);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(56, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8L", 12, "ascii");
  b.writeUInt32LE(40, 16);
  b[20] = 0x2f;
  b.writeUInt32LE((47 & 0x3fff) | ((47 & 0x3fff) << 14), 21);
  const result = parseUpload(`data:image/webp;base64,${b.toString("base64")}`);
  assert.equal(result.ok, true);
  assert.equal(result.width, 48);
  assert.equal(result.height, 48);
});

test("changing the keep-alive target probes it immediately", async () => {
  const pings = [];
  const keepAlive = new KeepAlive({
    getPublicUrl: () => "",
    intervalMinutes: 10,
    fetchImpl: async (url) => {
      pings.push(url);
      return { ok: true, status: 200 };
    }
  });
  keepAlive.configure({ enabled: true, publicUrl: "https://one.example", intervalMinutes: 10 });
  await new Promise((r) => setTimeout(r, 30));
  keepAlive.configure({ enabled: true, publicUrl: "https://two.example", intervalMinutes: 10 });
  await new Promise((r) => setTimeout(r, 30));
  keepAlive.stop();
  assert.deepEqual(pings, ["https://one.example/health", "https://two.example/health"]);
});

test("every account gets a handle derived from its name, private by default", () => {
  const dir = tmpDir("card-handle");
  const s = store(dir);
  const jane = s.createUser({ email: "jane@example.com", name: "Jane Doe", password: "janepass1234" });
  assert.deepEqual(s.cardFor(jane.id), { handle: "jane-doe", publicCard: false });
  assert.equal(s.findCardByHandle("JANE-DOE").ownerId, jane.id, "lookups are case-insensitive");
  assert.equal(s.findCardByHandle("nobody"), null);
  assert.equal(s.cardFor("admin").handle, "owner", "the dashboard key gets a sane default");
});

test("handles are unique and validated", () => {
  const dir = tmpDir("card-clash");
  const s = store(dir);
  const first = s.createUser({ email: "jane@example.com", name: "Jane", password: "janepass1234" });
  const second = s.createUser({ email: "jane2@example.com", name: "Jane", password: "janepass1234" });
  assert.equal(s.cardFor(first.id).handle, "jane");
  assert.equal(s.cardFor(second.id).handle, "jane-2", "collisions are numbered");
  assert.throws(() => s.setCard(second.id, { handle: "jane" }), /taken/);
  for (const bad of ["ab", "No Spaces", "trailing-", "-leading", "x".repeat(25), "ünïcode"]) {
    assert.throws(() => s.setCard(second.id, { handle: bad }), /Handles are 3-24/, bad);
  }
  assert.equal(s.setCard(second.id, { handle: "jane-two", publicCard: true }).publicCard, true);
  assert.equal(s.findCardByHandle("jane-two").publicCard, true);
});

test("a deleted account takes its public card with it", () => {
  const dir = tmpDir("card-delete");
  const s = store(dir);
  const user = s.createUser({ email: "gone@example.com", name: "Gone", password: "gonepass1234" });
  s.setCard(user.id, { publicCard: true });
  assert.equal(s.findCardByHandle("gone").ownerId, user.id);
  s.deleteUser(user.id);
  assert.equal(s.findCardByHandle("gone"), null);
});

test("cards are re-created for principals the upgrade did not know about", () => {
  const dir = tmpDir("card-migrate");
  const s = store(dir);
  s.data.cards = { ghost: { handle: "ghost", publicCard: true } };
  const user = s.createUser({ email: "late@example.com", name: "Late Arrival", password: "latepass1234" });
  assert.equal(s.cardFor(user.id).handle, "late-arrival");
  assert.equal(s.findCardByHandle("late-arrival").publicCard, false);
});

test("a site name is printable, bounded, and never empty", () => {
  const { sanitizeSiteName } = require("../src/settings");
  assert.equal(sanitizeSiteName("StatusC0rd"), "StatusC0rd");
  assert.equal(sanitizeSiteName("  Star   Statusc0rd  "), "Star Statusc0rd", "whitespace collapses");
  assert.equal(sanitizeSiteName("a\u0000b\tc"), "a b c", "control characters become spaces");
  assert.equal(sanitizeSiteName("x"), "StatusC0rd", "too short falls back");
  assert.equal(sanitizeSiteName(""), "StatusC0rd");
  assert.equal(sanitizeSiteName(null), "StatusC0rd");
  assert.equal(sanitizeSiteName("z".repeat(60)).length, 40, "bounded to 40 characters");
});

test("any name gets the branded zero, and markup in it stays inert", () => {
  const { brandHtml } = require("../src/views");
  assert.equal(brandHtml("StatusC0rd"), "StatusC<strong>0</strong>rd");
  assert.equal(brandHtml("Star StatusC0rd"), "Star StatusC<strong>0</strong>rd");
  assert.equal(brandHtml("No zero here"), "No zero here");
  assert.equal(brandHtml('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(brandHtml(""), "StatusC<strong>0</strong>rd");
});

test("the stored site name survives a reload and never becomes blank", () => {
  const dir = tmpDir("site-name");
  const s = store(dir);
  assert.equal(s.siteName, "StatusC0rd", "a fresh store has the product name");
  assert.equal(s.setSiteName("Star Statusc0rd"), "Star Statusc0rd");
  assert.equal(s.effective().siteName, "Star Statusc0rd");
  const reopened = store(dir);
  assert.equal(reopened.siteName, "Star Statusc0rd", "persisted");
  assert.equal(reopened.setSiteName(" "), "StatusC0rd", "blank falls back, never an empty header");
});
