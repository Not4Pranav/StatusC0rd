"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Persistent application settings, editable from the website.
 *
 * Values come from two places:
 *   1. `data/settings.json` - written by the setup wizard / settings page.
 *   2. environment variables - always win, for managed deployments (Render).
 *
 * Nothing is required at boot: an instance with no settings and no env vars
 * starts in "setup needed" mode and serves the wizard.
 */

const SETTINGS_VERSION = 3;

const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  setupComplete: false,
  createdAt: null,
  updatedAt: null,
  publicUrl: "",
  sessionSecret: "",
  admin: { keyHash: "", keySalt: "", updatedAt: null },
  discord: {
    clientId: "",
    clientSecret: "",
    allowedIds: [],
    botToken: "",
    redirectUri: ""
  },
  presence: null,
  keepAlive: { enabled: true, intervalMinutes: 10 },
  assets: [],
  pairings: []
});

const SCRYPT_KEYLEN = 32;

function hashKey(key, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(key), salt, SCRYPT_KEYLEN).toString("hex");
  return { keyHash: hash, keySalt: salt };
}

function verifyKey(key, { keyHash, keySalt }) {
  if (!keyHash || !keySalt || !key) return false;
  const expected = Buffer.from(keyHash, "hex");
  const actual = crypto.scryptSync(String(key), keySalt, SCRYPT_KEYLEN);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function merge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base?.[key]) ? merge(base[key], value) : value;
  }
  return out;
}

/** Fill in any keys added by a newer version of the app. */
function migrate(raw) {
  const migrated = merge(DEFAULT_SETTINGS, isPlainObject(raw) ? raw : {});
  migrated.version = SETTINGS_VERSION;
  migrated.assets = Array.isArray(migrated.assets) ? migrated.assets.filter(isPlainObject) : [];
  migrated.pairings = Array.isArray(migrated.pairings) ? migrated.pairings.filter(isPlainObject) : [];
  migrated.discord.allowedIds = Array.isArray(migrated.discord.allowedIds)
    ? migrated.discord.allowedIds.filter((id) => /^\d{5,25}$/.test(String(id)))
    : [];
  return migrated;
}

class SettingsStore {
  /**
   * @param {string} file absolute path to settings.json
   * @param {{env?: object, logger?: Console, now?: () => number}} [options]
   */
  constructor(file, options = {}) {
    this.file = file;
    this.logger = options.logger ?? console;
    this.env = options.env ?? {};
    this.now = options.now ?? Date.now;
    this.setupToken = "";
    this.data = this._load();
    if (!this.data.createdAt) {
      this.data.createdAt = new Date(this.now()).toISOString();
      this._write();
    }
    this._ensureSessionSecret();
    this._ensureSetupToken();
  }

  // ------------------------------------------------------------------ files

  _load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      try {
        this.lastSavedAt = fs.statSync(this.file).mtime.toISOString();
      } catch {
        /* ignore */
      }
      return migrate(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(this.file, backup);
          this.logger.warn?.(`[settings] invalid JSON (${error.message}); moved to ${backup}`);
        } catch {
          this.logger.warn?.(`[settings] invalid JSON (${error.message}); using defaults`);
        }
      }
      return migrate({});
    }
  }

  _write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.lastSavedAt = new Date(this.now()).toISOString();
  }

  /** Persist a patch (deep merged) and return the stored value. */
  update(patch) {
    this.data = migrate(merge(this.data, patch));
    this.data.updatedAt = new Date(this.now()).toISOString();
    this._write();
    return this.get();
  }

  /** Raw stored settings (defensive copy, secrets included - server side only). */
  get() {
    return structuredClone(this.data);
  }

  checkWritable() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.accessSync(path.dirname(this.file), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------- bootstrap

  _ensureSessionSecret() {
    if (this.data.sessionSecret && this.data.sessionSecret.length >= 32) return;
    const secret = crypto.randomBytes(32).toString("hex");
    this.data.sessionSecret = secret;
    this._write();
  }

  _ensureSetupToken() {
    if (this.env.SETUP_TOKEN) {
      this.setupToken = String(this.env.SETUP_TOKEN);
      return;
    }
    if (this.data.setupComplete || this.keyFromEnv) return;
    // Written next to the settings file so the owner can read it from the
    // filesystem even if logs are not accessible.
    const tokenFile = path.join(path.dirname(this.file), "setup-token.txt");
    try {
      const existing = fs.readFileSync(tokenFile, "utf8").trim();
      if (existing.length >= 16) {
        this.setupToken = existing;
        return;
      }
    } catch {
      /* generate below */
    }
    const token = crypto.randomBytes(9).toString("hex");
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    this.setupToken = token;
  }

  /** Remove the setup token file once setup is finished. */
  _forgetSetupToken() {
    this.setupToken = "";
    try {
      fs.rmSync(path.join(path.dirname(this.file), "setup-token.txt"), { force: true });
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------- auth

  /** True when the dashboard key is supplied by the environment. */
  get keyFromEnv() {
    return Boolean(this.env.DASHBOARD_KEY);
  }

  get hasAdminKey() {
    return this.keyFromEnv || Boolean(this.data.admin.keyHash);
  }

  verifyAdminKey(key) {
    if (!key) return false;
    if (this.keyFromEnv) {
      const a = crypto.createHash("sha256").update(String(key)).digest();
      const b = crypto.createHash("sha256").update(String(this.env.DASHBOARD_KEY)).digest();
      return crypto.timingSafeEqual(a, b);
    }
    return verifyKey(key, this.data.admin);
  }

  setAdminKey(key) {
    if (!key || String(key).length < 8) {
      throw new Error("The dashboard key must be at least 8 characters long.");
    }
    this.update({
      admin: {
        ...hashKey(key),
        updatedAt: new Date(this.now()).toISOString()
      }
    });
  }

  sessionSecret() {
    return this.env.SESSION_SECRET || this.data.sessionSecret;
  }

  // ------------------------------------------------------------------ setup

  needsSetup() {
    // A deployment that supplies its dashboard key through the environment is
    // already configured - there is nothing left for the wizard to collect. This
    // also matters on hosts with an ephemeral disk (Render's free plan), where
    // data/settings.json is wiped on every restart: without it the site would
    // fall back to /setup after a reboot even though the env is complete.
    if (this.keyFromEnv) return false;
    return !this.data.setupComplete || !this.hasAdminKey;
  }

  /** Compare a submitted setup token in constant time. */
  verifySetupToken(token) {
    if (!this.setupToken) return false;
    const a = crypto.createHash("sha256").update(String(token ?? "")).digest();
    const b = crypto.createHash("sha256").update(this.setupToken).digest();
    return crypto.timingSafeEqual(a, b);
  }

  completeSetup() {
    this.data.setupComplete = true;
    this._write();
    this._forgetSetupToken();
  }

  // ---------------------------------------------------------------- runtime

  /**
   * Effective runtime configuration: stored settings overlaid with env vars.
   * Safe to call on every request (cheap, no I/O).
   */
  effective() {
    const env = this.env;
    const stored = this.data;
    const discord = stored.discord;

    const clientId = String(env.CLIENT_ID || discord.clientId || "").trim();
    const botToken = String(env.DISCORD_TOKEN || discord.botToken || "").trim();
    const publicUrl = String(env.PUBLIC_URL || stored.publicUrl || "").replace(/\/+$/, "");
    const keepAliveEnabled =
      env.KEEP_ALIVE === undefined ? Boolean(stored.keepAlive.enabled) : ["1", "true", "yes", "on"].includes(String(env.KEEP_ALIVE).toLowerCase());

    return {
      clientId,
      clientSecret: String(env.CLIENT_SECRET || discord.clientSecret || "").trim(),
      botToken,
      allowedDiscordIds: Array.isArray(env.ALLOWED_DISCORD_IDS)
        ? env.ALLOWED_DISCORD_IDS
        : discord.allowedIds,
      redirectUri: String(env.REDIRECT_URI || discord.redirectUri || "").trim(),
      publicUrl,
      botEnabled: env.BOT_ENABLED === undefined ? Boolean(botToken) : String(env.BOT_ENABLED) !== "false",
      keepAlive: {
        enabled: keepAliveEnabled && Boolean(publicUrl),
        intervalMinutes:
          Number(env.KEEP_ALIVE_INTERVAL_MINUTES) || Number(stored.keepAlive.intervalMinutes) || 10
      },
      hasBotToken: Boolean(botToken),
      hasClientSecret: Boolean(env.CLIENT_SECRET || discord.clientSecret),
      discordLoginEnabled: Boolean(
        (env.CLIENT_SECRET || discord.clientSecret) && (env.ALLOWED_DISCORD_IDS || discord.allowedIds || []).length
      ),
      managed: {
        clientId: Boolean(env.CLIENT_ID),
        botToken: Boolean(env.DISCORD_TOKEN),
        clientSecret: Boolean(env.CLIENT_SECRET),
        allowedDiscordIds: Boolean(env.ALLOWED_DISCORD_IDS),
        redirectUri: Boolean(env.REDIRECT_URI),
        dashboardKey: Boolean(env.DASHBOARD_KEY),
        publicUrl: Boolean(env.PUBLIC_URL)
      }
    };
  }

  // ----------------------------------------------------------------- assets

  listAssets() {
    return this.data.assets.map((asset) => ({ ...asset }));
  }

  findAsset(id) {
    return this.data.assets.find((asset) => asset.id === id) ?? null;
  }

  addAsset(asset) {
    if (this.data.assets.some((existing) => existing.id === asset.id)) return asset;
    this.update({ assets: [...this.data.assets, asset] });
    return asset;
  }

  removeAsset(id) {
    const next = this.data.assets.filter((asset) => asset.id !== id);
    if (next.length === this.data.assets.length) return false;
    this.update({ assets: next });
    return true;
  }

  // --------------------------------------------------------------- pairings

  hashPairingToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
  }

  /** Create a device pairing; the plaintext token is returned exactly once. */
  createPairing(label) {
    const token = crypto.randomBytes(24).toString("hex");
    const pairing = {
      id: crypto.randomBytes(6).toString("hex"),
      label: String(label || "My computer").slice(0, 60),
      tokenHash: this.hashPairingToken(token),
      createdAt: new Date(this.now()).toISOString(),
      lastSeenAt: null,
      lastStatus: null,
      revokedAt: null
    };
    this.update({ pairings: [...this.data.pairings, pairing] });
    return { pairing: { ...pairing, tokenHash: undefined }, token };
  }

  listPairings() {
    return this.data.pairings.map(({ tokenHash, ...pairing }) => pairing);
  }

  findPairingByToken(token) {
    if (!token) return null;
    const hash = this.hashPairingToken(token);
    return (
      this.data.pairings.find(
        (pairing) => !pairing.revokedAt && pairing.tokenHash === hash
      ) ?? null
    );
  }

  touchPairing(id, status) {
    const pairings = this.data.pairings.map((pairing) =>
      pairing.id === id
        ? {
            ...pairing,
            lastSeenAt: new Date(this.now()).toISOString(),
            lastStatus: status ? String(status).slice(0, 40) : pairing.lastStatus
          }
        : pairing
    );
    this.update({ pairings });
  }

  revokePairing(id) {
    const pairings = this.data.pairings.map((pairing) =>
      pairing.id === id ? { ...pairing, revokedAt: new Date(this.now()).toISOString() } : pairing
    );
    this.update({ pairings });
  }
}

module.exports = {
  SettingsStore,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  hashKey,
  verifyKey,
  migrate
};
