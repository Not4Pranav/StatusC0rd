"use strict";

require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const pkg = require("./package.json");
const { normalizeEnv } = require("./src/env");
const { SettingsStore, ADMIN_USER_ID, parseFlag } = require("./src/settings");
const { AssetStore } = require("./src/assets");
const { DiscordBot } = require("./src/bot");
const { KeepAlive } = require("./src/keepalive");
const { BotWorker, assertWorkerUrl, splitHostingEnabled, localGatewayEnabled } = require("./src/worker");
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

  // Split hosting: this process is only the Discord side. It holds the gateway
  // connection, reads the card from the website and reports back. No disk, no
  // sessions, no dashboard - which is why it fits on the smallest free box.
  if (parseFlag(process.env.BOT_WORKER, false)) {
    return runBotWorker({ env, port, version: pkg.version });
  }

  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
  fs.mkdirSync(dataDir, { recursive: true });

  warnAboutLegacyTokens(dataDir, console);

  const settings = new SettingsStore(path.join(dataDir, "settings.json"), { env });
  const assets = new AssetStore(path.join(dataDir, "assets"), settings);
  // A recovered settings file has no asset metadata yet. Pruning then would
  // delete every uploaded photo on the disk - the files are the only copy - so
  // leave them alone and let the owner restore settings.json first.
  if (settings.recovered) {
    const left = assets.countFiles();
    if (left > 0) {
      console.warn(
        `[assets] settings.json was missing or unreadable; keeping ${left} uploaded file(s) instead of pruning them. ` +
          "Restore that file (or re-upload) - nothing is lost until you delete it."
      );
    }
  } else {
    assets.prune();
  }

  const effective = settings.effective();
  // With a worker token configured, the gateway belongs to the worker. Two
  // sessions on one bot token would fight over the presence, so the web process
  // stays out of it unless BOT_ENABLED=true says otherwise.
  const bot = new DiscordBot({
    token: effective.botToken,
    clientId: effective.clientId,
    enabled: localGatewayEnabled(effective)
  });

  const keepAlive = new KeepAlive({
    getPublicUrl: () => settings.effective().publicUrl,
    intervalMinutes: effective.keepAlive.intervalMinutes
  });

  /**
   * Restore the owner's last published card for the bot.
   *
   * Presences are per account since v4, so reading the old single `presence`
   * key would hand the bot the default card on every restart - the card would
   * silently revert to "StatusC0rd" until somebody pressed Publish again.
   */
  const savedPresence = settings.presenceFor(ADMIN_USER_ID) || DEFAULT_CONFIG;
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

/**
 * Run only the Discord half of the app.
 *
 * The website stays wherever it already lives and keeps its disk, its members
 * and its wizard; this process needs three things: a bot token, the site's URL,
 * and the shared worker token. It answers `/health` so free hosts that probe a
 * port stay happy.
 */
async function runBotWorker({ env, port, version }) {
  const line = "─".repeat(64);
  const baseUrl = String(env.BOT_URL || "").replace(/\/+$/, "");
  const token = String(env.BOT_WORKER_TOKEN || "").trim();
  const botToken = String(env.DISCORD_TOKEN || "").trim();

  if (!baseUrl || !token) {
    throw new Error(
      "BOT_WORKER needs BOT_URL (the website) and BOT_WORKER_TOKEN (the same secret the website has)."
    );
  }
  // Every poll carries the token, so a plain-http address that is not the local
  // machine would publish it to the network.
  assertWorkerUrl(baseUrl);
  if (!botToken) {
    throw new Error("BOT_WORKER needs DISCORD_TOKEN: the bot cannot log in without one.");
  }

  const bot = new DiscordBot({ token: botToken, clientId: env.CLIENT_ID, enabled: true });
  const worker = new BotWorker({
    bot,
    baseUrl,
    token,
    pollSeconds: Number(process.env.BOT_POLL_SECONDS) || undefined
  });

  // Free hosts (Render, Fly, Koyeb) route only to a listening port, so the
  // worker answers two probes of its own and nothing else.
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const state = bot.getState();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(
        JSON.stringify({
          status: "ok",
          role: "bot-worker",
          version,
          bot: { status: state.status, connected: state.connected, tag: state.tag || null },
          site: baseUrl,
          lastCardAt: worker.state.lastCardAt
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "This process only runs the Discord bot. The dashboard is at BOT_URL." }));
  });

  await new Promise((resolve) => server.listen(port, "0.0.0.0", resolve));

  console.log(`\n${line}`);
  console.log(`  StatusC0rd bot worker v${version}  ·  port ${port}`);
  console.log(`  Site:    ${baseUrl}`);
  console.log(`  Polling: every ${worker.pollSeconds}s`);
  console.log(`${line}\n`);

  await worker.start().catch((error) => console.error("[worker] start failed:", error.message));

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received - shutting down`);
    await worker.stop();
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return { server, bot, worker };
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
    const remote = splitHostingEnabled();
    console.log(
      `  Bot:       ${
        remote
          ? `hosted separately (worker reads /api/bot/card)`
          : effective.botEnabled
            ? "connecting…"
            : "dashboard only (no bot token)"
      }`
    );
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
