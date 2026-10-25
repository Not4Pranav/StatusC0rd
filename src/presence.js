"use strict";

/**
 * Presence configuration model.
 *
 * Pure functions only (no I/O, no discord.js) so every rule is unit testable.
 *
 * Two render targets consume this model:
 *
 *  - `bot`       - the hosted gateway bot. Discord only renders name, type and
 *                  state for bot accounts, so images/buttons cannot appear on
 *                  the bot's card.
 *  - `companion` - the small agent the user runs on their own computer, which
 *                  pushes the full activity (photos, buttons, timer) to their
 *                  local Discord client. This is the only supported way to put
 *                  rich presence on a *user's* profile.
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
  image: 512,
  buttonLabel: 32
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
  buttons: [],
  targets: { bot: true, companion: true },
  updatedAt: null
});

const ASSET_KEY_RE = /^[a-zA-Z0-9_-]{1,256}$/;
const ASSET_REF_RE = /^asset:([a-f0-9]{6,32})$/;
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
 * Classify an image field value.
 * @returns {{kind: "asset"|"url"|"key"|"empty", id?: string, value: string}}
 */
function imageKind(value) {
  const text = String(value || "").trim();
  if (!text) return { kind: "empty", value: "" };
  const ref = ASSET_REF_RE.exec(text);
  if (ref) return { kind: "asset", id: ref[1], value: text };
  if (/^https?:\/\//i.test(text)) return { kind: "url", value: text };
  return { kind: "key", value: text };
}

function imageError(value, label) {
  const info = imageKind(value);
  if (info.kind === "empty") return null;
  if (info.kind === "url") {
    try {
      const url = new URL(info.value);
      if (url.protocol !== "https:") return `${label}: image URLs must use https://.`;
    } catch {
      return `${label}: that does not look like a valid URL.`;
    }
    if (info.value.length > LIMITS.image) return `${label} URL is too long.`;
    return null;
  }
  if (info.kind === "key" && !ASSET_KEY_RE.test(info.value)) {
    return `${label}: use an uploaded image, an https:// URL, or a Discord asset key (letters, numbers, _ and -).`;
  }
  return null;
}

function sanitizeButtons(input) {
  if (!Array.isArray(input)) return [];
  const buttons = [];
  for (const button of input.slice(0, 2)) {
    if (!button || typeof button !== "object") continue;
    const label = toText(button.label, LIMITS.buttonLabel);
    const url = toText(button.url, LIMITS.image);
    if (!label || !/^https:\/\/\S+$/i.test(url)) continue;
    buttons.push({ label, url });
  }
  return buttons;
}

/**
 * Normalise and validate an incoming presence payload.
 *
 * @param {object} input raw request body
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
  if (!STATUSES.includes(status)) errors.push(`Status must be one of: ${STATUSES.join(", ")}.`);

  const details = toText(body.details, LIMITS.details);
  const state = toText(body.state, LIMITS.state);

  let url = "";
  if (type === 1) {
    url = toText(body.url, LIMITS.url);
    if (!url) errors.push("A Streaming activity needs a Twitch or YouTube URL.");
    else if (!isStreamUrl(url)) errors.push("Stream URL must be an https://twitch.tv/ or https://youtube.com/ link.");
  }

  const largeImage = toText(body.largeImage, LIMITS.image);
  const smallImage = toText(body.smallImage, LIMITS.image);
  const largeText = toText(body.largeText, LIMITS.assetText);
  const smallText = toText(body.smallText, LIMITS.assetText);

  for (const [value, label] of [
    [largeImage, "Large image"],
    [smallImage, "Small image"]
  ]) {
    const error = imageError(value, label);
    if (error) errors.push(error);
  }

  const buttons = sanitizeButtons(body.buttons);
  if (Array.isArray(body.buttons) && body.buttons.length > 0 && buttons.length === 0) {
    errors.push("Buttons need a label and an https:// link.");
  }

  const targetsInput = body.targets && typeof body.targets === "object" ? body.targets : current.targets || {};
  const targets = {
    bot: toBoolean(targetsInput.bot, true),
    companion: toBoolean(targetsInput.companion, true)
  };
  if (!targets.bot && !targets.companion) {
    errors.push("Pick at least one place to show the presence (bot, your profile, or both).");
  }

  const enabled = toBoolean(body.enabled, Boolean(current.enabled ?? DEFAULT_CONFIG.enabled));
  const startedAt = toBoolean(body.startedAt, Boolean(current.startedAt));
  const restartTimer = toBoolean(body.restartTimer, false);

  let startTimestamp = null;
  if (startedAt) {
    const previous = Number(current.startTimestamp);
    startTimestamp =
      !restartTimer && current.startedAt && Number.isFinite(previous) && previous > 0 ? previous : now;
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
    buttons,
    targets,
    updatedAt: new Date(now).toISOString()
  };

  return { ok: errors.length === 0, errors, value };
}

/**
 * Resolve an image field to something Discord can display.
 * @param {string} value stored field value
 * @param {{publicUrl?: string, resolveAsset?: (id: string) => string}} options
 */
function resolveImage(value, options = {}) {
  const info = imageKind(value);
  if (info.kind === "empty") return "";
  if (info.kind === "url") return info.value;
  if (info.kind === "asset") {
    // Only an asset lookup knows the file extension; without it the image
    // cannot be served, so fail closed instead of emitting a broken URL.
    if (options.resolveAsset) return options.resolveAsset(info.id) || "";
    return "";
  }
  return info.value; // Discord asset key
}

/**
 * Build the activity object for a target.
 *
 * @param {object} config stored presence config
 * @param {{target?: "bot"|"companion", publicUrl?: string, resolveAsset?: (id: string) => string}} [options]
 */
function buildActivity(config, options = {}) {
  if (!config || !config.enabled || !config.name) return null;
  const target = options.target === "companion" ? "companion" : "bot";
  if (config.targets && config.targets[target] === false) return null;

  const type = Number(config.type) || 0;
  if (!(type in ACTIVITY_TYPES)) return null;

  const resolve = (value) => resolveImage(value, options);

  // Custom status: Discord renders only the state text.
  if (type === 4) {
    return { name: config.name, type: 4, state: config.name };
  }

  const activity = { name: config.name, type };
  if (config.details) activity.details = config.details;
  if (config.state) activity.state = config.state;
  if (type === 1 && config.url) activity.url = config.url;

  const assets = {};
  const large = resolve(config.largeImage);
  const small = resolve(config.smallImage);
  if (large) {
    assets.large_image = large;
    if (config.largeText) assets.large_text = config.largeText;
  }
  if (small) {
    assets.small_image = small;
    if (config.smallText) assets.small_text = config.smallText;
  }
  if (Object.keys(assets).length > 0) activity.assets = assets;

  if (target === "companion") {
    // RPC renders buttons (the gateway does not do this for bots). The wire
    // format is `buttons: [label]` plus `metadata.button_urls: [url]`.
    const buttons = Array.isArray(config.buttons) ? config.buttons.slice(0, 2) : [];
    if (buttons.length > 0) {
      activity.buttons = buttons.map((button) => button.label);
      activity.metadata = { button_urls: buttons.map((button) => button.url) };
    }
  }

  if (config.startedAt && Number(config.startTimestamp) > 0) {
    // Discord expects timestamps in milliseconds on the gateway.
    activity.timestamps = { start: Number(config.startTimestamp) };
  }

  return activity;
}

module.exports = {
  ACTIVITY_TYPES,
  DEFAULT_CONFIG,
  STATUSES,
  buildActivity,
  sanitizePresence
};
