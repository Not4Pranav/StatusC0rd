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
      const remote = await this.fetchRemote();
      if (remote && this.store.userCount() === 0) {
        const parsed = JSON.parse(remote);
        if (parsed && typeof parsed === "object" && parsed.users && Object.keys(parsed.users).length) {
          this.store.adopt(parsed);
          this.dirty = true;
          console.log("[backup] restored " + Object.keys(parsed.users).length + " account(s) from " + this.config.repo + ".");
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

  async flush() {
    if (!this.config.enabled || !this.dirty || this.pushing) return;
    this.pushing = true;
    try {
      await this.push(this.store.export());
      console.log("[backup] data saved to " + this.config.repo + ".");
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
