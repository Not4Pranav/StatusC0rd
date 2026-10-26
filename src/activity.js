"use strict";

/**
 * The in-Discord app, server half.
 *
 * Discord renders photos and buttons only on a *user's* profile, and the only
 * road to a user's profile is an Activity: a page Discord opens in an iframe
 * and lets talk to the local client. The client (public/activity/) signs in,
 * hands its OAuth2 code to POST /activity/api/token, then polls
 * /activity/api/presence with the token and pushes what it gets through
 * setActivity(). The client secret never reaches the browser.
 *
 * One owner: the Activity is authorised when the Discord user it identifies is
 * the linked owner (or on the ALLOWED_DISCORD_IDS list) - nothing else.
 */

const { exchangeActivityCode, fetchMe } = require("./oauth");
const { buildActivity } = require("./presence");

const FRAME_ANCESTORS = "https://discord.com https://*.discord.com";
const USER_CACHE_MS = 10 * 60_000;
const USER_CACHE_MAX = 100;

class ActivityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ActivityError";
    this.status = status;
  }
}

function createActivityService({ effective, store, now = Date.now }) {
  const users = new Map();
  let status = { connected: false, username: null, lastSeenAt: null, error: null };

  function exchangeToken(code) {
    const value = String(code || "").trim();
    const config = effective();
    if (!value) throw new ActivityError("Missing authorization code.");
    if (!config.clientId || !config.clientSecret) {
      throw new ActivityError("This instance has no Discord application configured. Add the application id and client secret in the dashboard.", 503);
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
    const cached = users.get(token);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached);
    return fetchMe(token).then((me) => {
      const entry = {
        id: String(me.id),
        username: me.global_name || me.username || "Discord user",
        expiresAt: now() + USER_CACHE_MS
      };
      if (users.size >= USER_CACHE_MAX) users.delete(users.keys().next().value);
      users.set(token, entry);
      return entry;
    });
  }

  function authorized(user) {
    const owner = store.owner;
    if (owner.discordId && String(user.id) === String(owner.discordId)) return true;
    const allowed = effective().allowedDiscordIds;
    if (Array.isArray(allowed) && allowed.map(String).includes(String(user.id))) return true;
    return false;
  }

  /**
   * The payload the in-Discord app pushes, plus what the dashboard shows.
   * @param {{ accessToken: string, origin: string }} params
   */
  function presence({ accessToken, origin }) {
    return identify(accessToken).then((user) => {
      if (!authorized(user)) {
        throw new ActivityError(
          "This Discord account is not the owner of this instance yet. Open the dashboard and press Connect Discord once.",
          403
        );
      }
      const config = effective();
      const publicUrl = config.publicUrl || origin;
      const resolveAsset = (id) => {
        const asset = store.findAsset(id);
        return asset ? store.assetUrl(asset, publicUrl) : "";
      };
      const presenceConfig = store.presence;
      const activity = buildActivity(presenceConfig, { target: "profile", publicUrl, resolveAsset });

      let reason = null;
      if (!activity) {
        if (!presenceConfig.enabled || !presenceConfig.name) {
          reason = "No card is live yet - save one in the dashboard and press Publish.";
        } else if (presenceConfig.targets && presenceConfig.targets.profile === false) {
          reason = "Your card is live, but 'My profile' is switched off in the dashboard.";
        } else {
          reason = "This card cannot be shown on a profile - check the type and the images.";
        }
      }

      status = {
        connected: Boolean(activity),
        username: user.username,
        lastSeenAt: new Date(now()).toISOString(),
        error: reason
      };

      return {
        user: { id: user.id, username: user.username },
        activity,
        assets: (activity && activity.assets) || {},
        buttons: (activity && activity.buttons) || [],
        presence: { name: presenceConfig.name },
        reason,
        publicUrl,
        updatedAt: new Date(now()).toISOString()
      };
    });
  }

  function snapshot() {
    return { ...status };
  }

  return { FRAME_ANCESTORS, exchangeToken, presence, snapshot };
}

module.exports = { createActivityService, ActivityError, FRAME_ANCESTORS };
