"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $("#presence-form");
  const field = (name) => form.elements.namedItem(name);

  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const appId = document.querySelector('meta[name="app-id"]')?.content || "";

  const TYPE_LABELS = ["PLAYING", "STREAMING", "LISTENING TO", "WATCHING", "", "COMPETING IN"];
  const BOT_STATES = {
    online: { className: "is-online", text: "Online" },
    connecting: { className: "is-idle", text: "Connecting…" },
    reconnecting: { className: "is-idle", text: "Reconnecting…" },
    idle: { className: "is-muted", text: "Idle" },
    error: { className: "is-error", text: "Connection error" },
    disabled: { className: "is-muted", text: "Dashboard only" },
    stopped: { className: "is-muted", text: "Stopped" }
  };

  let snapshot = null;
  let dirty = false;
  let previewStart = null;
  let toastTimer = null;

  // --------------------------------------------------------------- helpers

  function pad(value, size = 2) {
    return String(value).padStart(size, "0");
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  }

  function formatUptime(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  }

  function formatTime(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  }

  function assetUrl(key) {
    if (!key) return "";
    return `https://cdn.discordapp.com/app-assets/${encodeURIComponent(appId)}/${encodeURIComponent(key)}.png`;
  }

  function toast(message, isError = false) {
    const el = $("#toast");
    el.textContent = message;
    el.className = `toast is-visible${isError ? " is-error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = "toast";
    }, 2800);
  }

  async function api(path, method = "GET", body) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-csrf-token": csrf
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (response.status === 401) {
      location.href = "/login";
      throw new Error("Session expired.");
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      /* non-JSON error body */
    }

    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status})`);
      error.details = data?.errors || [];
      throw error;
    }
    return data || {};
  }

  // --------------------------------------------------------------- preview

  function setImage(img, wrap, fallback, key) {
    const url = assetUrl(key);
    if (!url) {
      img.hidden = true;
      img.removeAttribute("src");
      if (fallback) fallback.hidden = false;
      if (wrap) wrap.hidden = true;
      return;
    }
    img.hidden = false;
    img.src = url;
    if (fallback) fallback.hidden = true;
    if (wrap) wrap.hidden = false;
  }

  function renderPreview(config) {
    const type = Number(config.type) || 0;
    const custom = type === 4;
    const name = String(config.name || "").trim();

    $("#preview-type").textContent = custom ? "" : TYPE_LABELS[type] || "";
    $("#preview-name").textContent = custom
      ? name || "Custom status"
      : name || "Your activity";
    $("#preview-details").textContent = custom ? "" : config.details || "";
    $("#preview-state").textContent = custom ? "" : config.state || "";
    $("#preview-name").style.fontStyle = custom && !name ? "italic" : "";

    setImage($("#preview-large"), null, $("#preview-fallback"), custom ? "" : config.largeImage);
    setImage($("#preview-small"), $("#preview-small-wrap"), null, custom ? "" : config.smallImage);

    if (config.startedAt) {
      previewStart = Number(config.startTimestamp) || Date.now();
    } else {
      previewStart = null;
    }
    tickTimer();
  }

  function tickTimer() {
    $("#preview-time").textContent = previewStart ? `${formatDuration(Date.now() - previewStart)} elapsed` : "";
  }

  // ---------------------------------------------------------------- render

  function renderBot(bot) {
    const pill = $("#bot-pill");
    const info = BOT_STATES[bot?.status] || BOT_STATES.idle;
    pill.className = `pill ${info.className}`;
    $("#bot-pill-text").textContent = info.text;
    pill.title = bot?.error ? `${info.text} - ${bot.error}` : info.text;

    $("#bot-status").textContent = info.text;
    $("#bot-tag").textContent = bot?.tag || (bot?.enabled === false ? "Bot disabled" : "—");
    $("#bot-last").textContent = formatTime(bot?.lastAppliedAt);
    $("#bot-uptime").textContent = formatUptime(bot?.uptimeSeconds);

    const errorBox = $("#bot-error");
    const message = bot?.error || (bot?.enabled === false ? bot?.note : null);
    if (message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
      errorBox.className = bot?.error ? "alert" : "alert is-info";
    } else {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }
  }

  function renderMeta(meta, presence) {
    $("#app-id").textContent = meta?.clientId || "—";
    $("#app-version").textContent = meta?.version ? `v${meta.version}` : "—";

    const note = $("#preview-note");
    if (!presence?.enabled) {
      note.textContent = "Cleared";
      note.className = "tag";
    } else if (snapshot?.bot?.connected) {
      note.textContent = "Live";
      note.className = "tag is-live";
    } else {
      note.textContent = "Saved";
      note.className = "tag is-warn";
    }
  }

  function renderUser(user) {
    if (!user) return;
    const avatar = $("#user-avatar");
    $("#user-name").textContent = user.name || "Signed in";
    const initial = (user.name || "?").trim().charAt(0).toUpperCase() || "?";
    avatar.textContent = initial;
    if (user.avatar) {
      avatar.style.backgroundImage = `url("${user.avatar}")`;
      avatar.textContent = "";
    }
    const via = user.via === "discord" ? "Discord account" : "Dashboard key";
    $("#user-chip").title = `Signed in with ${via}`;
  }

  function updateFieldVisibility() {
    const type = Number(field("type")?.value) || 0;
    const custom = type === 4;
    for (const el of form.querySelectorAll('[data-when="details"]')) el.hidden = custom;
    for (const el of form.querySelectorAll('[data-when="assets"]')) el.hidden = custom;
    for (const el of form.querySelectorAll('[data-when="timer"]')) el.hidden = custom;
    for (const el of form.querySelectorAll('[data-when="url"]')) el.hidden = type !== 1;
    const restart = field("restartTimer");
    if (restart) restart.disabled = !field("startedAt")?.checked || custom;
  }

  function fillForm(presence) {
    const set = (name, value) => {
      const el = field(name);
      if (el) el.value = value ?? "";
    };
    set("name", presence.name);
    set("type", String(presence.type ?? 0));
    set("status", presence.status);
    set("details", presence.details);
    set("state", presence.state);
    set("url", presence.url);
    set("largeImage", presence.largeImage);
    set("largeText", presence.largeText);
    set("smallImage", presence.smallImage);
    set("smallText", presence.smallText);
    field("startedAt").checked = Boolean(presence.startedAt);
    field("restartTimer").checked = false;
    updateFieldVisibility();
  }

  function readForm() {
    return {
      name: field("name").value,
      type: Number(field("type").value),
      status: field("status").value,
      details: field("details").value,
      state: field("state").value,
      url: field("url").value,
      largeImage: field("largeImage").value,
      largeText: field("largeText").value,
      smallImage: field("smallImage").value,
      smallText: field("smallText").value,
      startedAt: field("startedAt").checked,
      restartTimer: field("restartTimer").checked,
      enabled: true
    };
  }

  function applySnapshot(next, { fill = true } = {}) {
    snapshot = next;
    renderBot(next.bot);
    renderMeta(next.meta, next.presence);
    renderUser(next.user);
    if (fill && !dirty) {
      fillForm(next.presence);
      renderPreview(next.presence);
    }
  }

  function setDirty(value) {
    dirty = value;
    $("#form-note").hidden = !value;
  }

  function showErrors(error) {
    const box = $("#form-errors");
    const messages = Array.isArray(error?.details) && error.details.length > 1 ? error.details : [];
    if (messages.length > 0) {
      box.innerHTML = "";
      const list = document.createElement("ul");
      for (const message of messages) {
        const item = document.createElement("li");
        item.textContent = message;
        list.append(item);
      }
      box.append(list);
    } else {
      box.textContent = error?.message || "Something went wrong.";
    }
    box.hidden = false;
  }

  function hideErrors() {
    const box = $("#form-errors");
    box.hidden = true;
    box.textContent = "";
  }

  function setBusy(busy) {
    const apply = $("#apply-btn");
    const clear = $("#clear-btn");
    apply.disabled = busy;
    clear.disabled = busy;
    apply.textContent = busy ? "Applying…" : "Apply presence";
  }

  // ------------------------------------------------------------------ wire

  form.addEventListener("input", () => {
    setDirty(true);
    renderPreview(readForm());
    updateFieldVisibility();
  });

  form.addEventListener("change", () => {
    setDirty(true);
    renderPreview(readForm());
    updateFieldVisibility();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideErrors();
    const payload = readForm();

    if (!payload.name.trim()) {
      showErrors(new Error("Activity name is required."));
      field("name").focus();
      return;
    }
    if (payload.type === 1 && !payload.url.trim()) {
      showErrors(new Error("A Streaming activity needs a Twitch or YouTube URL."));
      field("url").focus();
      return;
    }

    setBusy(true);
    try {
      const result = await api("/api/presence", "POST", payload);
      setDirty(false);
      field("restartTimer").checked = false;
      applySnapshot(
        { ...(snapshot || {}), presence: result.presence, activity: result.activity, bot: result.bot },
        { fill: false }
      );
      renderPreview(result.presence);
      renderMeta(snapshot.meta, result.presence);
      toast("Presence applied");
    } catch (error) {
      showErrors(error);
      toast(error.message || "Could not apply presence", true);
    } finally {
      setBusy(false);
    }
  });

  $("#clear-btn").addEventListener("click", async () => {
    if (!window.confirm("Clear the bot's presence? The activity will be removed.")) return;
    hideErrors();
    setBusy(true);
    try {
      const result = await api("/api/presence/clear", "POST", {});
      setDirty(false);
      applySnapshot({ ...(snapshot || {}), presence: result.presence, activity: null, bot: result.bot }, { fill: true });
      toast("Presence cleared");
    } catch (error) {
      showErrors(error);
      toast(error.message || "Could not clear presence", true);
    } finally {
      setBusy(false);
    }
  });

  $("#copy-invite").addEventListener("click", async () => {
    const input = $("#invite-url");
    try {
      await navigator.clipboard.writeText(input.value);
      toast("Invite link copied");
    } catch {
      input.select();
      document.execCommand("copy");
      toast("Invite link copied");
    }
  });

  $("#preview-large").addEventListener("error", () => {
    $("#preview-large").hidden = true;
    $("#preview-fallback").hidden = false;
  });
  $("#preview-small").addEventListener("error", () => {
    $("#preview-small-wrap").hidden = true;
  });
  $("#preview-large").addEventListener("load", () => {
    $("#preview-large").hidden = false;
    $("#preview-fallback").hidden = true;
  });

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return undefined;
    event.preventDefault();
    event.returnValue = "";
    return "";
  });

  // ------------------------------------------------------------ live updates

  let failures = 0;
  let poller = null;

  function startPolling() {
    if (poller) return;
    poller = setInterval(async () => {
      try {
        const next = await api("/api/state");
        applySnapshot(next, { fill: !dirty });
      } catch {
        /* keep trying */
      }
    }, 20_000);
  }

  function connectEvents() {
    if (typeof EventSource === "undefined") {
      startPolling();
      return;
    }
    const source = new EventSource("/api/events");
    source.addEventListener("state", (event) => {
      failures = 0;
      try {
        const message = JSON.parse(event.data);
        if (message?.data) applySnapshot(message.data, { fill: !dirty });
      } catch {
        /* ignore malformed frames */
      }
    });
    source.addEventListener("error", () => {
      failures += 1;
      // EventSource retries on its own; fall back to polling if it keeps failing.
      if (failures >= 3) {
        source.close();
        startPolling();
      }
    });
  }

  async function boot() {
    try {
      const state = await api("/api/state");
      applySnapshot(state, { fill: true });
      connectEvents();
    } catch (error) {
      if (location.pathname !== "/login") {
        toast(error.message || "Could not load dashboard state", true);
      }
    }
    setInterval(tickTimer, 1000);
  }

  void boot();
})();
