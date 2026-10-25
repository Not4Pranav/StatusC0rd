/**
 * StatusC0rd inside Discord.
 *
 * This page is loaded by the Discord client as an Activity - a web app in an
 * iframe. It talks to Discord through the Embedded App SDK, which is the only
 * supported way to put a photo, two lines of text, a timer and buttons on a
 * *user's* profile without installing anything on their computer.
 *
 * Flow:
 *   ready -> authorize (identify + rpc.activities.write) -> server exchanges the
 *   code (the client secret never reaches the browser) -> authenticate -> poll
 *   the dashboard's saved presence and push it with setActivity().
 */

import { DiscordSDK } from "./vendor/embedded-app-sdk.js";

const CLIENT_ID = document.body.dataset.clientId || "";
const DASHBOARD_URL = document.body.dataset.dashboard || "";

const POLL_MS = 5000;
const BOOT_TIMEOUT_MS = 12000;
const TYPES = { 0: "PLAYING", 1: "STREAMING", 2: "LISTENING", 3: "WATCHING", 4: "CUSTOM STATUS", 5: "COMPETING" };

const $ = (selector) => document.querySelector(selector);
const el = {
  pill: $("#state-pill"),
  pillText: $("#state-text"),
  setup: $("#setup-card"),
  setupTitle: $("#setup-title"),
  setupBody: $("#setup-body"),
  openDashboard: $("#open-dashboard"),
  preview: $("#preview-card"),
  error: $("#error-card"),
  errorTitle: $("#error-title"),
  errorBody: $("#error-body"),
  retry: $("#retry"),
  artLarge: $("#art-large"),
  artFallback: $("#art-fallback"),
  artSmall: $("#art-small"),
  artSmallWrap: $("#art-small-wrap"),
  type: $("#pv-type"),
  name: $("#pv-name"),
  details: $("#pv-details"),
  state: $("#pv-state"),
  time: $("#pv-time"),
  buttons: $("#pv-buttons"),
  buttonsNote: $("#buttons-note"),
  dashboardLink: $("#dashboard-link")
};

let sdk = null;
let accessToken = null;
let timer = null;
let buttonsSupported = true;
let startedAt = null;

function setPill(state, text) {
  el.pill.dataset.state = state;
  el.pillText.textContent = text;
}

function show(card) {
  for (const section of [el.setup, el.preview, el.error]) section.hidden = section !== card;
}

function fail(title, message, { retry = true, dashboard = false } = {}) {
  el.errorTitle.textContent = title;
  el.errorBody.textContent = message;
  el.openDashboard.hidden = !dashboard;
  el.retry.hidden = !retry;
  show(el.error);
  setPill("error", "Not connected");
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

/** Ask the server to swap the Activity's code for a token. */
async function exchangeCode(code) {
  const res = await fetch("./api/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body.error || `The server could not finish the Discord handshake (HTTP ${res.status}).`);
  }
  return body.access_token;
}

function renderPreview(payload) {
  const activity = payload.activity || {};
  const assets = payload.assets || {};
  const type = Number(activity.type);

  el.type.textContent = TYPES[type] || "PLAYING";
  el.name.textContent = payload.presence?.name || "StatusC0rd";
  el.details.textContent = activity.details || "";
  el.state.textContent = activity.state || (type === 4 ? activity.state || "" : "");

  if (assets.large_image) {
    el.artLarge.src = assets.large_image;
    el.artLarge.hidden = false;
    el.artFallback.hidden = true;
  } else {
    el.artLarge.hidden = true;
    el.artFallback.hidden = false;
  }

  if (assets.small_image) {
    el.artSmall.src = assets.small_image;
    el.artSmallWrap.hidden = false;
  } else {
    el.artSmallWrap.hidden = true;
  }

  el.buttons.textContent = "";
  for (const label of activity.buttons || []) {
    const chip = document.createElement("span");
    chip.textContent = label;
    el.buttons.append(chip);
  }

  startedAt = activity.timestamps?.start ? Number(activity.timestamps.start) : null;
  drawElapsed();

  if (payload.publicUrl) {
    el.dashboardLink.href = payload.publicUrl;
  } else if (DASHBOARD_URL) {
    el.dashboardLink.href = DASHBOARD_URL;
  } else {
    el.dashboardLink.removeAttribute("href");
  }
}

function drawElapsed() {
  if (!startedAt) {
    el.time.textContent = "";
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  el.time.textContent = hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest} elapsed` : `${minutes}:${rest} elapsed`;
}

/** Push the payload to Discord, falling back when buttons are unsupported. */
async function push(activity) {
  if (!activity) {
    await sdk.commands.setActivity({ activity: null });
    return;
  }

  const { name, metadata, ...rest } = activity; // `name` is the app name; Discord ignores it here.
  if (!buttonsSupported) {
    delete rest.buttons;
    delete rest.metadata;
  }

  try {
    await sdk.commands.setActivity({ activity: rest });
  } catch (error) {
    if (buttonsSupported && (rest.buttons || metadata)) {
      // Older clients reject the buttons/metadata fields outright.
      buttonsSupported = false;
      el.buttonsNote.hidden = false;
      delete rest.buttons;
      delete rest.metadata;
      await sdk.commands.setActivity({ activity: rest });
      return;
    }
    throw error;
  }
}

async function tick() {
  try {
    const res = await fetch("./api/presence", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store"
    });

    if (res.status === 401) {
      fail("Signed out", "Discord no longer accepts this session. Close and reopen the Activity.", { retry: false });
      return;
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      fail("Cannot load your presence", body.error || `HTTP ${res.status}`);
      return;
    }

    if (!body.activity) {
      await push(null);
      el.preview.hidden = true;
      el.setup.hidden = false;
      el.error.hidden = true;
      el.setupTitle.textContent = "No presence yet";
      el.setupBody.textContent =
        body.reason ||
        "Open the dashboard, save a presence, then come back - this window follows it automatically.";
      el.openDashboard.hidden = false;
      setPill("busy", "Waiting for a presence");
      return;
    }

    try {
      await push(body.activity);
    } catch (error) {
      // The dashboard answered - it is Discord that would not take the card.
      fail("Discord refused the activity", error.message || "The client rejected the presence.", {
        retry: true
      });
      return;
    }
    renderPreview(body);
    show(el.preview);
    setPill("live", buttonsSupported ? "On your profile" : "On your profile · no buttons");
  } catch (error) {
    fail("Could not reach the dashboard", error.message || "Network error.");
  }
}

function startPolling() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, POLL_MS);
  setInterval(drawElapsed, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
  tick();
}

async function boot() {
  if (!CLIENT_ID) {
    fail(
      "No application id",
      "This StatusC0rd instance has no Discord application id yet. Add it in the dashboard under Settings → Application & bot.",
      { retry: false, dashboard: true }
    );
    return;
  }

  sdk = new DiscordSDK(CLIENT_ID);
  try {
    await withTimeout(
      sdk.ready(),
      BOOT_TIMEOUT_MS,
      "Discord did not answer. Open this page from inside the Discord app (App Launcher → StatusC0rd)."
    );
  } catch (error) {
    fail("Open this inside Discord", error.message, { retry: false });
    return;
  }

  try {
    setPill("busy", "Connecting…");
    const { code } = await sdk.commands.authorize({
      client_id: CLIENT_ID,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "rpc.activities.write"]
    });

    accessToken = await exchangeCode(code);
    await sdk.commands.authenticate({ access_token: accessToken });
    startPolling();
  } catch (error) {
    fail("Discord refused the connection", error.message || String(error), { retry: true });
  }
}

el.retry.addEventListener("click", () => window.location.reload());
el.openDashboard.addEventListener("click", async () => {
  const url = el.dashboardLink.href || DASHBOARD_URL;
  if (!url) return;
  try {
    await sdk.commands.openExternalLink({ url });
  } catch {
    window.open(url, "_blank", "noreferrer");
  }
});

boot();
