const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { refreshToken } = require("./discordApi");

const USERS_PATH = path.join(__dirname, "..", "data", "users.json");
const RPC_URL = "wss://rpc.discord.gg/?v=1&encoding=json";
const RECONNECT_MS = 15000;

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, "utf8")); } catch { return {}; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_PATH + ".tmp", JSON.stringify(users, null, 2));
  fs.renameSync(USERS_PATH + ".tmp", USERS_PATH);
}

class UserSession {
  constructor(manager, userId) {
    this.manager = manager;
    this.userId = userId;
    this.ws = null;
    this.closedByUser = false;
    this.currentActivity = null;
  }

  send(cmd, args) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ cmd, args, nonce: Math.random().toString(36).slice(2), evt: null }));
  }

  apply(activity) {
    this.currentActivity = activity;
    this.send("SET_ACTIVITY", { pid: (process.pid + this.userId.length) & 0x7fffffff, activity });
  }

  async connect() {
    const rec = this.manager.users[this.userId];
    if (!rec) return;
    if (Date.now() > rec.expiresAt - 60_000) {
      try {
        const t = await refreshToken(rec.refreshToken);
        rec.accessToken = t.access_token;
        rec.refreshToken = t.refresh_token;
        rec.expiresAt = Date.now() + t.expires_in * 1000;
        saveUsers(this.manager.users);
      } catch (e) {
        console.error(`[rpc:${this.userId}] token refresh failed:`, e.message);
        return this.scheduleReconnect();
      }
    }

    this.ws = new WebSocket(RPC_URL);
    this.ws.on("open", () => this.send("AUTHENTICATE", { access_token: rec.accessToken }));
    this.ws.on("message", raw => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.cmd === "AUTHENTICATE" && msg.evt === "READY") {
        console.log(`[rpc] authenticated as user ${this.userId}`);
        if (this.currentActivity) this.apply(this.currentActivity);
      }
      if (msg.evt === "ERROR") console.error(`[rpc:${this.userId}]`, msg.data?.message);
    });
    this.ws.on("close", () => { if (!this.closedByUser) this.scheduleReconnect(); });
    this.ws.on("error", () => {});
  }

  scheduleReconnect() {
    setTimeout(() => { if (!this.closedByUser) this.connect().catch(() => {}); }, RECONNECT_MS);
  }

  close() {
    this.closedByUser = true;
    this.ws?.removeAllListeners();
    this.ws?.close();
  }
}

class RPCManager {
  constructor() {
    this.users = loadUsers();
    this.sessions = new Map();
    this.currentActivity = null;
  }

  addUser(userId, username, tokenResp) {
    this.users[userId] = {
      username,
      accessToken: tokenResp.access_token,
      refreshToken: tokenResp.refresh_token,
      expiresAt: Date.now() + tokenResp.expires_in * 1000
    };
    saveUsers(this.users);
    return this.ensureSession(userId);
  }

  removeUser(userId) {
    this.sessions.get(userId)?.close();
    this.sessions.delete(userId);
    delete this.users[userId];
    saveUsers(this.users);
  }

  async ensureSession(userId) {
    if (!this.sessions.has(userId)) {
      const s = new UserSession(this, userId);
      this.sessions.set(userId, s);
      s.currentActivity = this.currentActivity;
    }
    await this.sessions.get(userId).connect();
    return this.sessions.get(userId);
  }

  broadcast(activity) {
    this.currentActivity = activity;
    for (const s of this.sessions.values()) s.apply(activity);
  }

  async connectAll() {
    for (const id of Object.keys(this.users)) {
      await this.ensureSession(id).catch(e => console.error(`[rpc:${id}]`, e.message));
      await new Promise(r => setTimeout(r, 500));
    }
  }

  listUsers() {
    return Object.entries(this.users).map(([id, u]) => ({
      id, username: u.username, connected: this.sessions.get(id)?.ws?.readyState === WebSocket.OPEN
    }));
  }
}

module.exports = RPCManager;
