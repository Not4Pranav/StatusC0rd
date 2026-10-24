"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SettingsStore, hashKey, verifyKey, migrate } = require("../src/settings");

const silent = { warn() {}, log() {}, error() {} };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-settings-"));
}

function makeStore(env = {}) {
  const dir = tmpDir();
  const store = new SettingsStore(path.join(dir, "settings.json"), { env, logger: silent });
  return { store, dir };
}

test("a fresh instance needs setup and generates its own secrets", () => {
  const { store, dir } = makeStore();
  assert.equal(store.needsSetup(), true);
  assert.equal(store.sessionSecret().length, 64);
  assert.ok(store.setupToken.length >= 16);
  assert.ok(fs.existsSync(path.join(dir, "setup-token.txt")));
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dir, "settings.json")).mode & 0o777, 0o600);
  }
});

test("hashes and verifies the dashboard key with scrypt", () => {
  const { store } = makeStore();
  store.setAdminKey("correct horse battery staple");
  assert.equal(store.hasAdminKey, true);
  assert.equal(store.verifyAdminKey("correct horse battery staple"), true);
  assert.equal(store.verifyAdminKey("wrong"), false);
  assert.equal(store.verifyAdminKey(""), false);
  assert.match(store.get().admin.keyHash, /^[a-f0-9]{64}$/);
  // the plaintext must never be stored
  assert.equal(JSON.stringify(store.get()).includes("battery staple"), false);
});

test("rejects short keys", () => {
  const { store } = makeStore();
  assert.throws(() => store.setAdminKey("short"), /at least 8/);
});

test("an environment dashboard key overrides the stored one", () => {
  const { store } = makeStore({ DASHBOARD_KEY: "env-provided-key-123" });
  assert.equal(store.keyFromEnv, true);
  assert.equal(store.verifyAdminKey("env-provided-key-123"), true);
  assert.equal(store.verifyAdminKey("something else"), false);
});

test("setup token verification, completion and file cleanup", () => {
  const { store, dir } = makeStore();
  const token = store.setupToken;
  assert.equal(store.verifySetupToken(token), true);
  assert.equal(store.verifySetupToken("nope"), false);
  store.setAdminKey("a-good-dashboard-key");
  store.completeSetup();
  assert.equal(store.needsSetup(), false);
  assert.equal(store.setupToken, "");
  assert.equal(fs.existsSync(path.join(dir, "setup-token.txt")), false);
});

test("persists values across instances", () => {
  const dir = tmpDir();
  const file = path.join(dir, "settings.json");
  const first = new SettingsStore(file, { logger: silent });
  first.update({ publicUrl: "https://status.example.com" });
  first.setAdminKey("persisted-key-1234");
  first.createPairing("laptop");

  const second = new SettingsStore(file, { logger: silent });
  assert.equal(second.get().publicUrl, "https://status.example.com");
  assert.equal(second.verifyAdminKey("persisted-key-1234"), true);
  assert.equal(second.listPairings().length, 1);
  assert.equal(second.sessionSecret(), first.sessionSecret(), "session secret must be stable");
});

test("recovers from corrupt JSON", () => {
  const dir = tmpDir();
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, "{ broken");
  const warnings = [];
  const store = new SettingsStore(file, { logger: { ...silent, warn: (m) => warnings.push(m) } });
  assert.equal(store.needsSetup(), true);
  assert.equal(warnings.length, 1);
});

test("pairing tokens are stored hashed and revocable", () => {
  const { store } = makeStore();
  const { token, pairing } = store.createPairing("desktop");
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 32);
  assert.equal(JSON.stringify(store.get()).includes(token), false, "plaintext token must not be stored");

  const found = store.findPairingByToken(token);
  assert.equal(found.id, pairing.id);
  assert.equal(store.findPairingByToken("wrong"), null);

  store.touchPairing(pairing.id, "connected");
  assert.equal(store.listPairings()[0].lastStatus, "connected");
  assert.ok(store.listPairings()[0].lastSeenAt);

  store.revokePairing(pairing.id);
  assert.equal(store.findPairingByToken(token), null);
  assert.ok(store.listPairings()[0].revokedAt);
});

test("assets are added once and removed", () => {
  const { store } = makeStore();
  store.addAsset({ id: "abc123", ext: "png", mime: "image/png" });
  store.addAsset({ id: "abc123", ext: "png", mime: "image/png" });
  assert.equal(store.listAssets().length, 1);
  assert.ok(store.findAsset("abc123"));
  assert.equal(store.removeAsset("abc123"), true);
  assert.equal(store.removeAsset("missing"), false);
});

test("effective config merges stored settings with environment overrides", () => {
  const { store } = makeStore({
    CLIENT_ID: "111111111111111111",
    DISCORD_TOKEN: "env-token",
    ALLOWED_DISCORD_IDS: ["222222222222222222"],
    CLIENT_SECRET: "env-secret",
    PUBLIC_URL: "https://env.example.com/"
  });
  store.update({
    discord: { botToken: "stored-token", clientId: "999999999999999999", allowedIds: ["333333333333333333"] }
  });
  const effective = store.effective();
  assert.equal(effective.clientId, "111111111111111111");
  assert.equal(effective.botToken, "env-token");
  assert.deepEqual(effective.allowedDiscordIds, ["222222222222222222"]);
  assert.equal(effective.publicUrl, "https://env.example.com");
  assert.equal(effective.discordLoginEnabled, true);
  assert.equal(effective.managed.botToken, true);
  assert.equal(effective.managed.clientSecret, true);
});

test("keep-alive needs a public url", () => {
  const { store } = makeStore();
  assert.equal(store.effective().keepAlive.enabled, false);
  store.update({ publicUrl: "https://status.example.com" });
  assert.equal(store.effective().keepAlive.enabled, true);
});

test("migrate fills missing keys and drops junk", () => {
  const migrated = migrate({
    publicUrl: "https://x.dev",
    discord: { clientId: "123456789" },
    assets: [{ id: "a" }, "junk"],
    pairings: null
  });
  assert.equal(migrated.publicUrl, "https://x.dev");
  assert.equal(migrated.discord.clientId, "123456789");
  assert.equal(migrated.keepAlive.enabled, true);
  assert.equal(migrated.assets.length, 1);
  assert.deepEqual(migrated.pairings, []);
});

test("hashKey/verifyKey round trip", () => {
  const hashed = hashKey("secret-value");
  assert.equal(verifyKey("secret-value", hashed), true);
  assert.equal(verifyKey("secret-valuf", hashed), false);
  assert.equal(verifyKey("secret-value", {}), false);
});
