"use strict";

/** Shared fixtures for the HTTP-level tests. */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { EventEmitter } = require("node:events");

const { createApp } = require("../app");
const { SettingsStore } = require("../src/settings");
const { AssetStore } = require("../src/assets");

const silent = { log() {}, warn() {}, error() {} };
const ADMIN_KEY = "integration-test-key";
const PUBLIC_URL = "https://status.example.com";
const PKG = require("../package.json");

class FakeBot extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.state = {
      enabled: false,
      status: "disabled",
      connected: false,
      tag: null,
      id: null,
      error: null,
      note: "No bot token configured - dashboard-only mode.",
      lastAppliedAt: null,
      lastActivity: null,
      uptimeSeconds: 12,
      pending: false
    };
  }
  getState() {
    return { ...this.state };
  }
  setPresence(config) {
    this.calls.push({ type: "set", config });
  }
  clearPresence(status) {
    this.calls.push({ type: "clear", status });
  }
  async reconfigure({ token }) {
    this.calls.push({ type: "reconfigure", token });
    return this.getState();
  }
}

/** Build a valid RGB PNG (Discord's minimum is 16x16). */
function makePng(width = 64, height = 64) {
  const row = Buffer.alloc(width * 3 + 1, 0);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = 88;
    row[2 + x * 3] = 101;
    row[3 + x * 3] = 242;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, crcBuffer]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const PNG_DATA_URL = `data:image/png;base64,${makePng().toString("base64")}`;

/** Minimal cookie jar on top of fetch. */
function createClient(base) {
  const jar = new Map();
  return async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(base + pathname, { ...options, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
}

const csrfFrom = (html) => {
  const match = html.match(/name="csrf-token" content="([^"]+)"/);
  if (!match) throw new Error("expected a CSRF meta tag");
  return match[1];
};

/**
 * Boot the app against a temporary data directory.
 * @param {{env?: object, completeSetup?: boolean, publicUrl?: string, isProduction?: boolean}} [options]
 */
async function startApp({ env = {}, completeSetup = true, publicUrl = PUBLIC_URL, isProduction = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-test-"));
  const settings = new SettingsStore(path.join(dataDir, "settings.json"), { env, logger: silent });
  const assets = new AssetStore(path.join(dataDir, "assets"), settings);
  const bot = new FakeBot();
  const app = createApp({ settings, assets, bot, logger: silent, version: PKG.version, isProduction });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const base = `http://127.0.0.1:${server.address().port}`;
  const request = createClient(base);
  const setupToken = settings.setupToken;

  async function signIn(key = ADMIN_KEY) {
    const html = await (await request("/login")).text();
    await request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key, _csrf: csrfFrom(html) })
    });
    const state = await (await request("/api/state")).json();
    return state.csrf;
  }

  if (completeSetup) {
    settings.setAdminKey(ADMIN_KEY);
    settings.update({ publicUrl });
    settings.completeSetup();
  }

  return {
    settings,
    assets,
    bot,
    app,
    server,
    base,
    request,
    signIn,
    setupToken,
    dataDir,
    async close() {
      app.locals.closeStreams();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

module.exports = {
  startApp,
  createClient,
  csrfFrom,
  FakeBot,
  makePng,
  PNG_DATA_URL,
  silent,
  ADMIN_KEY,
  PUBLIC_URL
};
