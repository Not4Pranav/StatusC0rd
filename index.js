"use strict";

/**
 * StatusC0rd boot (multi-user).
 *
 *   index.js    this file - env, store, bot, keep-alive, HTTP server
 *   server.js   every route
 *   src/*       the engine: presence model, gateway bot, oauth, store, photos
 *
 * Anyone signs in with Discord and gets their own card. The bot card and the
 * instance settings belong to the admin: ADMIN_DISCORD_IDS in the
 * environment, or the first account to sign in when the environment is silent.
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

// ADMIN_DISCORD_IDS names the admins; ALLOWED_DISCORD_IDS is the v4 name,
// still honoured so an old environment keeps working.
function envAdminIds() {
  const raw = String(process.env.ADMIN_DISCORD_IDS || "") + "," + String(process.env.ALLOWED_DISCORD_IDS || "");
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const effective = () => ({
  clientId: String(process.env.CLIENT_ID || store.settings.clientId || "").trim(),
  clientSecret: String(process.env.CLIENT_SECRET || store.settings.clientSecret || "").trim(),
  botToken: String(process.env.DISCORD_TOKEN || store.settings.botToken || "").trim(),
  siteName: String(process.env.SITE_NAME || store.settings.siteName || "").trim() || "StatusC0rd",
  publicUrl: String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || store.settings.publicUrl || "").trim().replace(/\/+$/, ""),
  keepAlive: process.env.KEEP_ALIVE === undefined ? store.settings.keepAlive !== false : flag("KEEP_ALIVE", true),
  keepAliveMinutes: Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES || store.settings.keepAliveMinutes || 10),
  adminIds: envAdminIds(),
  botEnabled: flag("BOT_ENABLED", true)
});

// The gateway bot carries the instance owner's card: the first admin that has
// an account.
function botOwner() {
  for (const id of [...effective().adminIds, ...store.adminIds]) {
    const user = store.getUser(id);
    if (user) return user;
  }
  return null;
}

const bot = new DiscordBot({
  token: effective().botToken,
  enabled: effective().botEnabled,
  clientId: effective().clientId
});

function applyBotPresence() {
  const owner = botOwner();
  bot.setPresence(owner ? owner.presence : null);
}
// The saved card is the bot's desired presence from the first second; the
// queue applies it the moment the gateway is ready.
applyBotPresence();
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

const app = createApp({ store, bot, keepAlive, activity, effective, version, production: PRODUCTION, applyKeepAlive, applyBotPresence });

const server = http.createServer(app);
server.listen(PORT, () => {
  const url = effective().publicUrl || "http://localhost:" + PORT;
  console.log("");
  console.log("  StatusC0rd v" + version + "  -  " + (PRODUCTION ? "production" : "development"));
  console.log("  " + url);
  console.log("");
  if (!effective().adminIds.length) {
    console.log("  No ADMIN_DISCORD_IDS set - the first Discord account to");
    console.log("  sign in becomes the admin (instance settings + bot card).");
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
