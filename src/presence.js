"use strict";

/**
 * Presence configuration model.
 *
 * This module is intentionally free of I/O and Discord.js imports so that the
 * validation rules can be unit tested. `buildActivity` produces the plain
 * object Discord expects in a presence update.
 */

const ACTIVITY_TYPES = Object.freeze({
  0: "Playing",
  1: "Streaming",
  2: "Listening",
  3: "Watching",
  4: "Custom",
  5: "Competing"
});

const STATUSES = Object.freeze(["online", "idle", "dnd", "invisible"]);

const LIMITS = Object.freeze({
  name: 128,
  details: 128,
  state: 128,
  assetText: 128,
  url: 512,
  assetKey: 256
});

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  name: "StatusC0rd",
  type: 0,
  status: "online",
  details: "",
  state: "",
  url: "",
  largeImage: "",
  largeText: "",
  smallImage: "",
  smallText: "",
  startedAt: false,
  startTimestamp: null,
  updatedAt: null
});

const ASSET_KEY_RE = /^[a-zA-Z0-9_-]{1,256}$/;
const STREAM_HOSTS = ["twitch.tv", "youtube.com", "youtu.be"];

/** Collapse newlines/control characters and clamp to `max` characters. */
function toText(value, max) {
  if (value === undefined || value === null) return "";
  const text = String(value)
    .replace(/[\r\n\t]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.slice(0, max);
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no", ""].includes(v)) return false;
  return fallback;
}

function isStreamUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return STREAM_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/**
 * Validate an image asset key. Discord bot presences cannot use arbitrary image
 * URLs - the asset must be uploaded to the application's Rich Presence assets.
 */
function assetKeyError(value, label) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    return `${label} must be an asset key, not a URL. Upload the image under your application's Rich Presence assets and use its key.`;
  }
  if (!ASSET_KEY_RE.test(value)) {
    return `${label} may only contain letters, numbers, underscores and dashes.`;
  }
  return null;
}

/**
 * Normalise and validate an incoming presence payload.
 *
 * @param {object} input raw request body (strings are fine)
 * @param {{current?: object, now?: number}} [options]
 * @returns {{ok: boolean, errors: string[], value: object}}
 */
function sanitizePresence(input, options = {}) {
  const body = input && typeof input === "object" ? input : {};
  const current = options.current && typeof options.current === "object" ? options.current : DEFAULT_CONFIG;
  const now = options.now ?? Date.now();
  const errors = [];

  const name = toText(body.name, LIMITS.name);
  if (!name) errors.push("Activity name is required.");

  let type = Number.parseInt(body.type, 10);
  if (!Number.isInteger(type) || !(type in ACTIVITY_TYPES)) {
    if (body.type === undefined) type = Number(current.type) || 0;
    else errors.push("Activity type must be one of Playing, Streaming, Listening, Watching, Custom or Competing.");
  }
  if (!(type in ACTIVITY_TYPES)) type = 0;

  const status = String(body.status ?? current.status ?? "online").trim().toLowerCase();
  if (!STATUSES.includes(status)) {
    errors.push(`Status must be one of: ${STATUSES.join(", ")}.`);
  }

  const details = toText(body.details, LIMITS.details);
  const state = toText(body.state, LIMITS.state);

  let url = "";
  if (type === 1) {
    url = toText(body.url, LIMITS.url);
    if (!url) errors.push("A Streaming activity needs a Twitch or YouTube URL.");
    else if (!isStreamUrl(url)) {
      errors.push("Stream URL must be an https://twitch.tv/ or https://youtube.com/ link.");
    }
  }

  const largeImage = toText(body.largeImage, LIMITS.assetKey);
  const smallImage = toText(body.smallImage, LIMITS.assetKey);
  const largeText = toText(body.largeText, LIMITS.assetText);
  const smallText = toText(body.smallText, LIMITS.assetText);

  for (const [value, label] of [
    [largeImage, "Large image"],
    [smallImage, "Small image"]
  ]) {
    const error = assetKeyError(value, label);
    if (error) errors.push(error);
  }

  const enabled = toBoolean(body.enabled, Boolean(current.enabled ?? DEFAULT_CONFIG.enabled));
  const startedAt = toBoolean(body.startedAt, Boolean(current.startedAt));
  const restartTimer = toBoolean(body.restartTimer, false);

  let startTimestamp = null;
  if (startedAt) {
    const previous = Number(current.startTimestamp);
    if (!restartTimer && current.startedAt && Number.isFinite(previous) && previous > 0) {
      startTimestamp = previous;
    } else {
      startTimestamp = now;
    }
  }

  const value = {
    enabled,
    name,
    type,
    status: STATUSES.includes(status) ? status : "online",
    details,
    state,
    url,
    largeImage,
    largeText,
    smallImage,
    smallText,
    startedAt,
    startTimestamp,
    updatedAt: new Date(now).toISOString()
  };

  return { ok: errors.length === 0, errors, value };
}

/**
 * Build the activity object for discord.js / the Discord gateway.
 * Returns `null` when nothing should be displayed.
 */
function buildActivity(config) {
  if (!config || !config.enabled || !config.name) return null;

  const type = Number(config.type) || 0;
  if (!(type in ACTIVITY_TYPES)) return null;

  // Custom status: the text lives in `state`; other fields are not rendered.
  if (type === 4) {
    return { name: config.name, type: 4, state: config.name };
  }

  const activity = { name: config.name, type };

  if (config.details) activity.details = config.details;
  if (config.state) activity.state = config.state;
  if (type === 1 && config.url) activity.url = config.url;

  const assets = {};
  if (config.largeImage) {
    assets.large_image = config.largeImage;
    if (config.largeText) assets.large_text = config.largeText;
  }
  if (config.smallImage) {
    assets.small_image = config.smallImage;
    if (config.smallText) assets.small_text = config.smallText;
  }
  if (Object.keys(assets).length > 0) activity.assets = assets;

  if (config.startedAt && Number(config.startTimestamp) > 0) {
    activity.timestamps = { start: Number(config.startTimestamp) };
  }

  return activity;
}

/** "Playing StatusC0rd" - used in logs and the API. */
function describeActivity(config) {
  const activity = buildActivity(config);
  if (!activity) return "no activity";
  return `${ACTIVITY_TYPES[activity.type]} ${activity.name}`;
}

module.exports = {
  ACTIVITY_TYPES,
  STATUSES,
  LIMITS,
  DEFAULT_CONFIG,
  toText,
  toBoolean,
  isStreamUrl,
  assetKeyError,
  sanitizePresence,
  buildActivity,
  describeActivity
};
