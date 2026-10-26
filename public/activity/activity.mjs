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
// A real Discord client answers the authorize call in about a second. A plain
// browser tab never does, and without this the page would sit on "Connecting…"
// forever - which is exactly what happens to anyone who opens the link directly.
const HANDSHAKE_TIMEOUT_MS = 8000;
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
  dashboardLink: $("#dashboard-link"),
  bootHint: $("#boot-hint"),
  linkCard: $("#link-card"),
  linkCode: $("#link-code"),
  linkCopy: $("#link-copy"),
  linkOpen: $("#link-open"),
  linkNew: $("#link-new"),
  linkExpiry: $("#link-expiry"),
  linkError: $("#link-error")
};

let sdk = null;
let accessToken = null;
let timer = null;
let elapsedTimer = null;
let buttonsSupported = true;
let startedAt = null;
/** What the link panel is showing, so a poll does not fetch a code twice. */
let linkCode = null;
let linkFetchedAt = 0;
let linkExpiresAt = 0;
/** Set after a failure that retrying cannot fix (signed out, not linked). */
let stopped = false;
/** What the client is currently showing, so an unchanged card is not re-pushed. */
let lastPushed = null;

function setPill(state, text) {
  el.pill.dataset.state = state;
  el.pillText.textContent = text;
}

function show(card) {
  for (const section of [el.setup, el.preview, el.error, el.linkCard]) {
    if (section) section.hidden = section !== card;
  }
}

function fail(title, message, { retry = true, dashboard = false, terminal = false } = {}) {
  // A signed-out session or a missing link will fail identically every five
  // seconds; say it once and stop, instead of hammering the server.
  if (terminal) stopPolling();
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

/**
 * Ask the server for the code that connects this Discord account to an account
 * on the website, and put it on screen.
 *
 * Throttled: the panel polls every five seconds, but a code lives for fifteen
 * minutes and the server hands back the same one until it expires, so asking on
 * every tick would be pure noise.
 */
async function showLinkCode({ force = false } = {}) {
  const fresh = linkCode && Date.now() - linkFetchedAt < 30_000;
  if (!force && fresh) return;
  try {
    const res = await fetch("./api/link-code", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: "{}"
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      el.linkError.textContent = body.error || `Could not get a code (HTTP ${res.status}).`;
      el.linkError.hidden = false;
      return;
    }
    if (body.linked) {
      // Someone connected it from the website while this was open.
      linkCode = null;
      await tick();
      return;
    }

    linkCode = body.code;
    linkFetchedAt = Date.now();
    linkExpiresAt = body.expiresAt ? new Date(body.expiresAt).getTime() : Date.now() + 15 * 60_000;
    el.linkCode.textContent = body.code;
    el.linkError.hidden = true;
    drawExpiry();
    if (body.url) el.linkOpen.dataset.url = body.url;
    setPill("busy", "Waiting for the website");
    show(el.linkCard);
  } catch (error) {
    el.linkError.textContent = error.message || "Could not reach the website.";
    el.linkError.hidden = false;
  }
}

function drawExpiry() {
  if (!el.linkExpiry) return;
  if (!linkExpiresAt) {
    el.linkExpiry.textContent = "";
    return;
  }
  const left = Math.max(0, Math.round((linkExpiresAt - Date.now()) / 1000));
  el.linkExpiry.textContent =
    left > 0
      ? `Valid for another ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} — single use.`
      : "That code has expired. Press “New code”.";
}

async function tick() {
  try {
    const res = await fetch("./api/presence", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store"
    });

    if (res.status === 401) {
      fail("Signed out", "Discord no longer accepts this session. Close and reopen the Activity.", {
        retry: false,
        terminal: true
      });
      return;
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Not connected yet is not a failure: it is the one step only the person
      // can take, and this panel is where they take it.
      if (res.status === 403 && body.code === "not_linked") {
        await showLinkCode();
        return;
      }
      if (res.status === 403 && body.code === "not_allowed") {
        fail("Not allowed here", body.error || "This account is not on this instance's allowlist.", {
          retry: false,
          terminal: true
        });
        return;
      }
      fail("Cannot load your presence", body.error || `HTTP ${res.status}`, {
        terminal: res.status === 403
      });
      return;
    }

    if (!body.activity) {
      if (lastPushed !== null) {
        lastPushed = null;
        await push(null);
      }
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

    const fingerprint = JSON.stringify(body.activity);
    try {
      if (fingerprint !== lastPushed) {
        lastPushed = fingerprint;
        await push(body.activity);
      }
    } catch (error) {
      // The dashboard answered - it is Discord that would not take the card.
      fail("Discord refused the activity", error.message || "The client rejected the presence.", {
        retry: true
      });
      return;
    }
    linkCode = null;
    renderPreview(body);
    show(el.preview);
    setPill("live", buttonsSupported ? "On your profile" : "On your profile · no buttons");
  } catch (error) {
    fail("Could not reach the dashboard", error.message || "Network error.");
  }
}

function startPolling() {
  stopPolling();
  stopped = false;
  timer = setInterval(tick, POLL_MS);
  elapsedTimer = setInterval(() => {
    drawElapsed();
    if (linkCode) drawExpiry();
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !stopped) tick();
  });
  tick();
}

function stopPolling() {
  stopped = true;
  if (timer) clearInterval(timer);
  if (elapsedTimer) clearInterval(elapsedTimer);
  timer = null;
  elapsedTimer = null;
}

async function boot() {
  // Only a browser tab needs this advice; the script itself proves it loaded.
  if (el.bootHint) el.bootHint.hidden = true;
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
    const { code } = await withTimeout(
      sdk.commands.authorize({
        client_id: CLIENT_ID,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify", "rpc.activities.write"]
      }),
      HANDSHAKE_TIMEOUT_MS,
      "Discord did not answer the sign-in request. Open this from inside the Discord app (App Launcher → StatusC0rd), not in a browser tab."
    );

    accessToken = await exchangeCode(code);
    await withTimeout(
      sdk.commands.authenticate({ access_token: accessToken }),
      HANDSHAKE_TIMEOUT_MS,
      "Discord did not finish signing this window in. Close it and open the Activity again."
    );
    startPolling();
  } catch (error) {
    fail("Discord refused the connection", error.message || String(error), { retry: true });
  }
}

el.retry.addEventListener("click", () => window.location.reload());

el.linkNew?.addEventListener("click", () => showLinkCode({ force: true }));

el.linkCopy?.addEventListener("click", async () => {
  const code = el.linkCode?.textContent?.trim() || "";
  if (!code || code.startsWith("·")) return;
  try {
    await navigator.clipboard.writeText(code);
    el.linkCopy.textContent = "Copied";
    setTimeout(() => {
      el.linkCopy.textContent = "Copy";
    }, 1600);
  } catch {
    // Clipboard access inside an iframe can be refused; selecting the code is
    // the next best thing and never fails.
    const range = document.createRange();
    range.selectNodeContents(el.linkCode);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    el.linkCopy.textContent = "Selected";
  }
});

el.linkOpen?.addEventListener("click", async () => {
  const url = el.linkOpen.dataset.url || DASHBOARD_URL;
  if (!url) return;
  try {
    await sdk.commands.openExternalLink({ url });
  } catch {
    window.open(url, "_blank", "noreferrer");
  }
});
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
