"use strict";

require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { loadConfig, validateConfig, warningsFor } = require("./src/env");
const { JsonFileStore } = require("./src/store");
const { DEFAULT_CONFIG } = require("./src/presence");
const { DiscordBot } = require("./src/bot");
const { createApp } = require("./app");

class ConfigurationError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.problems = problems;
  }
}

/** Warn loudly about the legacy token cache from the old RPC implementation. */
function warnAboutLegacyTokens(dataDir, logger) {
  const legacy = path.join(dataDir, "users.json");
  if (!fs.existsSync(legacy)) return;
  logger.warn(
    `[security] ${legacy} contains OAuth tokens from the removed user-RPC feature. ` +
      "Delete that file - those tokens are no longer used by this app."
  );
}

async function main() {
  const config = loadConfig();
  const problems = validateConfig(config);
  if (problems.length > 0) throw new ConfigurationError(problems);

  for (const warning of warningsFor(config)) console.warn(`[config] ${warning}`);
  warnAboutLegacyTokens(config.dataDir, console);

  const store = new JsonFileStore(path.join(config.dataDir, "config.json"), {
    defaults: DEFAULT_CONFIG
  });

  const bot = new DiscordBot({
    token: config.discordToken,
    clientId: config.clientId,
    enabled: config.botEnabled && Boolean(config.discordToken)
  });

  // Restore the last saved presence (applied as soon as the gateway is ready).
  const saved = store.get();
  if (saved.enabled) bot.setPresence(saved);
  else bot.clearPresence(saved.status);

  const app = createApp({ config, store, bot });
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "0.0.0.0", resolve);
  });

  console.log(`[server] StatusC0rd v${config.version} listening on 0.0.0.0:${config.port}`);
  console.log(`[server] health: /health  |  dashboard: /login  |  mode: ${config.nodeEnv}`);
  console.log(
    `[server] discord sign-in: ${config.dashboardKey ? "dashboard key" : ""}${
      config.dashboardKey && config.allowedDiscordIds.length > 0 ? " + " : ""
    }${config.allowedDiscordIds.length > 0 ? "discord sso" : ""}`
  );

  // Connect to Discord after the HTTP server is up, so a bad token or an
  // unreachable gateway can never take the dashboard offline.
  bot.start().catch((error) => console.error("[bot] start failed:", error.message));

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received - shutting down`);
    app.locals.closeStreams();
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

  return { server, app, bot, config, store };
}

if (require.main === module) {
  main().catch((error) => {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      console.error("\nCopy .env.example to .env and fill in the missing values, or set them in your host.");
    } else {
      console.error("[fatal]", error);
    }
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

module.exports = { main, ConfigurationError };
