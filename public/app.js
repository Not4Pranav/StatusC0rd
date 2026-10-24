"use strict";

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const form = $("#presence-form");
  const field = (name) => form.elements.namedItem(name);
  const upload = window.StatusC0rdUpload;

  const csrf = $('meta[name="csrf-token"]')?.content || "";
  const appId = $('meta[name="app-id"]')?.content || "";

  const TYPE_LABELS = ["PLAYING", "STREAMING", "LISTENING TO", "WATCHING", "", "COMPETING IN"];
  const BOT_STATES = {
    online: { className: "is-online", text: "Bot online" },
    connecting: { className: "is-idle", text: "Connecting…" },
    reconnecting: { className: "is-idle", text: "Reconnecting…" },
    idle: { className: "is-muted", text: "Bot idle" },
    error: { className: "is-error", text: "Bot offline" },
    disabled: { className: "is-muted", text: "No bot" },
    stopped: { className: "is-muted", text: "Bot stopped" }
  };

  let state = null;
  let draft = { largeImage: "", smallImage: "" };
  let dirty = false;
  let previewStart = null;
  let toastTimer = null;

  // ---------------------------------------------------------------- helpers

  const pad = (value) => String(value).padStart(2, "0");

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

  function timeAgo(iso) {
    if (!iso) return "never";
    const delta = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(delta)) return "—";
    if (delta < 45_000) return "just now";
    if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
    if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
    return `${Math.round(delta / 86_400_000)}d ago`;
  }

  function toast(message, isError = false) {
    const el = $("#toast");
    el.textContent = message;
    el.className = `toast is-visible${isError ? " is-error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = "toast";
    }, 3200);
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
      /* non-JSON */
    }
    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status})`);
      error.details = data?.errors || [];
      throw error;
    }
    return data || {};
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => false
      );
    }
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return Promise.resolve(ok);
  }

  // ------------------------------------------------------------------- tabs

  function showTab(name) {
    for (const tab of $$(".tab")) tab.classList.toggle("is-active", tab.dataset.tab === name);
    for (const pane of $$(".pane")) pane.classList.toggle("is-active", pane.dataset.pane === name);
    if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  }

  for (const tab of $$(".tab")) tab.addEventListener("click", () => showTab(tab.dataset.tab));
  for (const link of $$("[data-goto]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showTab(link.dataset.goto);
    });
  }
  if (location.hash.length > 1) showTab(location.hash.slice(1));

  // ---------------------------------------------------------------- preview

  function imageUrl(value) {
    if (!value) return "";
    if (value.startsWith("asset:")) {
      const asset = state?.assets?.find((item) => item.id === value.slice(6));
      return asset ? asset.url : "";
    }
    if (/^https?:\/\//.test(value)) return value;
    return appId ? `https://cdn.discordapp.com/app-assets/${appId}/${encodeURIComponent(value)}.png` : "";
  }

  function renderPreview(config) {
    const type = Number(config.type) || 0;
    const custom = type === 4;
    const name = String(config.name || "").trim();

    $("#preview-type").textContent = custom ? "" : TYPE_LABELS[type] || "";
    $("#preview-name").textContent = name || "Your activity";
    $("#preview-details").textContent = custom ? "" : config.details || "";
    $("#preview-state").textContent = custom ? "" : config.state || "";

    const large = custom ? "" : imageUrl(config.largeImage ?? draft.largeImage);
    const small = custom ? "" : imageUrl(config.smallImage ?? draft.smallImage);
    const largeEl = $("#preview-large");
    const fallback = $("#preview-fallback");
    if (large) {
      largeEl.src = large;
      largeEl.hidden = false;
      fallback.hidden = true;
    } else {
      largeEl.hidden = true;
      largeEl.removeAttribute("src");
      fallback.hidden = false;
    }
    $("#preview-small-wrap").hidden = !small;
    if (small) $("#preview-small").src = small;

    previewStart = config.startedAt ? Number(config.startTimestamp) || Date.now() : null;
    tickTimer();

    const buttons = $("#preview-buttons");
    buttons.textContent = "";
    for (const button of Array.isArray(config.buttons) ? config.buttons.slice(0, 2) : []) {
      const chip = document.createElement("span");
      chip.className = "preview-button";
      chip.textContent = button.label;
      buttons.append(chip);
    }
    renderTargetHint(config);
    syncSlotImages();
  }

  function renderTargetHint(config) {
    const targets = config.targets || { bot: true, companion: true };
    const hint = $("#target-hint");
    const parts = [];
    if (targets.bot) parts.push("the bot card (text only, 24/7)");
    if (targets.companion) parts.push("your profile via the companion (photos + buttons)");
    hint.textContent = `Showing on ${parts.join(" and ") || "nothing yet"}.`;
  }

  function tickTimer() {
    $("#preview-time").textContent = previewStart ? `${formatDuration(Date.now() - previewStart)} elapsed` : "";
  }

  // -------------------------------------------------------------- form sync

  function readForm() {
    const buttons = [];
    for (let index = 1; index <= 2; index += 1) {
      const label = field(`btn${index}Label`).value.trim();
      const url = field(`btn${index}Url`).value.trim();
      if (label && url) buttons.push({ label, url });
    }
    return {
      enabled: true,
      name: field("name").value,
      type: Number(field("type").value),
      status: field("status").value,
      details: field("details").value,
      state: field("state").value,
      url: field("url").value,
      largeImage: draft.largeImage,
      smallImage: draft.smallImage,
      largeText: field("largeText").value,
      smallText: field("smallText").value,
      startedAt: field("startedAt").checked,
      restartTimer: field("restartTimer").checked,
      buttons,
      targets: {
        bot: field("targetBot").checked,
        companion: field("targetCompanion").checked
      }
    };
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
    set("largeText", presence.largeText);
    set("smallText", presence.smallText);
    draft.largeImage = presence.largeImage || "";
    draft.smallImage = presence.smallImage || "";

    const buttons = Array.isArray(presence.buttons) ? presence.buttons : [];
    for (let index = 1; index <= 2; index += 1) {
      const button = buttons[index - 1];
      field(`btn${index}Label`).value = button?.label || "";
      field(`btn${index}Url`).value = button?.url || "";
    }
    field("startedAt").checked = Boolean(presence.startedAt);
    field("restartTimer").checked = false;
    field("targetBot").checked = presence.targets?.bot !== false;
    field("targetCompanion").checked = presence.targets?.companion !== false;
    updateVisibility();
  }

  function updateVisibility() {
    const type = Number(field("type").value) || 0;
    const custom = type === 4;
    for (const el of $$('[data-when="details"]', form)) el.hidden = custom;
    for (const el of $$('[data-when="timer"]', form)) el.hidden = custom;
    for (const el of $$('[data-when="advanced"]', form)) el.hidden = custom;
    for (const el of $$('[data-when="url"]', form)) el.hidden = type !== 1;
    for (const el of $$('[data-when="targets"]', form)) el.hidden = false;
    field("restartTimer").disabled = !field("startedAt").checked || custom;
  }

  function setDirty(value) {
    dirty = value;
    $("#form-note").hidden = !value;
  }

  // ------------------------------------------------------------- state sync

  function renderBot(bot) {
    const info = BOT_STATES[bot?.status] || BOT_STATES.idle;
    const pill = $("#bot-pill");
    pill.className = `pill ${info.className}`;
    $("#bot-pill-text").textContent = info.text;
    pill.title = bot?.error ? `${info.text}: ${bot.error}` : info.text;

    $("#bot-status").textContent = info.text;
    $("#bot-tag").textContent = bot?.tag || (bot?.enabled === false ? "Not configured" : "—");
    $("#bot-last").textContent = bot?.lastAppliedAt ? new Date(bot.lastAppliedAt).toLocaleString() : "—";
    $("#bot-uptime").textContent = formatUptime(bot?.uptimeSeconds);

    const errorBox = $("#bot-error");
    const message = bot?.error || (bot?.enabled === false ? bot?.note : null);
    if (message) {
      errorBox.className = bot?.error ? "alert" : "alert is-info";
      errorBox.textContent = message;
      errorBox.hidden = false;
    } else {
      errorBox.hidden = true;
    }
  }

  function renderProfilePill(pairings) {
    const active = (pairings || []).filter((pairing) => !pairing.revokedAt);
    const online = active.filter(
      (pairing) => pairing.lastSeenAt && Date.now() - new Date(pairing.lastSeenAt).getTime() < 3 * 60_000
    );
    const pill = $("#profile-pill");
    if (online.length > 0) {
      pill.className = "pill is-online";
      $("#profile-pill-text").textContent = "Profile live";
    } else if (active.length > 0) {
      pill.className = "pill is-idle";
      $("#profile-pill-text").textContent = "Profile idle";
    } else {
      pill.className = "pill is-muted";
      $("#profile-pill-text").textContent = "No companion";
    }
  }

  function renderAssets(assets) {
    const grid = $("#asset-grid");
    grid.textContent = "";
    $("#asset-empty").hidden = assets.length > 0;
    for (const asset of assets) {
      const card = document.createElement("figure");
      card.className = "asset";
      const img = document.createElement("img");
      img.src = asset.url;
      img.alt = asset.name;
      img.loading = "lazy";
      const caption = document.createElement("figcaption");
      caption.textContent = `${asset.width || "?"}×${asset.height || "?"} · ${Math.round(asset.bytes / 1024)} KB`;
      const actions = document.createElement("div");
      actions.className = "asset-actions";

      const large = document.createElement("button");
      large.className = "btn ghost small";
      large.textContent = "Large";
      large.addEventListener("click", () => setImage("large", `asset:${asset.id}`, asset.url));

      const small = document.createElement("button");
      small.className = "btn ghost small";
      small.textContent = "Small";
      small.addEventListener("click", () => setImage("small", `asset:${asset.id}`, asset.url));

      const remove = document.createElement("button");
      remove.className = "btn ghost small danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!confirm(`Delete ${asset.name}?`)) return;
        try {
          await api(`/api/assets/${asset.id}`, "DELETE");
          state.assets = state.assets.filter((item) => item.id !== asset.id);
          renderAssets(state.assets);
          toast("Image deleted");
        } catch (error) {
          toast(error.message, true);
        }
      });

      actions.append(large, small, remove);
      card.append(img, caption, actions);
      grid.append(card);
    }
  }

  function syncSlotImages() {
    for (const [slotId, key] of [
      ["#slot-large", "large"],
      ["#slot-small", "small"]
    ]) {
      const slot = $(slotId);
      if (!slot) continue;
      const img = slot.querySelector("img");
      const label = slot.querySelector("span");
      const url = imageUrl(draft[key]);
      if (url) {
        img.src = url;
        img.hidden = false;
        label.hidden = true;
      } else {
        img.hidden = true;
        img.removeAttribute("src");
        label.hidden = false;
      }
    }
  }

  function renderPairings(pairings) {
    const list = $("#pairing-list");
    list.textContent = "";
    const active = (pairings || []).filter((pairing) => !pairing.revokedAt);
    $("#pairing-empty").hidden = active.length > 0;
    for (const pairing of active) {
      const row = document.createElement("div");
      row.className = "device";

      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = pairing.label;
      const meta = document.createElement("div");
      meta.className = "hint";
      const stale = !pairing.lastSeenAt || Date.now() - new Date(pairing.lastSeenAt).getTime() > 3 * 60_000;
      meta.textContent = `${pairing.lastStatus || "not started"} · last seen ${timeAgo(pairing.lastSeenAt)}`;
      info.append(name, meta);

      const remove = document.createElement("button");
      remove.className = "btn ghost small";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        if (!confirm(`Stop syncing to ${pairing.label}?`)) return;
        await api(`/api/companion/pairings/${pairing.id}`, "DELETE").catch((error) => toast(error.message, true));
        state.pairings = state.pairings.filter((item) => item.id !== pairing.id);
        renderPairings(state.pairings);
        renderProfilePill(state.pairings);
        toast("Device removed");
      });

      row.className = `device${stale ? " is-stale" : ""}`;
      row.append(info, remove);
      list.append(row);
    }
  }

  function renderKeepAlive(keepAlive, meta, settings) {
    const tag = $("#keepalive-tag");
    if (!keepAlive || !keepAlive.enabled) {
      tag.textContent = keepAlive?.target ? "Paused" : "Off";
      tag.className = "tag";
    } else {
      tag.textContent = keepAlive.lastStatus === 200 || keepAlive.lastOkAt ? "Active" : "Waiting";
      tag.className = "tag is-live";
    }
    const info = $("#keepalive-info");
    if (keepAlive?.lastOkAt) {
      info.textContent = `Last ping ${timeAgo(keepAlive.lastOkAt)} · ${keepAlive.pings} pings`;
    } else if (keepAlive?.target) {
      info.textContent = `Will ping ${keepAlive.target}/health every ${keepAlive.intervalMinutes}m`;
    } else {
      info.textContent = "Set a public URL to enable";
    }

    if (settings) {
      const form = $("#keepalive-form");
      form.elements.publicUrl.value = settings.publicUrl || "";
      form.elements.enabled.checked = Boolean(settings.keepAlive?.enabled);
      form.elements.intervalMinutes.value = settings.keepAlive?.intervalMinutes || 10;
      form.elements.publicUrl.disabled = Boolean(settings.managed?.publicUrl);
    }

    const warning = $("#https-warning");
    warning.hidden = Boolean(meta?.publicUrlIsHttps);
  }

  function applyState(next, { fill = true } = {}) {
    state = next;
    renderBot(next.bot);
    renderProfilePill(next.pairings);
    renderAssets(next.assets || []);
    renderPairings(next.pairings || []);
    renderKeepAlive(next.keepAlive, next.meta);
    if (fill && !dirty) {
      fillForm(next.presence);
      renderPreview(next.presence);
    }
    renderPreviewNote(next.presence);
    renderUser(next.user);
    const redirect = $("#redirect-hint");
    if (redirect) redirect.textContent = `${next.meta?.publicUrl || location.origin}/auth/discord/callback`;
  }

  function renderPreviewNote(presence) {
    const note = $("#preview-note");
    if (!presence?.enabled) {
      note.textContent = "Cleared";
      note.className = "tag";
    } else if ((state?.pairings || []).some((p) => p.lastStatus === "connected")) {
      note.textContent = "Live";
      note.className = "tag is-live";
    } else if (state?.bot?.connected) {
      note.textContent = "On bot";
      note.className = "tag is-live";
    } else {
      note.textContent = "Saved";
      note.className = "tag is-warn";
    }
  }

  function renderUser(user) {
    if (!user) return;
    $("#user-name").textContent = user.name || "Signed in";
    const avatar = $("#user-avatar");
    if (user.avatar) {
      avatar.style.backgroundImage = `url("${user.avatar}")`;
      avatar.textContent = "";
    } else {
      avatar.textContent = (user.name || "?").trim().charAt(0).toUpperCase();
    }
  }

  // -------------------------------------------------------------- form logic

  form.addEventListener("input", () => {
    setDirty(true);
    renderPreview(readForm());
    updateVisibility();
  });
  form.addEventListener("change", () => {
    setDirty(true);
    renderPreview(readForm());
    updateVisibility();
  });

  function showErrors(error) {
    const box = $("#form-errors");
    const messages = Array.isArray(error?.details) && error.details.length > 1 ? error.details : [];
    box.textContent = "";
    if (messages.length > 0) {
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = readForm();
    $("#form-errors").hidden = true;

    if (!payload.name.trim()) return showErrors(new Error("Activity name is required."));
    if (payload.type === 1 && !payload.url.trim()) return showErrors(new Error("A Streaming activity needs a URL."));
    if (!payload.targets.bot && !payload.targets.companion) {
      return showErrors(new Error("Pick at least one place to show the presence."));
    }

    const button = $("#apply-btn");
    button.disabled = true;
    button.textContent = "Applying…";
    try {
      const result = await api("/api/presence", "POST", payload);
      setDirty(false);
      field("restartTimer").checked = false;
      state.presence = result.presence;
      state.bot = result.bot;
      renderPreview(result.presence);
      renderBot(result.bot);
      renderPreviewNote(result.presence);
      toast("Presence applied");
    } catch (error) {
      showErrors(error);
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Apply presence";
    }
  });

  $("#clear-btn").addEventListener("click", async () => {
    if (!confirm("Clear the presence everywhere?")) return;
    try {
      const result = await api("/api/presence/clear", "POST", {});
      setDirty(false);
      state.presence = result.presence;
      state.bot = result.bot;
      fillForm(result.presence);
      renderPreview(result.presence);
      renderBot(result.bot);
      renderPreviewNote(result.presence);
      toast("Presence cleared");
    } catch (error) {
      toast(error.message, true);
    }
  });

  // ------------------------------------------------------------------ photos

  function setImage(kind, value, url) {
    draft[kind === "large" ? "largeImage" : "smallImage"] = value;
    const el = $(`#url-${kind}`);
    if (el) el.value = /^https?:\/\//.test(value) ? value : "";
    syncSlotImages();
    setDirty(true);
    renderPreview({ ...readForm(), largeImage: draft.largeImage, smallImage: draft.smallImage });
    if (url) toast(`Set as ${kind} image — press Apply presence to publish`);
  }

  for (const slot of $$(".upload-slot")) {
    const input = slot.querySelector("input[type=file]");
    slot.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const size = slot.dataset.size === "small" ? 256 : 512;
      slot.classList.add("is-busy");
      try {
        const dataUrl = await upload.prepare(file, size);
        const result = await api("/api/assets", "POST", { dataUrl, name: file.name });
        state.assets = [result.asset, ...state.assets.filter((asset) => asset.id !== result.asset.id)];
        renderAssets(state.assets);
        setImage(slot.dataset.size, `asset:${result.asset.id}`, result.asset.url);
      } catch (error) {
        toast(error.message, true);
      } finally {
        slot.classList.remove("is-busy");
        input.value = "";
      }
    });
  }

  for (const button of $$("[data-clear-image]")) {
    button.addEventListener("click", () => setImage(button.dataset.clearImage, "", ""));
  }

  $("#use-urls").addEventListener("click", () => {
    const large = $("#url-large").value.trim();
    const small = $("#url-small").value.trim();
    for (const [kind, value] of [
      ["large", large],
      ["small", small]
    ]) {
      if (value && !/^https:\/\//.test(value)) {
        toast(`${kind} image URL must start with https://`, true);
        return;
      }
      if (value) setImage(kind, value, value);
    }
    toast("URLs set — press Apply presence");
  });

  // ----------------------------------------------------------------- profile

  $("#pair-btn").addEventListener("click", async () => {
    const button = $("#pair-btn");
    button.disabled = true;
    try {
      const label = $("#pair-label").value.trim() || "My computer";
      const result = await api("/api/companion/pairings", "POST", { label });
      $("#pair-result").hidden = false;
      $("#pair-command").value = result.command;
      $("#pair-download").href = result.scriptUrl;
      state.pairings = [...(state.pairings || []), result.pairing];
      renderPairings(state.pairings);
      renderProfilePill(state.pairings);
      toast("Computer paired — run the command to go live");
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#copy-command").addEventListener("click", async () => {
    const ok = await copyText($("#pair-command").value);
    toast(ok ? "Command copied" : "Copy failed — select the text manually", !ok);
  });

  $("#copy-invite").addEventListener("click", async () => {
    const ok = await copyText($("#invite-url").value);
    toast(ok ? "Invite link copied" : "Copy failed", !ok);
  });

  // ---------------------------------------------------------------- settings

  $("#keepalive-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      await api("/api/settings", "POST", {
        publicUrl: data.get("publicUrl"),
        keepAlive: {
          enabled: data.get("enabled") === "on",
          intervalMinutes: Number(data.get("intervalMinutes")) || 10
        }
      });
      toast("Saved");
      refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#app-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const payload = { clientId: data.get("clientId") };
    const token = String(data.get("botToken") || "").trim();
    if (token) payload.botToken = token;
    try {
      await api("/api/settings", "POST", payload);
      event.target.reset();
      toast(token ? "Bot token saved — reconnecting" : "Saved");
      refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#sso-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const payload = { allowedIds: String(data.get("allowedIds") || "").split(/[\s,]+/).filter(Boolean) };
    const secret = String(data.get("clientSecret") || "").trim();
    if (secret) payload.clientSecret = secret;
    try {
      await api("/api/settings", "POST", payload);
      event.target.reset();
      toast("Sign-in settings saved");
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      await api("/api/settings", "POST", {
        currentAdminKey: data.get("currentAdminKey"),
        newAdminKey: data.get("newAdminKey")
      });
      event.target.reset();
      toast("Dashboard key changed");
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#rerun-setup")?.addEventListener("click", () => {
    location.href = "/setup";
  });

  // ------------------------------------------------------------------- boot

  async function refresh() {
    try {
      const next = await api("/api/state");
      applyState(next, { fill: !dirty });
      const settings = await api("/api/settings");
      renderKeepAlive(next.keepAlive, next.meta, settings.settings);
      $("#app-form").elements.clientId.value = settings.settings.discord.clientId || "";
      $("#bot-token-hint").textContent = settings.settings.discord.hasBotToken
        ? `Current token ${settings.settings.discord.botTokenPreview}`
        : "No bot token saved yet";
      $("#sso-form").elements.allowedIds.value = (settings.settings.discord.allowedIds || []).join(", ");
      return next;
    } catch (error) {
      toast(error.message || "Could not load the dashboard", true);
      return null;
    }
  }

  let failures = 0;
  let poller = null;

  function startPolling() {
    if (poller) return;
    poller = setInterval(() => void refresh(), 20_000);
  }

  function connectEvents() {
    if (typeof EventSource === "undefined") return startPolling();
    const source = new EventSource("/api/events");
    source.addEventListener("state", (event) => {
      failures = 0;
      try {
        const message = JSON.parse(event.data);
        if (message?.data) applyState(message.data, { fill: !dirty });
      } catch {
        /* ignore */
      }
    });
    source.addEventListener("error", () => {
      failures += 1;
      if (failures >= 3) {
        source.close();
        startPolling();
      }
    });
  }

  void (async () => {
    await refresh();
    connectEvents();
    setInterval(tickTimer, 1000);
    setInterval(() => {
      renderProfilePill(state?.pairings);
      renderPairings(state?.pairings);
    }, 30_000);
  })();

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return undefined;
    event.preventDefault();
    event.returnValue = "";
    return "";
  });
})();
