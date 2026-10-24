#!/usr/bin/env node
"use strict";

/*
 * StatusC0rd companion
 * --------------------
 * Pushes the presence configured in the StatusC0rd dashboard to the Discord
 * client running on this computer, so the activity (with photos, buttons and
 * timer) shows up on *your* profile.
 *
 * Why this exists: Discord only renders name/type/state for bot accounts, and
 * the local Discord client is the only supported way to publish rich presence
 * for a user account. This script talks to that client over its local IPC
 * socket - nothing is written to your Discord account and no token is used.
 *
 * Setup: open the StatusC0rd dashboard -> "My profile" -> pair this computer,
 * then run the command it shows. Requires Node.js 18 or newer.
 */

const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const OPCODES = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const CLIENT_NAME = "StatusC0rd companion";

// ---------------------------------------------------------------- utilities

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

function warn(...args) {
  console.warn(`[${new Date().toLocaleTimeString()}]`, ...args);
}

/** Directories that may contain the Discord IPC socket, in lookup order. */
function ipcDirectories(env = process.env) {
  if (process.platform === "win32") return [];
  const bases = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, "/tmp"].filter(Boolean);
  const dirs = [];
  for (const base of bases) {
    dirs.push(base);
    // Flatpak and Snap installs keep the socket in their own sandbox dirs.
    dirs.push(path.join(base, "app", "com.discordapp.Discord"));
    dirs.push(path.join(base, "snap.discord"));
    dirs.push(path.join(base, ".flatpak", "dev.vencord.Vesktop"));
  }
  return [...new Set(dirs)];
}

/** Candidate socket paths, most likely first. */
function ipcCandidates(env = process.env, platform = process.platform) {
  const candidates = [];
  for (let i = 0; i < 10; i += 1) {
    if (platform === "win32") {
      candidates.push(`\\\\?\\pipe\\discord-ipc-${i}`);
      continue;
    }
    for (const dir of ipcDirectories(env)) candidates.push(path.join(dir, `discord-ipc-${i}`));
  }
  return candidates;
}

/** Encode one IPC frame: 4-byte opcode, 4-byte length, UTF-8 JSON payload. */
function encodePacket(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/**
 * Incremental decoder for Discord IPC frames.
 * Feed it whatever arrives on the socket; it returns complete payloads.
 */
class PacketDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {Array<{opcode: number, data: object}>}
   */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const packets = [];
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > 1024 * 1024) throw new Error(`Invalid IPC frame length: ${length}`);
      if (this.buffer.length < 8 + length) break;
      const raw = this.buffer.subarray(8, 8 + length).toString("utf8");
      this.buffer = this.buffer.subarray(8 + length);
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { raw };
      }
      packets.push({ opcode, data });
    }
    return packets;
  }
}

/**
 * Prepare an activity object for the RPC `SET_ACTIVITY` command.
 * Discord RPC does not support the Streaming (1) or Custom (4) activity types,
 * so those are rendered as "Playing" instead of failing with an error.
 */
function normalizeActivity(activity) {
  if (!activity) return null;
  const next = JSON.parse(JSON.stringify(activity));
  if (next.type === 1 || next.type === 4) {
    next.type = 0;
    delete next.url;
  }
  if (next.timestamps && typeof next.timestamps.start === "number" && next.timestamps.start < 1e12) {
    // Some callers use seconds; Discord expects milliseconds.
    next.timestamps.start *= 1000;
  }
  return next;
}

// -------------------------------------------------------------- RPC client

class DiscordIpc {
  constructor({ appId, env = process.env, platform = process.platform } = {}) {
    this.appId = appId;
    this.env = env;
    this.platform = platform;
    this.socket = null;
    this.decoder = new PacketDecoder();
    this.ready = false;
    this.socketPath = null;
    this.handshake = null;
    this.onReady = () => {};
    this.onClose = () => {};
    this.onError = () => {};
  }

  /** Try each candidate socket until one accepts the handshake. */
  async connect() {
    const candidates = ipcCandidates(this.env, this.platform);
    if (candidates.length === 0) throw new Error("No Discord IPC socket path could be determined.");

    let lastError = null;
    for (const socketPath of candidates) {
      try {
        await this._open(socketPath);
        return socketPath;
      } catch (error) {
        lastError = error;
        this._teardown();
        // A refused/absent socket just means "try the next path"; anything
        // else (e.g. Discord rejected our app id) is worth surfacing.
        if (error.code && error.code !== "ENOENT" && error.code !== "ECONNREFUSED" && error.code !== "EACCES") {
          break;
        }
      }
    }

    const error = new Error(
      `Could not connect to Discord (${lastError?.code || lastError?.message || "no socket"}). ` +
        "Is the Discord desktop app running?"
    );
    error.code = lastError?.code || "ENOENT";
    throw error;
  }

  _open(socketPath) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      const handshake = { resolve, reject, settled: false, timer: null, socketPath };
      this.handshake = handshake;

      const settle = (error) => {
        if (handshake.settled) return;
        handshake.settled = true;
        if (handshake.timer) clearTimeout(handshake.timer);
        if (this.handshake === handshake) this.handshake = null;
        if (error) reject(error);
        else resolve(socketPath);
      };

      handshake.timer = setTimeout(() => settle(new Error("Discord did not answer the handshake.")), 5_000);

      socket.on("error", (error) => {
        settle(error);
        if (this.ready) this.onError(error);
      });

      socket.on("connect", () => {
        this.socket = socket;
        this.socketPath = socketPath;
        this.decoder = new PacketDecoder();

        socket.on("data", (chunk) => {
          let packets;
          try {
            packets = this.decoder.push(chunk);
          } catch (error) {
            this.onError(error);
            socket.destroy();
            return;
          }
          for (const packet of packets) this._handle(packet);
        });

        socket.on("close", () => {
          const wasReady = this.ready;
          this.ready = false;
          this.socket = null;
          settle(new Error("Discord closed the socket."));
          if (wasReady) this.onClose();
        });

        this._send(OPCODES.HANDSHAKE, { v: 1, client_id: this.appId });
      });
    });
  }

  _handle({ opcode, data }) {
    if (opcode === OPCODES.PING) {
      this._send(OPCODES.PONG, data);
      return;
    }
    if (opcode === OPCODES.CLOSE) {
      this.onError(new Error(data?.message || "Discord closed the connection."));
      this.socket?.destroy();
      return;
    }
    if (data && data.evt === "READY" && this.handshake) {
      this.ready = true;
      const handshake = this.handshake;
      handshake.settled = true;
      if (handshake.timer) clearTimeout(handshake.timer);
      this.handshake = null;
      handshake.resolve(handshake.socketPath);
      this.onReady();
      return;
    }
    if (data && data.evt === "ERROR") {
      const message = data.data?.message || "Discord returned an error.";
      if (this.handshake) {
        const handshake = this.handshake;
        handshake.settled = true;
        if (handshake.timer) clearTimeout(handshake.timer);
        this.handshake = null;
        handshake.reject(new Error(message));
        return;
      }
      this.onError(new Error(message));
    }
  }

  _send(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return false;
    try {
      this.socket.write(encodePacket(opcode, payload));
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  setActivity(activity) {
    return this._send(OPCODES.FRAME, {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity: normalizeActivity(activity) },
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    });
  }

  _teardown() {
    this.ready = false;
    if (this.handshake) {
      this.handshake.settled = true;
      if (this.handshake.timer) clearTimeout(this.handshake.timer);
      this.handshake = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  close() {
    this._teardown();
  }
}

// ------------------------------------------------------------- HTTP helper

async function requestJson(url, { token, method = "GET", body, etag } = {}) {
  const headers = { "User-Agent": CLIENT_NAME, Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers["If-None-Match"] = etag;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });

  if (response.status === 304) return { status: 304, data: null };
  if (response.status === 401 || response.status === 403) {
    const error = new Error("This computer is no longer paired. Pair it again from the dashboard.");
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Server returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return { status: response.status, data, etag: response.headers.get("etag") || null };
}

// -------------------------------------------------------------------- agent

/**
 * Run the companion until interrupted.
 * @param {{server: string, token: string, appId: string, label?: string,
 *          fetchImpl?: Function, logImpl?: Function}} config
 */
async function run(config = {}) {
  const server = String(config.server || "").replace(/\/+$/, "");
  const token = String(config.token || "");
  const appId = String(config.appId || "");
  if (!server || !token) {
    console.error("Missing configuration. Pair this computer from the StatusC0rd dashboard and run the command it shows.");
    process.exitCode = 1;
    return;
  }

  log(`StatusC0rd companion starting (${config.label || os.hostname()})`);
  log(`Server: ${server}`);

  const ipc = new DiscordIpc({ appId });
  let lastActivityJson = "";
  let etag = null;
  let stopping = false;
  let reconnectDelay = RECONNECT_MIN_MS;
  let discordError = null;
  let configError = null;

  // --- config polling ------------------------------------------------------
  async function fetchConfig({ force = false } = {}) {
    try {
      const result = await requestJson(`${server}/api/companion/config`, {
        token,
        etag: force ? null : etag
      });
      if (result.status === 304) return null;
      etag = result.etag || etag;
      configError = null;
      return result.data;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        warn(error.message);
        stopping = true;
        process.exitCode = 0;
        return null;
      }
      if (configError !== error.message) {
        warn(`Cannot reach the dashboard: ${error.message}`);
        configError = error.message;
      }
      return null;
    }
  }

  // --- discord connection --------------------------------------------------
  async function connectDiscord() {
    try {
      await ipc.connect();
      reconnectDelay = RECONNECT_MIN_MS;
      discordError = null;
      log("Connected to Discord.");
      lastActivityJson = ""; // force a re-send
      await reportStatus();
    } catch (error) {
      discordError = error.message;
      if (error.code === "ENOENT" || /Could not connect/i.test(error.message)) {
        warn(`Discord is not running (${error.message}). Retrying in ${Math.round(reconnectDelay / 1000)}s…`);
      } else {
        warn(`Discord connection failed: ${error.message}`);
      }
      setTimeout(() => {
        if (!stopping) void connectDiscord();
      }, reconnectDelay);
      reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2);
    }
  }

  ipc.onClose = () => {
    warn("Discord closed the connection (did it quit?). Reconnecting…");
    lastActivityJson = "";
    discordError = "disconnected";
    setTimeout(() => {
      if (!stopping) void connectDiscord();
    }, reconnectDelay);
  };

  ipc.onError = (error) => {
    if (error && error.message && error.message !== discordError) {
      warn(`Discord: ${error.message}`);
      discordError = error.message;
    }
  };

  // --- status reporting ----------------------------------------------------
  async function reportStatus(extra = {}) {
    try {
      await requestJson(`${server}/api/companion/heartbeat`, {
        token,
        method: "POST",
        body: {
          discordConnected: Boolean(ipc.ready),
          platform: process.platform,
          hostname: os.hostname(),
          error: discordError || configError || null,
          ...extra
        }
      });
    } catch {
      /* the dashboard being unreachable is not fatal */
    }
  }

  // --- main loop -----------------------------------------------------------
  let currentActivity = null;

  async function applyFromServer(configPayload) {
    if (!configPayload) return;
    const target = configPayload.activity || null;
    const activityJson = JSON.stringify(target);
    if (activityJson === lastActivityJson) return;
    lastActivityJson = activityJson;
    currentActivity = target;

    if (!ipc.ready) return; // applied after (re)connect
    ipc.setActivity(target);
    if (target) {
      log(`Presence updated: ${target.name || "custom status"}`);
    } else {
      log("Presence cleared.");
    }
    await reportStatus({ activity: target ? target.name : null });
  }

  await connectDiscord();
  await applyFromServer(await fetchConfig({ force: true }));

  const pollTimer = setInterval(() => {
    void (async () => {
      if (stopping) return;
      const payload = await fetchConfig();
      if (payload) await applyFromServer(payload);
      if (ipc.ready && currentActivity) {
        // Re-assert occasionally: Discord drops activity when a game launches.
        const activityJson = JSON.stringify(currentActivity);
        if (activityJson !== lastActivityJson) {
          await applyFromServer({ activity: currentActivity });
        }
      }
    })();
  }, POLL_INTERVAL_MS);
  pollTimer.unref?.();

  const heartbeatTimer = setInterval(() => {
    if (!stopping) void reportStatus();
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  void reportStatus();

  // --- shutdown ------------------------------------------------------------
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    log(`${signal} received - clearing presence and exiting.`);
    try {
      ipc.setActivity(null);
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      ipc.close();
      process.exit(0);
    }, 150);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => warn("Unhandled rejection:", reason?.message || reason));

  // Keep the process alive even though the timers are unref'd.
  await new Promise(() => {});
}

/** Print what the companion would send, without touching Discord. */
async function dryRun(config = {}) {
  const server = String(config.server || "").replace(/\/+$/, "");
  const result = await requestJson(`${server}/api/companion/config`, { token: config.token });
  console.log(JSON.stringify(result.data, null, 2));
}

// ------------------------------------------------------------------- module

const exported = {
  OPCODES,
  PacketDecoder,
  encodePacket,
  normalizeActivity,
  ipcCandidates,
  ipcDirectories,
  DiscordIpc,
  requestJson,
  run,
  dryRun
};

if (typeof module !== "undefined" && module.exports) module.exports = exported;

function bootstrap() {
  const injected = globalThis.__STATUSC0RD__;
  const config = injected || {
    server: process.env.STATUSC0RD_SERVER || "",
    token: process.env.STATUSC0RD_TOKEN || "",
    appId: process.env.STATUSC0RD_APP_ID || "",
    label: process.env.STATUSC0RD_LABEL || ""
  };

  if (process.argv.includes("--dry-run")) {
    dryRun(config).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    return;
  }
  if (process.argv.includes("--print-config")) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  run(config).catch((error) => {
    console.error(`[fatal] ${error.message}`);
    process.exitCode = 1;
  });
}

if (require.main === module || globalThis.__STATUSC0RD__) bootstrap();

module.exports.bootstrap = bootstrap;
