"use strict";

/**
 * Environment handling.
 *
 * Environment variables are optional: everything can be configured from the
 * website. When they are present they take precedence over the values stored in
 * `data/settings.json`, which is what managed deployments (Render, Docker) want.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

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

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return TRUTHY.has(String(value).trim().toLowerCase());
}

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalise `process.env` into the shape the settings store expects and collect
 * human readable warnings for values that look wrong.
 *
 * @param {object} env
 * @returns {{env: object, problems: string[], isProduction: boolean}}
 */
function normalizeEnv(env = process.env) {
  const problems = [];
  const nodeEnv = trim(env.NODE_ENV) || "development";

  const clientId = trim(env.CLIENT_ID);
  if (clientId && !/^\d{5,25}$/.test(clientId)) {
    problems.push(`CLIENT_ID "${clientId}" is not a Discord application ID (digits).`);
  }

  const redirectUri = trim(env.REDIRECT_URI);
  if (redirectUri) {
    try {
      const url = new URL(redirectUri);
      if (!["http:", "https:"].includes(url.protocol)) {
        problems.push("REDIRECT_URI must start with http:// or https://.");
      }
    } catch {
      problems.push("REDIRECT_URI is not a valid absolute URL.");
    }
  }

  const publicUrl = trim(env.PUBLIC_URL);
  if (publicUrl) {
    try {
      const url = new URL(publicUrl);
      if (!["http:", "https:"].includes(url.protocol)) problems.push("PUBLIC_URL must start with http:// or https://.");
    } catch {
      problems.push("PUBLIC_URL is not a valid absolute URL.");
    }
  }

  if (trim(env.SESSION_SECRET) && trim(env.SESSION_SECRET).length < 32) {
    problems.push("SESSION_SECRET is shorter than 32 characters; use `openssl rand -hex 32`.");
  }
  if (trim(env.DASHBOARD_KEY) && trim(env.DASHBOARD_KEY).length < 12) {
    problems.push("DASHBOARD_KEY is shorter than 12 characters.");
  }

  const normalized = {
    ...env,
    NODE_ENV: nodeEnv,
    CLIENT_ID: clientId,
    CLIENT_SECRET: trim(env.CLIENT_SECRET),
    DISCORD_TOKEN: trim(env.DISCORD_TOKEN),
    DASHBOARD_KEY: trim(env.DASHBOARD_KEY),
    SESSION_SECRET: trim(env.SESSION_SECRET),
    REDIRECT_URI: redirectUri,
    PUBLIC_URL: publicUrl,
    SETUP_TOKEN: trim(env.SETUP_TOKEN),
    DATA_DIR: trim(env.DATA_DIR),
    PORT: trim(env.PORT)
  };

  // Only override the allowlist when the variable is actually present.
  if (env.ALLOWED_DISCORD_IDS !== undefined && trim(env.ALLOWED_DISCORD_IDS) !== "") {
    normalized.ALLOWED_DISCORD_IDS = parseIdList(env.ALLOWED_DISCORD_IDS);
    if (normalized.ALLOWED_DISCORD_IDS.length === 0) {
      problems.push("ALLOWED_DISCORD_IDS does not contain any valid Discord user IDs.");
    }
  } else {
    delete normalized.ALLOWED_DISCORD_IDS;
  }

  return { env: normalized, problems, isProduction: nodeEnv === "production" };
}

module.exports = { normalizeEnv, parseIdList, parseBool };
