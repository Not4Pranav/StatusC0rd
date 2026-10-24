"use strict";

/**
 * Minimal Discord OAuth2 client.
 *
 * The dashboard only needs an identity ("who is signing in"), which is the
 * `identify` scope. Rich-presence scopes (`rpc`, `rpc.activities.write`) are
 * restricted by Discord to approved partners and only work against a local
 * Discord client, so they are deliberately not requested here.
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
        "User-Agent": "StatusC0rd (dashboard, v2)",
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
 * @param {{clientId: string, redirectUri: string, state: string, scope?: string}} params
 */
function buildAuthorizeUrl({ clientId, redirectUri, state, scope = "identify" }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

/**
 * Exchange an authorization code for an access token.
 * @param {{code: string, clientId: string, clientSecret: string, redirectUri: string}} params
 */
async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri
  });

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

/** Fetch the signed-in user's profile. */
async function fetchMe(accessToken) {
  const me = await request(`${API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!me?.id) throw new DiscordApiError("Discord returned an unexpected user profile.", { status: 502 });
  return me;
}

/** Revoke a token (best effort, used when a session ends). */
async function revokeToken({ token, clientId, clientSecret }) {
  try {
    await request(`${API_BASE}/oauth2/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: clientId, client_secret: clientSecret })
    });
  } catch {
    // Revocation is best effort - never block sign-out on it.
  }
}

module.exports = {
  DiscordApiError,
  buildAuthorizeUrl,
  exchangeCode,
  fetchMe,
  revokeToken,
  API_BASE,
  AUTHORIZE_URL
};
