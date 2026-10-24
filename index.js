"use strict";

require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const pkg = require("./package.json");
const { normalizeEnv } = require("./src/env");
const { SettingsStore } = require("./src/settings");
const { AssetStore } = require("./src/assets");
const { DiscordBot } = require("./src/bot");
const { KeepAlive } = require("./src/keepalive");
const { DEFAULT_CONFIG } = require("./src/presence");
const { createApp } = require("./app");

/**
 * The server always boots - even with no configuration at all - and serves the
 * setup wizard. Nothing has to be edited on disk or in a shell to get started.
 */
async function main() {
  const { env, problems, isProduction } = normalizeEnv(process.env);
  for (const problem of problems) console.warn(`[config] ${problem}`);

  const port = Number(process.env.PORT) || 3000;
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
  fs.mkdirSync(dataDir, { recursive: true });

  warnAboutLegacyTokens(dataDir, console);

  const settings = new SettingsStore(path.join(dataDir, "settings.json"), { env });
  const assets = new AssetStore(path.join(dataDir, "assets"), settings);
  assets.prune();

  const effective = settings.effective();
  const bot = new DiscordBot({
    token: effective.botToken,
    clientId: effective.clientId,
    enabled: effective.botEnabled
  });

  const keepAlive = new KeepAlive({
    getPublicUrl: () => settings.effective().publicUrl,
    intervalMinutes: effective.keepAlive.intervalMinutes
  });

  // Restore the last saved presence.
  const savedPresence = settings.get().presence || DEFAULT_CONFIG;
  if (savedPresence.enabled) bot.setPresence(savedPresence);
  else bot.clearPresence(savedPresence.status);

  const app = createApp({ settings, assets, bot, keepAlive, version: pkg.version });
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Set PORT to a free port and try again.`));
      } else reject(error);
    });
    server.listen(port, "0.0.0.0", resolve);
  });

  printBanner({ settings, effective, port, version: pkg.version, isProduction });

  keepAlive.configure({ ...effective.keepAlive, publicUrl: effective.publicUrl });

  // Connect to Discord after the HTTP server is up: a bad token or an
  // unreachable gateway can never take the dashboard offline.
  bot.start().catch((error) => console.error("[bot] start failed:", error.message));

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received - shutting down`);
    app.locals.closeStreams();
    keepAlive.stop();
    const forceExit = setTimeout(() => {
      console.error("[server] shutdown timed out; exiting");
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    await new Promise((resolve) => server.close(resolve));
    await bot.stop();
    clearTimeout(forceExit);
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return { server, app, bot, settings, assets, keepAlive };
}

function printBanner({ settings, effective, port, version, isProduction }) {
  const line = "─".repeat(64);
  console.log(`\n${line}`);
  console.log(`  StatusC0rd v${version}  ·  http://localhost:${port}  ·  ${isProduction ? "production" : "development"}`);
  if (settings.needsSetup()) {
    console.log(`${line}`);
    console.log("  FIRST RUN - open the setup wizard to finish configuring:");
    console.log(`    http://localhost:${port}/setup`);
    if (settings.setupToken) {
      console.log("");
      console.log(`  Setup token: ${settings.setupToken}`);
      console.log("  (also stored in data/setup-token.txt)");
    }
  } else {
    console.log(`${line}`);
    console.log(`  Dashboard: http://localhost:${port}/login`);
    console.log(`  Bot:       ${effective.botEnabled ? "connecting…" : "dashboard only (no bot token)"}`);
    console.log(`  Keep-up:   ${effective.keepAlive.enabled ? `pinging ${effective.publicUrl} every ${effective.keepAlive.intervalMinutes}m` : "off"}`);
  }
  console.log(`${line}\n`);
}

/** The v1.0.0 build stored other people's OAuth tokens in data/users.json. */
function warnAboutLegacyTokens(dataDir, logger) {
  const legacy = path.join(dataDir, "users.json");
  if (!fs.existsSync(legacy)) return;
  logger.warn(
    `[security] ${legacy} contains OAuth tokens from the removed user-RPC feature. ` +
      "Delete that file - those tokens are no longer used by this app."
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[fatal]", error.message);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[uncaughtException]", error);
    process.exit(1);
  });
}

module.exports = { main };
