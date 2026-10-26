"use strict";

/**
 * StatusC0rd boot.
 *
 *   index.js    this file - env, store, bot, keep-alive, HTTP server
 *   server.js   every route
 *   src/*       the engine: presence model, gateway bot, oauth, store, photos
 *
 * Order matters only once: the store is created first because a first run with
 * no key anywhere generates the dashboard key and prints it to the log.
 */

require("dotenv").config();

const http = require("node:http");
const { version } = require("./package.json");
const { Store } = require("./src/store");
const { DiscordBot } = require("./src/bot");
const { KeepAlive } = require("./src/keepalive");
const { createActivityService } = require("./src/activity");
const { createApp } = require("./server");

function flag(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || "./data";
const PRODUCTION = process.env.NODE_ENV === "production";

const store = new Store({ dir: DATA_DIR });

const effective = () => ({
  clientId: String(process.env.CLIENT_ID || store.settings.clientId || "").trim(),
  clientSecret: String(process.env.CLIENT_SECRET || store.settings.clientSecret || "").trim(),
  botToken: String(process.env.DISCORD_TOKEN || store.settings.botToken || "").trim(),
  siteName: String(process.env.SITE_NAME || store.settings.siteName || "").trim() || "StatusC0rd",
  publicUrl: String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || store.settings.publicUrl || "").trim().replace(/\/+$/, ""),
  keepAlive: process.env.KEEP_ALIVE === undefined ? store.settings.keepAlive !== false : flag("KEEP_ALIVE", true),
  keepAliveMinutes: Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES || store.settings.keepAliveMinutes || 10),
  cardPublished: store.settings.cardPublished === true,
  allowedDiscordIds: String(process.env.ALLOWED_DISCORD_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  botEnabled: flag("BOT_ENABLED", true)
});

let firstRunKey = null;
if (!store.hasKey()) {
  firstRunKey = store.generateKey();
}

const bot = new DiscordBot({
  token: effective().botToken,
  enabled: effective().botEnabled,
  clientId: effective().clientId
});
void bot.start();

const keepAlive = new KeepAlive({});

const activity = createActivityService({ effective, store });

function applyKeepAlive() {
  const config = effective();
  keepAlive.configure({
    enabled: config.keepAlive,
    intervalMinutes: config.keepAliveMinutes,
    publicUrl: config.publicUrl
  });
}
applyKeepAlive();

const app = createApp({ store, bot, keepAlive, activity, effective, version, production: PRODUCTION, flag });

const server = http.createServer(app);
server.listen(PORT, () => {
  const url = effective().publicUrl || "http://localhost:" + PORT;
  console.log("");
  console.log("  StatusC0rd v" + version + "  -  " + (PRODUCTION ? "production" : "development"));
  console.log("  " + url);
  console.log("");
  if (firstRunKey) {
    console.log("  FIRST RUN - no dashboard key existed, so one was generated:");
    console.log("  ┌──────────────────────────────────────────────┐");
    console.log("  │  dashboard key:  " + firstRunKey + "".padEnd(28 - firstRunKey.length) + "│");
    console.log("  └──────────────────────────────────────────────┘");
    console.log("  Copy it now - it is shown once. Or set DASHBOARD_KEY in the");
    console.log("  environment to choose your own key.");
    console.log("");
  }
  if (!effective().botToken) {
    console.log("  No bot token configured - the dashboard works, the 24/7 bot card does not.");
  }
});

function shutdown() {
  keepAlive.stop();
  void bot.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
