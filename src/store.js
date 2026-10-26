"use strict";

/**
 * The multi-user store (v5).
 *
 * One JSON file under DATA_DIR holds every account: each Discord user who
 * signs in gets a record with their card, their photos and their publish
 * switch. Instance-wide settings (application id, bot token, keep-alive, site
 * name) and the admin list live beside them, still overridable by the
 * environment. Writes are atomic (tmp file + rename) so a crash never leaves
 * a half-written file behind - on a free host the file is wiped on restart,
 * which is why the environment still wins over every stored value.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DEFAULT_CONFIG } = require("./presence");

const ASSET_LIMIT_PER_USER = 10;

class Store {
  constructor({ dir }) {
    this.dir = path.resolve(String(dir || "./data"));
    this.assetsDir = path.join(this.dir, "assets");
    this.file = path.join(this.dir, "data.json");
    this.legacyFile = path.join(this.dir, "settings.json");
    fs.mkdirSync(this.assetsDir, { recursive: true });
    this.data = this.#read();
    this.#migrateLegacy();
    this.#defaults();
    this.save();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("[store] unreadable data.json, starting fresh:", error.message);
      }
    }
    return {};
  }

  /** v4 was single-owner: lift its settings, and its card if an owner was linked. */
  #migrateLegacy() {
    if (this.data.version === 5) return;
    let old = null;
    try {
      old = JSON.parse(fs.readFileSync(this.legacyFile, "utf8"));
    } catch {
      return;
    }
    if (!old || typeof old !== "object") return;
    try {
      const d = this.data;
      if (old.settings && typeof old.settings === "object") {
        d.settings = Object.assign({}, old.settings);
      }
      if (old.sessionSecret) d.sessionSecret = old.sessionSecret;
      if (old.owner && old.owner.discordId) {
        const id = String(old.owner.discordId);
        const user = this.#newUser(id, old.owner.username);
        user.presence = { ...DEFAULT_CONFIG, ...(old.presence && typeof old.presence === "object" ? old.presence : {}) };
        user.assets = Array.isArray(old.assets) ? old.assets.filter((a) => a && typeof a === "object") : [];
        user.cardPublished = Boolean((old.settings || {}).cardPublished);
        d.users = d.users && typeof d.users === "object" ? d.users : {};
        d.users[id] = user;
        d.adminIds = [id];
      }
      console.log("[store] migrated the v4 single-owner file to v5 accounts.");
    } catch (error) {
      console.warn("[store] could not migrate the v4 file:", error.message);
    }
  }

  #newUser(id, username) {
    return {
      id: String(id),
      username: String(username || "Discord user"),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      cardPublished: false,
      presence: { ...DEFAULT_CONFIG },
      assets: []
    };
  }

  #defaults() {
    const d = this.data;
    d.version = 5;
    if (!d.sessionSecret || String(d.sessionSecret).length < 32) {
      d.sessionSecret = crypto.randomBytes(32).toString("hex");
    }
    d.settings = Object.assign(
      {
        clientId: "",
        clientSecret: "",
        botToken: "",
        siteName: "",
        publicUrl: "",
        keepAlive: true,
        keepAliveMinutes: 10
      },
      d.settings && typeof d.settings === "object" ? d.settings : {}
    );
    d.adminIds = Array.isArray(d.adminIds) ? d.adminIds.map(String).filter(Boolean) : [];
    d.users = d.users && typeof d.users === "object" ? d.users : {};
    for (const id of Object.keys(d.users)) {
      const u = d.users[id];
      u.id = String(id);
      u.username = String(u.username || "Discord user");
      u.cardPublished = u.cardPublished === true;
      u.presence = { ...DEFAULT_CONFIG, ...(u.presence && typeof u.presence === "object" ? u.presence : {}) };
      u.assets = Array.isArray(u.assets) ? u.assets.filter((a) => a && typeof a === "object") : [];
    }
  }

  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  sessionSecret() {
    return process.env.SESSION_SECRET || this.data.sessionSecret;
  }

  get settings() {
    return this.data.settings;
  }

  /* ---- admins ---- */

  get adminIds() {
    return this.data.adminIds.slice();
  }

  isAdmin(id, extraIds) {
    const who = String(id || "");
    if (!who) return false;
    if ((extraIds || []).map(String).includes(who)) return true;
    return this.data.adminIds.includes(who);
  }

  addAdmin(id) {
    const who = String(id || "");
    if (!who || this.data.adminIds.includes(who)) return;
    this.data.adminIds.push(who);
    this.save();
  }

  /* ---- accounts ---- */

  userCount() {
    return Object.keys(this.data.users).length;
  }

  getUser(id) {
    const u = this.data.users[String(id || "")];
    return u && typeof u === "object" ? u : null;
  }

  ensureUser(id, username) {
    const key = String(id || "");
    let user = this.data.users[key];
    if (!user) {
      user = this.#newUser(key, username);
      this.data.users[key] = user;
    } else {
      if (username && user.username !== String(username)) user.username = String(username);
      user.lastSeenAt = new Date().toISOString();
    }
    this.save();
    return user;
  }

  getPresence(id) {
    const user = this.getUser(id);
    return user ? user.presence : { ...DEFAULT_CONFIG };
  }

  setPresence(id, value) {
    const user = this.getUser(id);
    if (!user) return null;
    user.presence = value;
    this.save();
    return value;
  }

  setCardPublished(id, value) {
    const user = this.getUser(id);
    if (!user) return;
    user.cardPublished = value === true;
    this.save();
  }

  /* ---- photos (each asset belongs to one account) ---- */

  get assetLimit() {
    return ASSET_LIMIT_PER_USER;
  }

  userAssets(id) {
    const user = this.getUser(id);
    return user ? user.assets : [];
  }

  findAsset(userId, assetId) {
    return this.userAssets(userId).find((a) => String(a.id) === String(assetId)) || null;
  }

  findAnyAsset(assetId) {
    for (const user of Object.values(this.data.users)) {
      const hit = (user.assets || []).find((a) => String(a.id) === String(assetId));
      if (hit) return hit;
    }
    return null;
  }

  ownsAsset(userId, assetId) {
    return this.findAsset(userId, assetId) !== null;
  }

  /** The same picture uploaded by a second account needs an id of its own. */
  uniqueAssetId(record, userId) {
    if (this.ownsAsset(userId, record.id)) return record;
    if (!this.findAnyAsset(record.id)) return record;
    const mixed = crypto.createHash("sha256").update(record.id + ":" + String(userId)).digest("hex").slice(0, 16);
    return { ...record, id: mixed };
  }

  addAsset(userId, asset) {
    const user = this.getUser(userId);
    if (!user) return;
    user.assets.unshift(asset);
    this.save();
  }

  removeAsset(userId, assetId) {
    const user = this.getUser(userId);
    if (!user) return null;
    const asset = this.findAsset(userId, assetId);
    if (!asset) return null;
    user.assets = user.assets.filter((a) => String(a.id) !== String(asset.id));
    // A card must never reference a photo that no longer exists: the publish
    // after a delete would fail on an image the owner already removed.
    for (const field of ["largeImage", "smallImage"]) {
      if (user.presence[field] === "asset:" + asset.id) user.presence[field] = "";
    }
    this.save();
    try {
      fs.rmSync(this.assetPath(asset));
    } catch {
      /* already gone */
    }
    return asset;
  }

  assetPath(asset) {
    return path.join(this.assetsDir, asset.id + "." + asset.ext);
  }

  assetUrl(asset, publicUrl) {
    const name = asset.id + "." + asset.ext;
    return publicUrl ? String(publicUrl).replace(/\/+$/, "") + "/assets/" + name : "/assets/" + name;
  }
}

module.exports = { Store };
