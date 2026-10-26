"use strict";

/**
 * Minimal Discord OAuth2 client.
 *
 * The dashboard only needs an identity ("who is signing in"), which is the
 * `identify` scope. The `rpc` scope (raw RPC against a local Discord client) is
 * restricted to approved partners, but `rpc.activities.write` - the scope an
 * Activity needs to set a user's rich presence - is available to any app, and is
 * requested from inside the Activity rather than here.
 */

const API_BASE = "https://discord.com/api/v10";
const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DEFAULT_TIMEOUT_MS = 10_000;

class DiscordApiError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": `StatusC0rd/${require("../package.json").version} (dashboard)`,
        ...options.headers
      }
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new DiscordApiError("Discord did not respond in time. Please try again.", { status: 504 });
    }
    throw new DiscordApiError(`Could not reach Discord: ${error.message}`, { status: 502 });
  }

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const detail =
      body?.error_description || body?.message || body?.error || `HTTP ${response.status}`;
    throw new DiscordApiError(`Discord rejected the request: ${detail}`, {
      status: response.status,
      code: body?.code ?? null,
      body
    });
  }

  return body;
}

/**
 * Build the authorization URL the user is redirected to.
 *
 * `integrationType: 1` is Discord's USER_INSTALL context: the app is added to
 * the person's own account instead of a server, which is what lets it show up in
 * their App Launcher in every server and DM. That is the "authorise the app"
 * step of the pipeline - Discord's own consent screen, no bot permission asked
 * for beyond `applications.commands`.
 *
 * @param {{clientId: string, redirectUri: string, state: string, scope?: string, integrationType?: number|null}} params
 */
function buildAuthorizeUrl({ clientId, redirectUri, state, scope = "identify", integrationType = null }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  const type = Number(integrationType);
  if (Number.isInteger(type) && type >= 0) url.searchParams.set("integration_type", String(type));
  return url.toString();
}

/**
 * Exchange an authorization code for an access token.
 * @param {{code: string, clientId: string, clientSecret: string, redirectUri: string}} params
 */
async function requestToken(body) {
  const token = await request(
    `${API_BASE}/oauth2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    },
    15_000
  );

  if (!token?.access_token) {
    throw new DiscordApiError("Discord returned no access token.", { status: 502 });
  }
  return token;
}

async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    })
  );
}

/**
 * Exchange an Activity's OAuth2 code.
 *
 * `authorize()` inside an Activity does not take a redirect URI - Discord
 * completes the redirect itself - so the token request must not send one.
 */
async function exchangeActivityCode({ code, clientId, clientSecret }) {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret
    })
  );
}

/** Fetch the signed-in user's profile. */
async function fetchMe(accessToken) {
  const me = await request(`${API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!me?.id) throw new DiscordApiError("Discord returned an unexpected user profile.", { status: 502 });
  return me;
}

module.exports = { exchangeActivityCode, exchangeCode, fetchMe, buildAuthorizeUrl };
