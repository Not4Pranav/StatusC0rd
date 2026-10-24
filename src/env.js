"use strict";

/**
 * Environment loading + validation.
 *
 * Everything the app needs to boot is validated here so that a misconfigured
 * deployment fails immediately with an actionable message instead of a vague
 * runtime error later on.
 */

const path = require("node:path");

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off", ""]);

/** Parse a boolean-ish env value. Unknown values fall back to `fallback`. */
function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return fallback;
}

/** Parse a comma/whitespace separated list of Discord snowflakes. */
function parseIdList(value) {
  if (!value) return [];
  return [
    ...new Set(
      String(value)
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter((id) => /^\d{5,25}$/.test(id))
    )
  ];
}

function parseTrustProxy(value, isProduction) {
  if (value === undefined || value === null || String(value).trim() === "") {
    // Render (and most managed hosts) put the app behind exactly one proxy.
    return isProduction ? 1 : false;
  }
  const raw = String(value).trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw; // e.g. "loopback", "10.0.0.0/8"
}

/**
 * Build the runtime config object from an environment map.
 * Does not throw - use `validateConfig` for that.
 */
function loadConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "development").trim();
  const isProduction = nodeEnv === "production";
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, "..", "data"));

  const allowedDiscordIds = parseIdList(env.ALLOWED_DISCORD_IDS);

  return {
    nodeEnv,
    isProduction,
    port: Number(env.PORT) || 3000,
    dataDir,
    clientId: String(env.CLIENT_ID || "").trim(),
    applicationId: String(env.APPLICATION_ID || env.CLIENT_ID || "").trim(),
    publicKey: String(env.PUBLIC_KEY || "").trim(),
    clientSecret: String(env.CLIENT_SECRET || "").trim(),
    discordToken: String(env.DISCORD_TOKEN || "").trim(),
    sessionSecret: String(env.SESSION_SECRET || ""),
    dashboardKey: String(env.DASHBOARD_KEY || ""),
    allowedDiscordIds,
    redirectUri: String(env.REDIRECT_URI || "").trim(),
    botEnabled: parseBool(env.BOT_ENABLED, true),
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction),
    version: require("../package.json").version
  };
}

/**
 * Returns a list of human readable configuration problems.
 * An empty list means the app can boot.
 */
function validateConfig(config) {
  const errors = [];

  if (!config.clientId || !/^\d{5,25}$/.test(config.clientId)) {
    errors.push("CLIENT_ID must be a Discord application/client ID (digits only).");
  }

  if (!config.sessionSecret) {
    errors.push("SESSION_SECRET is required. Generate one with: openssl rand -hex 32");
  } else if (config.sessionSecret.length < 16) {
    errors.push("SESSION_SECRET is too short - use at least 16 characters (32+ recommended).");
  }

  // Locally it is convenient to boot without a token (dashboard-only mode);
  // in production a missing bot token is almost certainly a mistake.
  if (config.botEnabled && !config.discordToken && config.isProduction) {
    errors.push(
      "DISCORD_TOKEN is required when BOT_ENABLED=true in production. " +
        "Set BOT_ENABLED=false to run the dashboard without a bot."
    );
  }

  if (!config.dashboardKey && !isDiscordLoginEnabled(config)) {
    errors.push(
      "No sign-in method configured. Set DASHBOARD_KEY and/or configure Discord login " +
        "(CLIENT_SECRET + ALLOWED_DISCORD_IDS)."
    );
  }

  if (!config.clientSecret && config.allowedDiscordIds.length > 0) {
    errors.push("ALLOWED_DISCORD_IDS requires CLIENT_SECRET so Discord sign-in can exchange the OAuth code.");
  }

  if (config.redirectUri) {
    let parsed;
    try {
      parsed = new URL(config.redirectUri);
    } catch {
      errors.push("REDIRECT_URI must be an absolute URL, e.g. https://example.com/auth/discord/callback");
    }
    if (parsed && !["http:", "https:"].includes(parsed.protocol)) {
      errors.push("REDIRECT_URI must use http:// or https://");
    }
    if (parsed && config.isProduction && parsed.protocol !== "https:") {
      errors.push("REDIRECT_URI must use https:// in production.");
    }
  }

  if (config.isProduction && config.dashboardKey && config.dashboardKey.length < 12) {
    errors.push("DASHBOARD_KEY must be at least 12 characters in production.");
  }

  return errors;
}

function isDiscordLoginEnabled(config) {
  return Boolean(config.clientSecret && config.allowedDiscordIds.length > 0);
}

/** Non-fatal configuration advice for the startup log. */
function warningsFor(config) {
  const warnings = [];
  if (config.sessionSecret && config.sessionSecret.length < 32) {
    warnings.push("SESSION_SECRET is shorter than 32 characters; consider a longer random value.");
  }
  if (config.dashboardKey && config.dashboardKey.length < 16) {
    warnings.push("DASHBOARD_KEY is short; prefer a long random value from `openssl rand -hex 32`.");
  }
  if (!config.isProduction && config.nodeEnv !== "test") {
    warnings.push("NODE_ENV is not 'production' - secure session cookies are disabled.");
  }
  if (!config.redirectUri) {
    warnings.push("REDIRECT_URI is not set; it will be derived from the incoming request host.");
  }
  if (config.botEnabled && !config.discordToken) {
    warnings.push("DISCORD_TOKEN is empty - starting in dashboard-only mode.");
  }
  return warnings;
}

module.exports = {
  loadConfig,
  validateConfig,
  warningsFor,
  isDiscordLoginEnabled,
  parseBool,
  parseIdList
};
