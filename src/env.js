"use strict";

/**
 * Environment handling.
 *
 * Environment variables are optional: everything can be configured from the
 * website. When they are present they take precedence over the values stored in
 * `data/settings.json`, which is what managed deployments (Render, Docker) want.
 */

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

  // Flags and numbers are easy to mistype, and a silently ignored value is the
  // hardest kind of misconfiguration to notice later.
  const flagVars = ["KEEP_ALIVE", "BOT_ENABLED", "BOT_WORKER"];
  for (const name of flagVars) {
    const value = trim(env[name]);
    if (value && !/^(1|0|true|false|yes|no|on|off|y|n)$/i.test(value)) {
      problems.push(`${name} "${value}" is not a yes/no value; use true or false.`);
    }
  }
  const interval = trim(env.KEEP_ALIVE_INTERVAL_MINUTES);
  if (interval) {
    const minutes = Number(interval);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      problems.push(`KEEP_ALIVE_INTERVAL_MINUTES "${interval}" is not a number of minutes; using the stored value.`);
    } else if (minutes < 5 || minutes > 60) {
      problems.push(`KEEP_ALIVE_INTERVAL_MINUTES ${minutes} is outside the 5-60 minute range and will be clamped.`);
    }
  }
  // Split hosting: the gateway connection runs in its own worker process, which
  // fetches the card from the website. Both sides need the same shared secret.
  // A managed host can pin the site name from the environment, which wins over
  // the dashboard field exactly like every other setting.
  const siteName = trim(env.SITE_NAME);
  if (siteName && (siteName.length < 2 || siteName.length > 40)) {
    problems.push(`SITE_NAME "${siteName}" is ${siteName.length} characters; use 2-40.`);
  }

  const botUrl = trim(env.BOT_URL).replace(/\/+$/, "");
  if (botUrl) {
    try {
      const url = new URL(botUrl);
      if (!["http:", "https:"].includes(url.protocol)) {
        problems.push("BOT_URL must start with http:// or https://.");
      }
    } catch {
      problems.push("BOT_URL is not a valid absolute URL (use the site's https:// address).");
    }
  }
  const botWorkerToken = trim(env.BOT_WORKER_TOKEN);
  if (botWorkerToken && botWorkerToken.length < 24) {
    problems.push("BOT_WORKER_TOKEN is shorter than 24 characters; use `openssl rand -hex 32`.");
  }
  const pollSeconds = trim(env.BOT_POLL_SECONDS);
  if (pollSeconds) {
    const seconds = Number(pollSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      problems.push(`BOT_POLL_SECONDS "${pollSeconds}" is not a number of seconds; using the default.`);
    } else if (seconds < 5 || seconds > 300) {
      problems.push(`BOT_POLL_SECONDS ${seconds} is outside the 5-300 second range and will be clamped.`);
    }
  }

  const logRequests = trim(env.LOG_REQUESTS);
  if (logRequests && !/^(1|0|true|false|yes|no|on|off)$/i.test(logRequests)) {
    problems.push(`LOG_REQUESTS "${logRequests}" is not a yes/no value; use 1 or 0.`);
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
    SITE_NAME: siteName,
    BOT_URL: botUrl,
    BOT_WORKER_TOKEN: botWorkerToken,
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

module.exports = { normalizeEnv };
