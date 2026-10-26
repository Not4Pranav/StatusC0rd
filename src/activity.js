"use strict";

/**
 * The in-Discord app, server half - one card per account.
 *
 * Discord renders photos and buttons only on a *user's* profile, and the only
 * road to a user's profile is an Activity: a page Discord opens in an iframe
 * and lets talk to the local client. The client (public/activity/) signs in,
 * hands its OAuth2 code to POST /activity/api/token, then polls
 * /activity/api/presence with the token and pushes what it gets through
 * setActivity(). The client secret never reaches the browser.
 *
 * Multi-user: the OAuth token identifies the Discord user, and each user is
 * served their own saved card. No pairing codes, no allowlist - anyone who
 * has signed in on the website once gets their card here.
 */

const { exchangeActivityCode, fetchMe } = require("./oauth");
const { buildActivity } = require("./presence");

const FRAME_ANCESTORS = "https://discord.com https://*.discord.com";
const USER_CACHE_MS = 10 * 60_000;
const USER_CACHE_MAX = 500;

class ActivityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ActivityError";
    this.status = status;
  }
}

function createActivityService({ effective, store, now = Date.now }) {
  const identities = new Map(); // access token -> discord identity, short-lived
  const status = new Map();     // discord id -> last answer, for the dashboard pill

  function exchangeToken(code) {
    const value = String(code || "").trim();
    const config = effective();
    if (!value) throw new ActivityError("Missing authorization code.");
    if (!config.clientId || !config.clientSecret) {
      throw new ActivityError("This instance has no Discord application configured. The admin must add the application id and client secret in the dashboard.", 503);
    }
    return exchangeActivityCode({ code: value, clientId: config.clientId, clientSecret: config.clientSecret })
      .then((token) => token.access_token)
      .catch((error) => {
        throw new ActivityError(error.message || "Discord refused the sign-in.", 502);
      });
  }

  function identify(accessToken) {
    const token = String(accessToken || "").trim();
    if (!token) throw new ActivityError("Not signed in to Discord inside the Activity.", 401);
    const cached = identities.get(token);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached);
    return fetchMe(token).then((me) => {
      const entry = {
        id: String(me.id),
        username: me.global_name || me.username || "Discord user",
        expiresAt: now() + USER_CACHE_MS
      };
      if (identities.size >= USER_CACHE_MAX) identities.delete(identities.keys().next().value);
      identities.set(token, entry);
      return entry;
    });
  }

  function remember(id, patch) {
    const key = String(id);
    const base = status.get(key) || { connected: false, username: null, lastSeenAt: null, error: null };
    status.set(key, Object.assign({}, base, patch));
    if (status.size > USER_CACHE_MAX) status.delete(status.keys().next().value);
  }

  /**
   * The payload the in-Discord app pushes, plus what the dashboard shows.
   * @param {{ accessToken: string, origin: string }} params
   */
  function presence({ accessToken, origin }) {
    return identify(accessToken).then((user) => {
      const config = effective();
      const publicUrl = config.publicUrl || origin;
      const account = store.getUser(user.id);
      let activity = null;
      let reason = null;

      if (!account) {
        reason = "No account here yet - sign in on the website once, save a card, then reopen this app.";
      } else {
        const resolveAsset = (id) => {
          const asset = store.findAsset(account.id, id);
          return asset ? store.assetUrl(asset, publicUrl) : "";
        };
        const presenceConfig = account.presence;
        activity = buildActivity(presenceConfig, { target: "profile", publicUrl, resolveAsset });
        if (!activity) {
          if (!presenceConfig.enabled || !presenceConfig.name) {
            reason = "No card is live yet - save one on the website first.";
          } else if (presenceConfig.targets && presenceConfig.targets.profile === false) {
            reason = "Your card is live, but 'My profile' is switched off on the website.";
          } else {
            reason = "This card cannot be shown on a profile - check the type and the images.";
          }
        }
      }

      remember(user.id, {
        connected: Boolean(activity),
        username: user.username,
        lastSeenAt: new Date(now()).toISOString(),
        error: reason
      });

      return {
        user: { id: user.id, username: user.username },
        activity,
        assets: (activity && activity.assets) || {},
        buttons: (activity && activity.buttons) || [],
        presence: { name: account ? account.presence.name : "" },
        reason,
        publicUrl,
        updatedAt: new Date(now()).toISOString()
      };
    });
  }

  /** The dashboard pill for one account. */
  function snapshot(userId) {
    return status.get(String(userId || "")) || { connected: false, username: null, lastSeenAt: null, error: null };
  }

  return { FRAME_ANCESTORS, exchangeToken, presence, snapshot };
}

module.exports = { createActivityService, ActivityError, FRAME_ANCESTORS };
