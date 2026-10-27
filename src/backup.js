"use strict";

/**
 * Off-host persistence. The free host wipes the disk on every restart,
 * so the store ships itself to a PRIVATE GitHub repository every few
 * minutes and restores from it at boot when the local file came up empty.
 *
 *   BACKUP_GITHUB_REPO        "owner/name" of the private repository
 *   BACKUP_GITHUB_TOKEN       fine-grained PAT, Contents read+write, that repo only
 *   BACKUP_GITHUB_BRANCH      optional, default "main"
 *   BACKUP_INTERVAL_MINUTES  optional flush cadence, default 5, minimum 1
 */

const API = "https://api.github.com";
const fs = require("node:fs");

function backupConfig() {
  const repo = String(process.env.BACKUP_GITHUB_REPO || "").trim();
  const token = String(process.env.BACKUP_GITHUB_TOKEN || "").trim();
  return {
    enabled: Boolean(repo && token),
    repo,
    token,
    branch: String(process.env.BACKUP_GITHUB_BRANCH || "main").trim() || "main",
    file: String(process.env.BACKUP_FILE || "data.json").trim() || "data.json",
    intervalMinutes: Math.max(1, Number(process.env.BACKUP_INTERVAL_MINUTES || 5) || 5)
  };
}

function api(config, path, options) {
  const headers = Object.assign(
    {
      "authorization": "Bearer " + config.token,
      "accept": "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "StatusC0rd-backup"
    },
    options && options.headers ? options.headers : {}
  );
  return fetch(API + path, Object.assign({}, options, { headers }));
}

function encode(text) { return Buffer.from(text, "utf8").toString("base64"); }
function decode(b64) { return Buffer.from(b64, "base64").toString("utf8"); }

class Backup {
  constructor({ store }) {
    this.store = store;
    this.config = backupConfig();
    this.dirty = true; /* the first flush ships the current state */
    this.sha = null;
    this.timer = null;
    this.pushing = false;
    this.manifest = null;
    this.manifestSha = null;
  }

  /** The remote copy, or null when the repo has none yet. */
  async fetchRemote() {
    const path = "/repos/" + this.config.repo + "/contents/" + encodeURIComponent(this.config.file) + "?ref=" + encodeURIComponent(this.config.branch);
    const res = await api(this.config, path, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("backup read failed: HTTP " + res.status);
    const body = await res.json();
    this.sha = body.sha;
    return decode(body.content || "");
  }

  async push(text) {
    const payload = {
      message: "StatusC0rd data backup " + new Date().toISOString(),
      content: encode(text),
      branch: this.config.branch
    };
    if (this.sha) payload.sha = this.sha;
    const path = "/repos/" + this.config.repo + "/contents/" + encodeURIComponent(this.config.file);
    const res = await api(this.config, path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let detail = "";
      try {
        const err = await res.json();
        if (err && err.message) detail = " (" + err.message + ")";
      } catch {}
      throw new Error("backup write failed: HTTP " + res.status + detail + " - the token needs Contents: Read and write on " + this.config.repo);
    }
    const body = await res.json();
    if (body.content && body.content.sha) this.sha = body.content.sha;
    this.dirty = false;
  }

  /** At boot: restore the remote copy when the local disk is fresh. */
  async init() {
    if (!this.config.enabled) return;
    try {
      await this.loadManifest();
    } catch (error) {
      console.warn("[backup] could not read the photo manifest:", error.message);
      if (!this.manifest) this.manifest = {};
    }
    try {
      const remote = await this.fetchRemote();
      if (remote && this.store.userCount() === 0) {
        const parsed = JSON.parse(remote);
        const restoredUsers = parsed && parsed.users ? Object.keys(parsed.users).length : 0;
        const restoredSettings = parsed && parsed.settings && typeof parsed.settings === "object" ? Object.keys(parsed.settings).length : 0;
        if (parsed && typeof parsed === "object" && (restoredUsers || restoredSettings)) {
          this.store.adopt(parsed);
          this.dirty = true;
          console.log("[backup] restored " + restoredUsers + " account(s) from " + this.config.repo + ".");
          await this.restoreAssets().catch((error) => console.warn("[backup] photo restore failed:", error.message));
        }
      } else if (!remote) {
        console.log("[backup] connected; the first flush will create " + this.config.file + " in " + this.config.repo + ".");
      } else {
        this.dirty = false; /* remote is behind a local disk that already has accounts */
        console.log("[backup] connected; local data kept.");
      }
    } catch (error) {
      console.warn("[backup] could not read the remote copy:", error.message);
    }
    setTimeout(() => { void this.flush(); }, 15000).unref();
    this.timer = setInterval(() => { void this.flush(); }, this.config.intervalMinutes * 60 * 1000);
    this.timer.unref();
  }

  /** Every photo in the store as [{ key, id, ext }] - key is "id.ext". */
  assetList() {
    const out = [];
    const users = (this.store.data && this.store.data.users) || {};
    for (const userId of Object.keys(users)) {
      for (const asset of (users[userId] && users[userId].assets) || []) {
        if (asset && asset.id && asset.ext) out.push({ key: asset.id + "." + asset.ext, id: asset.id, ext: asset.ext });
      }
    }
    return out;
  }

  /** Fetch a small text file from the backup repo (null when absent). */
  async getFile(path) {
    const url = "/repos/" + this.config.repo + "/contents/" + path + "?ref=" + encodeURIComponent(this.config.branch);
    const res = await api(this.config, url, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("backup read failed: HTTP " + res.status + " for " + path);
    const body = await res.json();
    return { sha: body.sha, content: decode(body.content || "") };
  }

  /** Fetch a binary file (photos can pass the 1 MB JSON limit, so raw). */
  async getBinary(path) {
    const url = "/repos/" + this.config.repo + "/contents/" + path + "?ref=" + encodeURIComponent(this.config.branch);
    const res = await api(this.config, url, { method: "GET", headers: { accept: "application/vnd.github.raw" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("backup read failed: HTTP " + res.status + " for " + path);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Create or update a file, resolving sha conflicts, and return its new sha. */
  async putFile(path, buf, sha, message) {
    const url = "/repos/" + this.config.repo + "/contents/" + path;
    const send = async (fileSha) => {
      const payload = { message: message || "StatusC0rd backup " + new Date().toISOString(), content: buf.toString("base64"), branch: this.config.branch };
      if (fileSha) payload.sha = fileSha;
      return api(this.config, url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    };
    let res = await send(sha);
    if (!res.ok && !sha && (res.status === 422 || res.status === 409)) {
      const head = await api(this.config, url + "?ref=" + encodeURIComponent(this.config.branch), { method: "GET" });
      if (head.ok) {
        const info = await head.json();
        res = await send(info.sha);
      }
    }
    if (!res.ok) {
      let detail = "";
      try {
        const err = await res.json();
        if (err && err.message) detail = " (" + err.message + ")";
      } catch {}
      throw new Error("backup write failed: HTTP " + res.status + detail + " for " + path);
    }
    const body = await res.json();
    return body.content && body.content.sha ? body.content.sha : null;
  }

  /** The photo manifest: which "id.ext" files the repo already holds. */
  async loadManifest() {
    const entry = await this.getFile("assets.json");
    this.manifestSha = entry ? entry.sha : null;
    try {
      this.manifest = entry && entry.content ? (JSON.parse(entry.content) || {}) : {};
    } catch {
      this.manifest = {};
    }
  }

  /** At boot, bring the photos back onto the fresh disk. */
  async restoreAssets() {
    if (!this.manifest) return 0;
    let restored = 0;
    for (const key of Object.keys(this.manifest)) {
      if (!/^[a-f0-9]{16}\.(png|jpg|gif|webp)$/.test(key)) continue;
      const target = this.store.assetsDir + "/" + key;
      if (fs.existsSync(target)) continue;
      try {
        const buf = await this.getBinary("assets/" + key);
        if (!buf) continue;
        fs.writeFileSync(target, buf);
        restored++;
      } catch (error) {
        console.warn("[backup] photo restore failed for " + key + ":", error.message);
      }
    }
    if (restored) console.log("[backup] restored " + restored + " photo(s) from " + this.config.repo + ".");
    return restored;
  }

  /** Ship any photo the repo is missing, then save the manifest. */
  async syncAssets() {
    if (!this.manifest) return;
    const wanted = {};
    let changed = false;
    for (const asset of this.assetList()) {
      if (!/^[a-f0-9]{16}\.(png|jpg|gif|webp)$/.test(asset.key)) continue;
      wanted[asset.key] = true;
      if (this.manifest[asset.key]) continue;
      try {
        const buf = fs.readFileSync(this.store.assetsDir + "/" + asset.key);
        const sha = await this.putFile("assets/" + asset.key, buf, null, "StatusC0rd photo backup " + new Date().toISOString());
        if (sha) {
          this.manifest[asset.key] = sha;
          changed = true;
          console.log("[backup] photo saved: " + asset.key);
        }
      } catch (error) {
        console.warn("[backup] photo save failed for " + asset.key + ":", error.message);
      }
    }
    let pruned = false;
    for (const key of Object.keys(this.manifest)) {
      if (!wanted[key]) { delete this.manifest[key]; changed = true; pruned = true; }
    }
    if (pruned) console.log("[backup] photo manifest pruned.");
    if (!changed) return;
    try {
      const sha = await this.putFile("assets.json", Buffer.from(JSON.stringify(this.manifest, null, 2), "utf8"), this.manifestSha, "StatusC0rd photo manifest " + new Date().toISOString());
      if (sha) this.manifestSha = sha;
    } catch (error) {
      console.warn("[backup] photo manifest save failed (will catch up on the next boot):", error.message);
      this.manifest = null;
    }
  }

  async flush() {
    if (!this.config.enabled || !this.dirty || this.pushing) return;
    this.pushing = true;
    try {
      await this.push(this.store.export());
      console.log("[backup] data saved to " + this.config.repo + ".");
      await this.syncAssets();
    } catch (error) {
      console.warn("[backup] flush failed (will retry):", error.message);
    } finally {
      this.pushing = false;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = { Backup };
