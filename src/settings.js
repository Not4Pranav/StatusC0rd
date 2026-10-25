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

const SETTINGS_VERSION = 5;

/**
 * The account the dashboard key signs in as.
 *
 * It is a principal, not a row in `users`: the key is the owner's way back in
 * even if every member account is gone, and it must never be editable from the
 * member list. Everything per-user (presence, draft, photos) is keyed by a
 * user id, and the admin key uses this one.
 */
const ADMIN_USER_ID = "admin";

const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  setupComplete: false,
  createdAt: null,
  updatedAt: null,
  publicUrl: "",
  sessionSecret: "",
  // The admin panel key. Distinct from a member password on purpose.
  admin: { keyHash: "", keySalt: "", updatedAt: null },
  discord: {
    clientId: "",
    clientSecret: "",
    allowedIds: [],
    botToken: "",
    redirectUri: ""
  },
  // Open sign-up for server members. The admin panel can turn it off.
  allowSignup: true,
  // Member accounts. The admin key is NOT in here - see ADMIN_USER_ID.
  users: [],
  // Everything below is keyed by user id, with the admin key's data under
  // "admin". One instance, many cards: the bot card belongs to the admin,
  // every member's card goes to their own profile through the in-Discord app.
  presences: {},
  drafts: {},
  // discord user id -> StatusC0rd user id, written by "Connect Discord".
  discordLinks: {},
  keepAlive: { enabled: true, intervalMinutes: 10 },
  assets: []
});

const SCRYPT_KEYLEN = 32;

/** Member passwords are the second way in (the dashboard key is the first). */
const MIN_PASSWORD = 10;
/** The dashboard key floor, enforced by the wizard, the settings page and here. */
const MIN_KEY_LENGTH = 12;
const MAX_USERS = 500;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : "";
}

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

/** Interpret the usual truthy/falsy spellings people put in a .env file. */
function parseFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(text)) return true;
  if (["0", "false", "no", "off", "n"].includes(text)) return false;
  return fallback;
}

/** The keep-alive interval is documented as 5-60 minutes; enforce it. */
function clampKeepAliveInterval(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return 10;
  return Math.max(5, Math.min(60, Math.round(minutes)));
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
  const source = isPlainObject(raw) ? raw : {};
  const migrated = merge(DEFAULT_SETTINGS, source);
  migrated.version = SETTINGS_VERSION;
  migrated.assets = Array.isArray(migrated.assets) ? migrated.assets.filter(isPlainObject) : [];
  migrated.discord.allowedIds = Array.isArray(migrated.discord.allowedIds)
    ? migrated.discord.allowedIds.filter((id) => /^\d{5,25}$/.test(String(id)))
    : [];

  // v3 -> v4: one presence per instance became one per user. The instance's
  // existing card, draft and photos belong to the admin key's principal, so
  // nobody loses anything on upgrade.
  const legacyPresence = isPlainObject(source.presence) ? source.presence : null;
  const legacyDraft = isPlainObject(source.draft) ? source.draft : null;

  migrated.presences = isPlainObject(migrated.presences) ? migrated.presences : {};
  if (legacyPresence && !isPlainObject(migrated.presences[ADMIN_USER_ID])) {
    migrated.presences[ADMIN_USER_ID] = legacyPresence;
  }
  migrated.drafts = isPlainObject(migrated.drafts) ? migrated.drafts : {};
  if (legacyDraft && !isPlainObject(migrated.drafts[ADMIN_USER_ID])) {
    migrated.drafts[ADMIN_USER_ID] = legacyDraft;
  }

  // Everything a person can own carries an owner; pre-v4 data is the admin's.
  const withOwner = (item) => ({ ...item, owner: String(item.owner || ADMIN_USER_ID) });
  migrated.assets = migrated.assets.map(withOwner);

  // v4 -> v5: the companion is gone, so the card's second target is simply the
  // person's own profile. Stored cards keep their setting under the new name.
  for (const presence of Object.values(migrated.presences)) {
    if (!isPlainObject(presence)) continue;
    if (!isPlainObject(presence.targets)) presence.targets = { bot: true, profile: true };
    if (presence.targets.profile === undefined) {
      presence.targets.profile = presence.targets.companion !== false;
    }
    delete presence.targets.companion;
  }

  migrated.users = (Array.isArray(migrated.users) ? migrated.users : [])
    .filter(
      (user) =>
        isPlainObject(user) &&
        /^u_[a-f0-9]{6,20}$/.test(String(user.id || "")) &&
        normalizeEmail(user.email) === user.email &&
        Boolean(user.passHash) &&
        Boolean(user.passSalt)
    )
    .map((user) => ({
      ...user,
      role: user.role === "admin" ? "admin" : "member",
      disabled: Boolean(user.disabled),
      discordId: /^\d{5,25}$/.test(String(user.discordId || "")) ? String(user.discordId) : null
    }))
    .slice(0, MAX_USERS);

  const links = {};
  for (const [discordId, userId] of Object.entries(
    isPlainObject(migrated.discordLinks) ? migrated.discordLinks : {}
  )) {
    if (!/^\d{5,25}$/.test(discordId)) continue;
    if (String(userId) !== ADMIN_USER_ID && !migrated.users.some((user) => user.id === userId)) continue;
    links[discordId] = String(userId);
  }
  migrated.discordLinks = links;

  migrated.allowSignup = migrated.allowSignup !== false;

  // The v3 keys are gone; keeping them would let stale data win on the next read.
  delete migrated.presence;
  delete migrated.draft;
  delete migrated.share;
  delete migrated.shares;
  delete migrated.pairings;
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
    /** True when the file was missing or unreadable: the asset list may be lost. */
    this.recovered = false;
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
    if (!fs.existsSync(this.file)) this.recovered = true;
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      try {
        this.lastSavedAt = fs.statSync(this.file).mtime.toISOString();
      } catch {
        /* ignore */
      }
      return migrate(JSON.parse(raw));
    } catch (error) {
      // Whatever was in there is gone: never let a later prune() read this as
      // "the owner has no photos" and delete the files.
      this.recovered = true;
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
    // Normally the token is only for a first run. But an instance can lose its
    // dashboard key (a hand-edited or half-restored settings.json) while still
    // being marked complete - then the wizard is the only way back in, and it
    // needs a token when the request comes from the internet.
    if (this.keyFromEnv || (this.data.setupComplete && this.data.admin.keyHash)) return;
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
    if (!key || String(key).length < MIN_KEY_LENGTH) {
      throw new Error(`The dashboard key must be at least ${MIN_KEY_LENGTH} characters long.`);
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

  // ------------------------------------------------------------------ users

  /**
   * Commit the per-user maps.
   *
   * These must NOT go through `update()`: it deep-merges, so publishing a card
   * without a button would keep the previous button alive. A whole-map write is
   * the only correct semantics here.
   */
  _commit() {
    this.data = migrate(this.data);
    this.data.updatedAt = new Date(this.now()).toISOString();
    this._write();
    return this;
  }

  /** The principal the dashboard key signs in as. Never a row in `users`. */
  get adminUserId() {
    return ADMIN_USER_ID;
  }

  get allowSignup() {
    return this.data.allowSignup !== false;
  }

  setAllowSignup(value) {
    this.update({ allowSignup: Boolean(value) });
  }

  /** Public shape: hashes never leave the store. */
  static publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      disabled: Boolean(user.disabled),
      discordId: user.discordId || null,
      linked: Boolean(user.discordId),
      createdAt: user.createdAt || null,
      lastLoginAt: user.lastLoginAt || null
    };
  }

  listUsers() {
    return this.data.users.map((user) => SettingsStore.publicUser(user));
  }

  countUsers() {
    return this.data.users.length;
  }

  findUserById(id) {
    return this.data.users.find((user) => user.id === id) ?? null;
  }

  findUserByEmail(email) {
    const wanted = normalizeEmail(email);
    if (!wanted) return null;
    return this.data.users.find((user) => user.email === wanted) ?? null;
  }

  /**
   * Create a member account. Throws with a human message on bad input, so both
   * the admin panel and the sign-up form can show it verbatim.
   */
  createUser({ email, name, password, discordId = null }) {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error("That email address does not look right.");
    if (this.findUserByEmail(normalized)) throw new Error("An account with that email already exists.");
    if (String(password ?? "").length < MIN_PASSWORD) {
      throw new Error(`Passwords need at least ${MIN_PASSWORD} characters.`);
    }
    if (this.data.users.length >= MAX_USERS) {
      throw new Error(`This instance holds ${MAX_USERS} accounts. Remove one first.`);
    }
    const { keyHash, keySalt } = hashKey(password);
    const stamp = new Date(this.now()).toISOString();
    const user = {
      id: `u_${crypto.randomBytes(5).toString("hex")}`,
      email: normalized,
      name:
        String(name ?? "").trim().slice(0, 60) ||
        normalized.split("@")[0].replace(/[._-]+/g, " ").slice(0, 60),
      // One owner: the dashboard key. Accounts are always members, even if a
      // caller asks for another role - the admin panel has a single door.
      role: "member",
      passHash: keyHash,
      passSalt: keySalt,
      createdAt: stamp,
      updatedAt: stamp,
      passwordChangedAt: stamp,
      lastLoginAt: null,
      disabled: false,
      discordId: /^\d{5,25}$/.test(String(discordId || "")) ? String(discordId) : null
    };
    this.data.users.push(user);
    this._commit();
    return SettingsStore.publicUser(user);
  }

  /** Email + password check. Returns the row (hashes included), or null. */
  verifyCredentials(email, password) {
    const user = this.findUserByEmail(email);
    if (!user || user.disabled) return null;
    if (!password) return null;
    if (!verifyKey(String(password), { keyHash: user.passHash, keySalt: user.passSalt })) return null;
    return user;
  }

  touchUserLogin(id) {
    const users = this.data.users.map((user) =>
      user.id === id ? { ...user, lastLoginAt: new Date(this.now()).toISOString() } : user
    );
    this.data.users = users;
    this._commit();
  }

  setUserPassword(id, password) {
    if (String(password ?? "").length < MIN_PASSWORD) {
      throw new Error(`Passwords need at least ${MIN_PASSWORD} characters.`);
    }
    const { keyHash, keySalt } = hashKey(password);
    const stamp = new Date(this.now()).toISOString();
    const users = this.data.users.map((user) =>
      user.id === id
        ? { ...user, passHash: keyHash, passSalt: keySalt, updatedAt: stamp, passwordChangedAt: stamp }
        : user
    );
    this.data.users = users;
    this._commit();
  }

  /** Patch a member: name, email, role, disabled. Ids and hashes stay put. */
  updateUser(id, patch = {}) {
    const current = this.findUserById(id);
    if (!current) throw new Error("No such account.");
    const next = { ...current };
    if (patch.name !== undefined) next.name = String(patch.name).trim().slice(0, 60) || current.name;
    if (patch.email !== undefined) {
      const email = normalizeEmail(patch.email);
      if (!email) throw new Error("That email address does not look right.");
      const clash = this.findUserByEmail(email);
      if (clash && clash.id !== id) throw new Error("An account with that email already exists.");
      next.email = email;
    }
    // `role` is deliberately not settable here: promoting a member would open
    // the admin panel without the dashboard key. See createUser().
    if (patch.role !== undefined && patch.role !== "member") {
      throw new Error("Accounts are members; the admin panel opens with the dashboard key.");
    }
    if (patch.disabled !== undefined) next.disabled = Boolean(patch.disabled);
    next.updatedAt = new Date(this.now()).toISOString();
    this.data.users = this.data.users.map((user) => (user.id === id ? next : user));
    this._commit();
    return SettingsStore.publicUser(next);
  }

  /**
   * Remove an account and everything it owns. The files go too, otherwise the
   * photos keep occupying the disk with nothing pointing at them.
   */
  deleteUser(id) {
    const before = this.data.users.length;
    this.data.users = this.data.users.filter((user) => user.id !== id);
    if (this.data.users.length === before) return { removed: false, assetIds: [] };

    const assetIds = this.data.assets.filter((asset) => asset.owner === id).map((asset) => asset.id);
    this.data.assets = this.data.assets.filter((asset) => asset.owner !== id);
    delete this.data.presences[id];
    delete this.data.drafts[id];
    for (const [discordId, userId] of Object.entries(this.data.discordLinks)) {
      if (userId === id) delete this.data.discordLinks[discordId];
    }
    this._commit();
    return { removed: true, assetIds };
  }

  // ------------------------------------------------------- discord account link

  /**
   * Tie a Discord account to a StatusC0rd account.
   *
   * This is what lets the in-Discord app know whose card to push: the Activity
   * only ever learns the Discord user id, so the mapping has to be stored here.
   */
  linkDiscord(discordId, userId) {
    const id = String(discordId || "");
    if (!/^\d{5,25}$/.test(id)) throw new Error("That Discord account id does not look right.");
    if (userId !== ADMIN_USER_ID && !this.findUserById(userId)) throw new Error("No such account.");
    const existing = this.data.discordLinks[id];
    if (existing && existing !== userId) {
      throw new Error("That Discord account is already linked to a different StatusC0rd account.");
    }
    const users = this.data.users.map((user) =>
      user.id === userId ? { ...user, discordId: id, updatedAt: new Date(this.now()).toISOString() } : user
    );
    this.data.users = users;
    this.data.discordLinks[id] = userId;
    this._commit();
    return userId;
  }

  unlinkDiscord(userId) {
    for (const [discordId, linked] of Object.entries(this.data.discordLinks)) {
      if (linked === userId) delete this.data.discordLinks[discordId];
    }
    this.data.users = this.data.users.map((user) =>
      user.id === userId ? { ...user, discordId: null, updatedAt: new Date(this.now()).toISOString() } : user
    );
    this._commit();
  }

  /** Discord user id -> StatusC0rd user id, or null. */
  userIdForDiscord(discordId) {
    const id = String(discordId || "");
    if (!/^\d{5,25}$/.test(id)) return null;
    const linked = this.data.discordLinks[id];
    if (!linked) return null;
    if (linked !== ADMIN_USER_ID && !this.findUserById(linked)) return null;
    return linked;
  }

  discordIdForUser(userId) {
    if (userId === ADMIN_USER_ID) {
      const found = Object.entries(this.data.discordLinks).find(([, linked]) => linked === ADMIN_USER_ID);
      return found ? found[0] : null;
    }
    return this.data.users.find((user) => user.id === userId)?.discordId ?? null;
  }

  // ------------------------------------------------------- per-user presence

  presenceFor(userId = ADMIN_USER_ID) {
    return this.data.presences[userId] ?? null;
  }

  setPresence(userId, presence) {
    if (presence) this.data.presences[userId] = presence;
    else delete this.data.presences[userId];
    this._commit();
    return this.presenceFor(userId);
  }

  draftFor(userId = ADMIN_USER_ID) {
    return this.data.drafts[userId] ?? null;
  }

  setDraft(userId, draft) {
    if (draft) this.data.drafts[userId] = draft;
    else delete this.data.drafts[userId];
    this._commit();
    return this.draftFor(userId);
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
    const keepAliveEnabled = parseFlag(env.KEEP_ALIVE, Boolean(stored.keepAlive.enabled));

    return {
      clientId,
      clientSecret: String(env.CLIENT_SECRET || discord.clientSecret || "").trim(),
      botToken,
      allowedDiscordIds: Array.isArray(env.ALLOWED_DISCORD_IDS)
        ? env.ALLOWED_DISCORD_IDS
        : discord.allowedIds,
      redirectUri: String(env.REDIRECT_URI || discord.redirectUri || "").trim(),
      publicUrl,
      botEnabled: parseFlag(env.BOT_ENABLED, Boolean(botToken)),
      keepAlive: {
        enabled: keepAliveEnabled && Boolean(publicUrl),
        intervalMinutes: clampKeepAliveInterval(
          Number(env.KEEP_ALIVE_INTERVAL_MINUTES) || Number(stored.keepAlive.intervalMinutes)
        )
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

  /** Every photo, or one owner's. */
  listAssets(owner = null) {
    const assets = owner ? this.data.assets.filter((asset) => asset.owner === owner) : this.data.assets;
    return assets.map((asset) => ({ ...asset }));
  }

  /** Does this owner hold this photo? Used before serving or deleting it. */
  ownsAsset(id, owner) {
    return this.data.assets.some((asset) => asset.id === id && asset.owner === owner);
  }

  findAsset(id) {
    return this.data.assets.find((asset) => asset.id === id) ?? null;
  }

  /**
   * Record an upload. A file is stored once (content-hashed), so an identical
   * photo uploaded by two members is one file with two owners' entries.
   */
  addAsset(asset, owner = ADMIN_USER_ID) {
    const existing = this.data.assets.find((item) => item.id === asset.id && item.owner === owner);
    if (existing) return existing;
    this.data.assets = [...this.data.assets, { ...asset, owner }];
    this._commit();
    return { ...asset, owner };
  }

  /**
   * Drop every reference to a photo from one account's card and draft.
   *
   * Deleting a photo otherwise leaves `asset:<id>` in the stored card: the
   * picture disappears from Discord and the next publish fails validation for a
   * reason the person never caused. Called right after the entry is removed.
   */
  clearAssetReferences(id, owner = ADMIN_USER_ID) {
    const ref = `asset:${id}`;
    let changed = false;
    for (const map of [this.data.presences, this.data.drafts]) {
      const card = map[owner];
      if (!isPlainObject(card)) continue;
      for (const field of ["largeImage", "smallImage"]) {
        if (card[field] === ref) {
          card[field] = "";
          changed = true;
        }
      }
    }
    if (changed) this._commit();
    return changed;
  }

  /** Remove one owner's entry; the file survives while another owner has it. */
  removeAsset(id, owner = ADMIN_USER_ID) {
    const next = this.data.assets.filter((asset) => !(asset.id === id && asset.owner === owner));
    if (next.length === this.data.assets.length) return { removed: false, fileUnused: false };
    this.data.assets = next;
    this._commit();
    const fileUnused = !this.data.assets.some((asset) => asset.id === id);
    return { removed: true, fileUnused };
  }
}

module.exports = {
  SettingsStore,
  ADMIN_USER_ID,
  MIN_PASSWORD,
  MIN_KEY_LENGTH,
  MAX_USERS,
  normalizeEmail,
  parseFlag,
  clampKeepAliveInterval
};
