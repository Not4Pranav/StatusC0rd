"use strict";

/**
 * The single-owner store.
 *
 * One JSON file under DATA_DIR holds everything this app persists: the hashed
 * dashboard key, the Discord link, the card, the photo list and the instance
 * settings. Writes are atomic (tmp file + rename) so a crash never leaves a
 * half-written file behind - on a free host that file is wiped on restart,
 * which is why the environment still wins over every stored value.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DEFAULT_CONFIG } = require("./presence");

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

class Store {
  constructor({ dir }) {
    this.dir = path.resolve(String(dir || "./data"));
    this.assetsDir = path.join(this.dir, "assets");
    this.file = path.join(this.dir, "settings.json");
    fs.mkdirSync(this.assetsDir, { recursive: true });
    this.data = this.#read();
    this.#defaults();
    this.save();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("[store] unreadable settings.json, starting fresh:", error.message);
      }
    }
    return {};
  }

  #defaults() {
    const d = this.data;
    d.version = 4;
    d.keyHash = typeof d.keyHash === "string" && d.keyHash.includes(":") ? d.keyHash : null;
    if (!d.sessionSecret || String(d.sessionSecret).length < 32) {
      d.sessionSecret = crypto.randomBytes(32).toString("hex");
    }
    d.owner = d.owner && typeof d.owner === "object"
      ? { discordId: d.owner.discordId || null, username: d.owner.username || null }
      : { discordId: null, username: null };
    d.presence = { ...DEFAULT_CONFIG, ...(d.presence && typeof d.presence === "object" ? d.presence : {}) };
    d.assets = Array.isArray(d.assets) ? d.assets.filter((a) => a && typeof a === "object") : [];
    d.settings = Object.assign(
      {
        clientId: "",
        clientSecret: "",
        botToken: "",
        siteName: "",
        publicUrl: "",
        keepAlive: true,
        keepAliveMinutes: 10,
        cardPublished: false
      },
      d.settings && typeof d.settings === "object" ? d.settings : {}
    );
  }

  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /* ---- dashboard key ---- */

  sessionSecret() {
    return process.env.SESSION_SECRET || this.data.sessionSecret;
  }

  hasKey() {
    return Boolean(process.env.DASHBOARD_KEY || this.data.keyHash);
  }

  verifyKey(candidate) {
    const value = String(candidate || "");
    const envKey = process.env.DASHBOARD_KEY ? String(process.env.DASHBOARD_KEY) : null;
    if (envKey) {
      const a = Buffer.from(envKey);
      const b = Buffer.from(value);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!this.data.keyHash) return false;
    const [salt, hex] = this.data.keyHash.split(":");
    if (!salt || !hex) return false;
    const check = crypto.scryptSync(value, salt, 64, SCRYPT_OPTS);
    const expected = Buffer.from(hex, "hex");
    return check.length === expected.length && crypto.timingSafeEqual(check, expected);
  }

  setKey(value) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(value), salt, 64, SCRYPT_OPTS).toString("hex");
    this.data.keyHash = salt + ":" + hash;
    this.save();
  }

  /** First boot with no key anywhere: make one, keep its hash, hand it to the log. */
  generateKey() {
    const key = crypto.randomBytes(9).toString("hex");
    this.setKey(key);
    return key;
  }

  /* ---- the card ---- */

  get presence() {
    return this.data.presence;
  }

  setPresence(value) {
    this.data.presence = value;
    this.save();
  }

  /* ---- instance settings (env wins via effective(), never stored twice) ---- */

  get settings() {
    return this.data.settings;
  }

  /* ---- the owner's Discord link ---- */

  get owner() {
    return this.data.owner;
  }

  linkDiscord(id, username) {
    this.data.owner = { discordId: String(id), username: String(username || "Discord user") };
    this.save();
  }

  /* ---- photos ---- */

  get assets() {
    return this.data.assets;
  }

  addAsset(asset) {
    this.data.assets.unshift(asset);
    this.save();
  }

  findAsset(id) {
    return this.data.assets.find((a) => String(a.id) === String(id)) || null;
  }

  ownsAsset(id) {
    return this.findAsset(id) !== null;
  }

  removeAsset(id) {
    const asset = this.findAsset(id);
    if (!asset) return null;
    this.data.assets = this.data.assets.filter((a) => a.id !== asset.id);
    // A card must never reference a photo that no longer exists: the publish
    // after a delete would fail on an image the owner already removed.
    for (const field of ["largeImage", "smallImage"]) {
      if (this.data.presence[field] === "asset:" + asset.id) this.data.presence[field] = "";
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
