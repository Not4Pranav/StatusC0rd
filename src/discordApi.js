"use strict";

/**
 * Read-only Discord application checks.
 *
 * The pipeline has one silent failure mode: the website is fine, the card is
 * fine, the person presses "Open in Discord" - and nothing is there, because the
 * Discord application is not installable to users or its Launch command is
 * server-only. Those settings live in the Developer Portal, so this module reads
 * them from Discord and turns them into sentences a person can act on.
 *
 * Nothing here writes to Discord: no consent is needed for reading your own
 * application with its own bot token, and a wrong or missing token is reported
 * as such rather than guessed at.
 */

/** Overridable so tests can point at a local stub instead of the real API. */
function apiBase() {
  return String(process.env.DISCORD_API_BASE || "https://discord.com/api/v10").replace(/\/+$/, "");
}

const TIMEOUT_MS = 8_000;

class DiscordApiError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
    this.code = code;
  }
}

async function call(path, token, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetchImpl(`${apiBase()}${path}`, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": `StatusC0rd/${require("../package.json").version} (app check)`
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new DiscordApiError("Discord did not answer in time. Try again in a moment.", { status: 504 });
    }
    throw new DiscordApiError(
      "This server could not reach Discord, so the app could not be checked.",
      { status: 502 }
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new DiscordApiError(
      "Discord rejected the bot token, so the app could not be checked. Copy it again from Developer Portal → Bot.",
      { status: 401, code: "bad_token" }
    );
  }

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new DiscordApiError(
      body?.message || `Discord answered HTTP ${response.status}.`,
      { status: response.status }
    );
  }
  return body;
}

/** Installation contexts Discord reports for an application. */
function installContexts(application) {
  const config = application?.integration_types_config;
  if (!config || typeof config !== "object") return { user: false, guild: false, raw: null };
  return {
    user: Boolean(config["1"]),
    guild: Boolean(config["0"]),
    raw: config
  };
}

/**
 * The Launch command that Activities creates for an app.
 *
 * Type 4 is PRIMARY_ENTRY_POINT. `integration_types` says where it can be
 * installed: 0 = to a server, 1 = to a person's account. A user-installed app
 * whose entry point only lists 0 will not appear in anyone's App Launcher.
 */
function findEntryPoint(commands) {
  const list = Array.isArray(commands) ? commands : [];
  const command = list.find((item) => Number(item?.type) === 4);
  if (!command) return null;
  const types = Array.isArray(command.integration_types) ? command.integration_types.map(Number) : [0];
  return { name: command.name || "Launch", integrationTypes: types, contexts: command.contexts || [] };
}

/**
 * Inspect the application and explain, in order, what to fix.
 *
 * @param {{token: string, fetchImpl?: Function}} options
 */
async function inspectApplication({ token, fetchImpl = fetch } = {}) {
  const botToken = String(token || "").trim();
  if (!botToken) {
    throw new DiscordApiError(
      "No bot token is stored, so the Discord application cannot be checked. Add one under Settings → Application & bot.",
      { status: 400, code: "no_token" }
    );
  }

  const application = await call("/applications/@me", botToken, { fetchImpl });
  if (!application?.id) {
    throw new DiscordApiError("Discord returned an unexpected application object.", { status: 502 });
  }
  const commands = await call(`/applications/${encodeURIComponent(application.id)}/commands`, botToken, {
    fetchImpl
  }).catch(() => null);

  const install = installContexts(application);
  const entryPoint = findEntryPoint(commands);
  const entryPointOk = Boolean(entryPoint && entryPoint.integrationTypes.includes(1));
  const problems = [];

  if (!install.user) {
    problems.push(
      "User Install is off. In the Developer Portal: Installation → Installation Contexts → tick User Install → Save. Without it nobody can add the app to their own account."
    );
  }
  if (!entryPoint) {
    problems.push(
      "No Launch command was found, which means Activities are not enabled for this app. Developer Portal → Activities → Settings → Enable Activities (add a URL Mapping first)."
    );
  } else if (!entryPointOk) {
    problems.push(
      "The Launch command is only installable to servers, so it will not appear in anyone's App Launcher. Re-save Installation Contexts with User Install ticked, then reload this check."
    );
  }
  if (!install.guild && application.bot_public !== false) {
    problems.push(
      "Guild Install is off: the app cannot be added to a server, so the 24/7 bot card has no server to live in. Tick Guild Install as well if you want the bot."
    );
  }

  return {
    id: String(application.id),
    name: application.name || "",
    description: application.description || "",
    install,
    entryPoint,
    entryPointOk,
    problems,
    checkedAt: new Date().toISOString()
  };
}

module.exports = { inspectApplication, installContexts, findEntryPoint, DiscordApiError, apiBase };
