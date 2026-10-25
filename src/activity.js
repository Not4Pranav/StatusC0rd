"use strict";

/**
 * Discord Activities support: rich presence with no download.
 *
 * Discords' rules are the reason this module exists:
 *
 *   - a bot may only broadcast `name`, `type` and `state`, so photos and
 *     buttons are invisible on a bot card;
 *   - the only client-side ways to set a *user's* presence are the local RPC
 *     socket (the companion agent) or an Activity - a web app that Discord
 *     itself hosts in an iframe and lets talk to the local client.
 *
 * An Activity is a real web experience: the user clicks "Open in Discord", the
 * page loads inside the Discord client, and `setActivity()` puts the photo,
 * the two lines of text, the timer and (where the client allows it) the two
 * buttons on their profile. Nothing is installed.
 *
 * This module owns the server half: the OAuth2 code exchange (the client
 * secret must never reach the browser), verifying who is asking, and building
 * the activity object from the dashboard's saved presence.
 */

const { exchangeActivityCode, fetchMe } = require("./oauth");
const { buildActivity } = require("./presence");

/** Discord embeds the Activity in an iframe served from these origins. */
const FRAME_ANCESTORS = "https://discord.com https://*.discord.com";

/** Fields worth telling the dashboard about; `lastSeenAt` changes on every poll. */
const OBSERVABLE_FIELDS = ["connected", "userId", "username", "error"];

/** How long a verified access token is trusted without asking Discord again. */
const USER_CACHE_MS = 10 * 60_000;
const USER_CACHE_MAX = 200;

class ActivityError extends Error {
  constructor(message, { status = 400, code = null } = {}) {
    super(message);
    this.name = "ActivityError";
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {object} options
 * @param {import('./settings').SettingsStore} options.settings
 * @param {import('./assets').AssetStore} options.assets
 * @param {Console} [options.logger]
 * @param {() => number} [options.now]
 */
function createActivityService({ settings, assets, logger = console, now = Date.now }) {
  const users = new Map(); // access token -> { id, username, expiresAt }
  let status = { connected: false, userId: null, username: null, lastSeenAt: null, error: null };

  function config() {
    const effective = settings.effective();
    return {
      clientId: String(effective.clientId || "").trim(),
      clientSecret: String(effective.clientSecret || "").trim(),
      publicUrl: String(effective.publicUrl || "").trim()
    };
  }

  function ready() {
    const { clientId, clientSecret } = config();
    return Boolean(clientId && clientSecret);
  }

  /** Exchange the Activity's OAuth2 code for a token, server-side. */
  async function exchangeToken(code) {
    const value = String(code || "").trim();
    if (!value) throw new ActivityError("Missing authorization code.");
    const { clientId, clientSecret } = config();
    if (!clientId || !clientSecret) {
      throw new ActivityError(
        "This instance has no Discord application id or client secret, so the in-Discord app is unavailable. Add both under Settings.",
        { status: 503, code: "not_configured" }
      );
    }
    const token = await exchangeActivityCode({ code: value, clientId, clientSecret });
    return { accessToken: token.access_token, expiresIn: Number(token.expires_in) || null };
  }

  /** Verify a bearer token without hammering Discord on every poll. */
  async function identify(accessToken) {
    const token = String(accessToken || "").trim();
    if (!token) throw new ActivityError("Not signed in to Discord inside the Activity.", { status: 401 });

    const cached = users.get(token);
    if (cached && cached.expiresAt > now()) return cached;

    const me = await fetchMe(token);
    const entry = {
      id: me.id,
      username: me.global_name || me.username || "Discord user",
      avatar: me.avatar || null,
      expiresAt: now() + USER_CACHE_MS
    };
    if (users.size >= USER_CACHE_MAX) users.delete(users.keys().next().value);
    users.set(token, entry);
    return entry;
  }

  function allowed(userId) {
    const list = settings.effective().allowedDiscordIds;
    if (!Array.isArray(list) || list.length === 0) return true; // single-tenant install
    return list.map(String).includes(String(userId));
  }

  /**
   * Which StatusC0rd account is this Discord user?
   *
   * The Activity only ever learns a Discord user id, so "Connect Discord" writes
   * a link and this resolves it. A single-tenant instance that predates accounts
   * keeps working: with no links and no member accounts, the one card is the
   * admin's, exactly as before.
   */
  function ownerForDiscordUser(discordId) {
    const linked = settings.userIdForDiscord(discordId);
    if (linked) return { userId: linked, via: "link" };
    if (settings.countUsers() === 0 && Object.keys(settings.get().discordLinks || {}).length === 0) {
      return { userId: settings.adminUserId, via: "legacy" };
    }
    return { userId: null, via: null };
  }

  /**
   * The payload the Activity pushes with setActivity(), plus who it belongs to.
   * @param {{accessToken: string, origin: string}} params
   */
  async function presence({ accessToken, origin }) {
    const user = await identify(accessToken);
    const resolved = ownerForDiscordUser(user.id);
    if (!resolved.userId) {
      throw new ActivityError(
        "This Discord account is not connected to a StatusC0rd account yet. Open the dashboard, go to My profile and press “Connect Discord” once.",
        { status: 403, code: "not_linked" }
      );
    }
    // An explicit link is the whole authorisation: the account exists on this
    // instance. The allowlist only still gates the pre-accounts fallback.
    if (resolved.via === "legacy" && !allowed(user.id)) {
      throw new ActivityError(
        "This Discord account is not on the allowlist for this StatusC0rd instance.",
        { status: 403, code: "not_allowed" }
      );
    }

    const presenceConfig = settings.presenceFor(resolved.userId) || null;
    const publicUrl = config().publicUrl || origin;
    const resolveAsset = (id) => {
      const asset = settings.findAsset(id);
      return asset ? assets.url(asset, publicUrl) : "";
    };

    // `companion` is the target that carries images and buttons.
    const activity = buildActivity(presenceConfig, {
      target: "companion",
      publicUrl,
      resolveAsset
    });

    // An empty activity has three different causes; say which one, otherwise a
    // user with a perfectly good presence gets told to "build one".
    let reason = null;
    if (!activity) {
      if (!presenceConfig || !presenceConfig.enabled || !presenceConfig.name) {
        reason = "No presence is live yet - save one on the Presence tab and press Publish.";
      } else if (presenceConfig.targets && presenceConfig.targets.companion === false) {
        reason = "Your presence is live, but \u201cMy own profile\u201d is switched off on the Presence tab.";
      } else {
        reason = "This presence cannot be shown on your profile - check the activity type and images.";
      }
    }

    const next = {
      connected: Boolean(activity),
      userId: resolved.userId,
      discordId: user.id,
      username: user.username,
      lastSeenAt: new Date(now()).toISOString(),
      error: reason
    };
    // The Activity polls every few seconds; only a real change is worth an SSE
    // broadcast to every open dashboard.
    const changed = OBSERVABLE_FIELDS.some((key) => status[key] !== next[key]);
    status = next;

    return {
      user: { id: user.id, username: user.username },
      activity,
      assets: activity?.assets || {},
      buttons: activity?.buttons || [],
      presence: presenceConfig,
      reason,
      changed,
      publicUrl,
      updatedAt: new Date(now()).toISOString()
    };
  }

  function snapshot() {
    return { ...status };
  }

  /**
   * Called when Discord rejects the activity payload so the dashboard can say why.
   * @returns {boolean} whether anything the dashboard shows actually changed
   */
  function noteError(message) {
    const error = String(message || "Discord rejected the presence.").slice(0, 200);
    const changed = status.error !== error;
    status = { ...status, error };
    return changed;
  }

  function reset() {
    status = { connected: false, userId: null, username: null, lastSeenAt: null, error: null };
  }

  return {
    FRAME_ANCESTORS,
    config,
    ready,
    exchangeToken,
    identify,
    allowed,
    presence,
    snapshot,
    noteError,
    reset
  };
}

module.exports = { createActivityService, ActivityError, FRAME_ANCESTORS };
