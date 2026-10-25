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

  /**
   * True when the caret is in a field of this form. State updates must never
   * overwrite text somebody is in the middle of typing.
   */
  function typingIn(form) {
    const active = document.activeElement;
    if (!form || !active || !form.contains(active)) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && active.type !== "submit";
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
    for (const tab of $$(".tab")) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const pane of $$(".pane")) pane.classList.toggle("is-active", pane.dataset.pane === name);
    if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  }

  const isAdmin = document.body.dataset.role === "admin";
  // Panes only the owner may open; a member typing `#settings` must not land there.
  const ADMIN_PANES = new Set(["bot", "members", "settings"]);
  const allowed = (name) => Boolean(name) && (isAdmin || !ADMIN_PANES.has(name));

  for (const tab of $$(".tab")) {
    tab.addEventListener("click", () => showTab(allowed(tab.dataset.tab) ? tab.dataset.tab : "profile"));
  }
  // `/?tab=profile` is where the setup wizard drops you, and it is linkable.
  const tabParam = new URLSearchParams(location.search).get("tab");
  for (const link of $$("[data-goto]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showTab(allowed(link.dataset.goto) ? link.dataset.goto : "profile");
    });
  }
  if (tabParam) {
    const name = allowed(tabParam) ? tabParam : "profile";
    showTab(name);
    history.replaceState(null, "", `${location.pathname}#${name}`);
  } else if (location.hash.length > 1) {
    showTab(allowed(location.hash.slice(1)) ? location.hash.slice(1) : "profile");
  }

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
    const targets = config.targets || { bot: true, profile: true };
    const hint = $("#target-hint");
    const parts = [];
    if (targets.bot) parts.push("the bot card (text only, 24/7)");
    if (targets.profile) parts.push("your profile (photos + buttons)");
    hint.textContent = `Showing on ${parts.join(" and ") || "nothing yet"}.`;
  }

  function tickTimer() {
    $("#preview-time").textContent = previewStart ? `${formatDuration(Date.now() - previewStart)} elapsed` : "";
  }

  // ------------------------------------------------------- templates & chrome

  let draftTimer = null;
  let draftSavedAt = null;
  let pendingSave = false;

  /** Presets come from the server, so the list has one definition. */
  function renderTemplates(templates) {
    const row = $("#template-row");
    const chips = $("#template-chips");
    if (!row || !chips) return;
    // State arrives over SSE too; rebuilding the same chips would only steal
    // focus and flicker, so redraw when the list actually changes.
    const signature = Array.isArray(templates)
      ? templates.map((template) => `${template.id}:${template.name}`).join("|")
      : "";
    if (chips.dataset.signature === signature) return;
    chips.dataset.signature = signature;
    chips.textContent = "";
    if (!Array.isArray(templates) || templates.length === 0) {
      row.hidden = true;
      return;
    }
    for (const template of templates) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "template-chip";
      chip.dataset.templateId = template.id;
      chip.innerHTML = "";
      const dot = document.createElement("span");
      dot.className = "template-dot";
      dot.style.background = template.accent || "var(--accent)";
      const label = document.createElement("strong");
      label.textContent = template.name;
      const blurb = document.createElement("small");
      blurb.textContent = template.blurb;
      chip.append(dot, label, blurb);
      chip.addEventListener("click", async () => {
        try {
          const result = await api(`/api/templates/${encodeURIComponent(template.id)}`, "POST", {});
          fillForm(result.presence);
          renderPreview(result.presence);
          markEdited();
          toast(`“${template.name}” applied — publish when you like it`);
        } catch (error) {
          toast(error.message, true);
        }
      });
      chips.append(chip);
    }
    row.hidden = false;
  }

  /**
   * Preview fidelity: Discord has a light theme and a compact card, and the
   * card looks wrong if you only ever check one of them.
   */
  function applyPreviewAppearance() {
    const preview = $("#preview");
    if (!preview) return;
    const theme = localStorage.getItem("statusc0rd.previewTheme") === "light" ? "light" : "dark";
    const compact = localStorage.getItem("statusc0rd.previewDensity") === "compact";
    preview.classList.toggle("is-light", theme === "light");
    preview.classList.toggle("is-compact", compact);
    for (const button of $$("[data-preview-theme]")) {
      button.classList.toggle("is-active", button.dataset.previewTheme === theme);
      button.setAttribute("aria-pressed", button.dataset.previewTheme === theme ? "true" : "false");
    }
    const density = $("#preview-density");
    if (density) {
      density.textContent = compact ? "Full" : "Compact";
      density.setAttribute("aria-pressed", compact ? "true" : "false");
    }
  }

  for (const button of $$("[data-preview-theme]")) {
    button.addEventListener("click", () => {
      localStorage.setItem("statusc0rd.previewTheme", button.dataset.previewTheme);
      applyPreviewAppearance();
    });
  }

  $("#preview-density")?.addEventListener("click", () => {
    const compact = localStorage.getItem("statusc0rd.previewDensity") === "compact";
    localStorage.setItem("statusc0rd.previewDensity", compact ? "full" : "compact");
    applyPreviewAppearance();
  });

  applyPreviewAppearance();

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
        profile: field("targetProfile").checked
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
    field("targetProfile").checked = presence.targets?.profile !== false;
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
    $("#form-note").textContent = "Unpublished changes";
    $("#discard-btn").hidden = !value && !draftSavedAt;
  }

  /** Everything the editor changes funnels through here: mark dirty, autosave. */
  function markEdited() {
    setDirty(true);
    scheduleDraftSave();
  }

  function setDraftHint(text, kind = "") {
    const hint = $("#draft-hint");
    if (!hint) return;
    hint.hidden = !text;
    hint.textContent = text || "";
    hint.className = `hint${kind ? ` is-${kind}` : ""}`;
  }

  /**
   * Draft = "staged but not live". Discord keeps showing the published card
   * until the person presses Publish, so a half-typed line never leaks onto
   * their profile.
   */
  function scheduleDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    pendingSave = true;
    draftTimer = setTimeout(() => void saveDraft(), 1200);
  }

  async function saveDraft() {
    const payload = readForm();
    if (!String(payload.name || "").trim()) {
      setDraftHint("Give it a name and this saves itself as a draft.");
      return;
    }
    try {
      const result = await api("/api/presence/draft", "POST", payload);
      draftSavedAt = result.draft?.savedAt || new Date().toISOString();
      if (state) state.draft = result.draft;
      setDraftHint(`Draft saved ${timeAgo(draftSavedAt)} — not live until you publish.`);
      $("#discard-btn").hidden = false;
    } catch (error) {
      if (error.details?.length) {
        // Validation problems are the person's business only when publishing.
        setDraftHint(error.details[0]);
      }
    } finally {
      pendingSave = false;
    }
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

  function activityIsLive(session) {
    return Boolean(
      session?.lastSeenAt && Date.now() - new Date(session.lastSeenAt).getTime() < 2 * 60_000 && session.connected
    );
  }

  /** The top-bar profile pill: is the in-Discord app pushing this card? */
  function renderProfilePill() {
    const pill = $("#profile-pill");
    const live = activityIsLive(state?.activitySession);
    pill.className = live ? "pill is-online" : "pill is-muted";
    $("#profile-pill-text").textContent = live ? "Profile live (Discord)" : "Profile not live";
  }

  /** The in-Discord app card: launch link, live status and the one-time setup. */
  function renderActivity(meta, session) {
    const link = $("#activity-link");
    const warning = $("#activity-warning");
    const mapping = $("#activity-mapping");
    const status = $("#activity-status");
    const tag = $("#activity-tag");
    if (!link) return;

    const publicUrl = (meta?.publicUrl || location.origin).replace(/\/+$/, "");
    const appId = meta?.clientId || "";
    const ready = Boolean(appId && meta?.hasClientSecret);

    if (appId) {
      link.href = `https://discord.com/activities/${encodeURIComponent(appId)}`;
      link.removeAttribute("aria-disabled");
      link.classList.remove("is-disabled");
    } else {
      link.href = "#";
      link.setAttribute("aria-disabled", "true");
      link.classList.add("is-disabled");
    }

    if (warning) warning.hidden = ready;
    if (mapping) mapping.textContent = `${publicUrl}/activity/`;

    // Whose card is this? The in-Discord app matches the Discord account that
    // opened it to an account here, so an unlinked member gets a plain
    // instruction instead of a silent failure inside Discord.
    const linkRow = $("#discord-link-row");
    if (linkRow) {
      const linked = Boolean(meta?.linkedDiscord);
      const statusEl = $("#discord-link-status");
      const button = $("#discord-link-btn");
      if (statusEl) {
        statusEl.textContent = linked
          ? "Connected. The in-Discord app will push this card onto your Discord profile."
          : "Not connected yet — link your Discord account so the app knows this card is yours.";
        statusEl.className = linked ? "hint is-live" : "hint";
      }
      if (button) {
        button.hidden = linked;
        button.href = "/auth/discord/link";
      }
    }

    const live = activityIsLive(session);
    if (tag) {
      tag.textContent = live ? "Live now" : "In Discord";
      tag.className = live ? "tag is-live" : "tag";
    }

    if (!status) return;
    if (live) {
      const when = new Date(session.lastSeenAt);
      status.textContent = `Live on ${session.username || "your profile"} — last update ${when.toLocaleTimeString()}.`;
      status.className = "hint is-live";
    } else if (session?.lastSeenAt) {
      status.textContent = `Last seen ${new Date(session.lastSeenAt).toLocaleString()}. Launch the app again to bring it back.`;
      status.className = "hint";
    } else {
      status.textContent = "Not connected yet — press “Open in Discord” and leave the window open.";
      status.className = "hint";
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
          // If this image was staged in the editor, drop the dangling reference.
          const ref = `asset:${asset.id}`;
          let cleared = false;
          for (const key of ["largeImage", "smallImage"]) {
            if (draft[key] === ref) {
              draft[key] = "";
              cleared = true;
            }
          }
          renderAssets(state.assets);
          if (cleared) {
            syncSlotImages();
            renderPreview(readForm());
            setDirty(true);
          }
          toast(cleared ? "Image deleted — pick another one, then publish" : "Image deleted");
        } catch (error) {
          toast(error.message, true);
        }
      });

      actions.append(large, small, remove);
      card.append(img, caption, actions);
      grid.append(card);
    }
    renderPickerAssets(assets);
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
      if (!typingIn(form)) {
        form.elements.publicUrl.value = settings.publicUrl || "";
        form.elements.enabled.checked = Boolean(settings.keepAlive?.enabled);
        form.elements.intervalMinutes.value = settings.keepAlive?.intervalMinutes || 10;
      }
      form.elements.publicUrl.disabled = Boolean(settings.managed?.publicUrl);
    }

    const warning = $("#https-warning");
    warning.hidden = Boolean(meta?.publicUrlIsHttps);
  }

  function applyState(next, { fill = true } = {}) {
    state = next;
    renderActivity(next.meta, next.activitySession);
    renderBot(next.bot);
    renderProfilePill();
    renderAssets(next.assets || []);
    renderKeepAlive(next.keepAlive, next.meta);
    if (fill && !dirty) {
      // A staged draft is what the person was last editing, on any device.
      const source = next.draft || next.presence;
      fillForm(source);
      renderPreview(source);
      draftSavedAt = next.draft?.savedAt || null;
      if (next.draft) {
        setDirty(true);
        setDraftHint(`Draft from ${timeAgo(next.draft.savedAt)} — publish to put it on your profile.`);
      } else {
        setDirty(false);
        setDraftHint("");
      }
    }
    renderTemplates(next.templates);
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
    } else if (activityIsLive(state?.activitySession)) {
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

  for (const input of $$("input, select, textarea", form)) {
    input.addEventListener("input", () => {
      updateVisibility();
      renderPreview(readForm());
      markEdited();
    });
    input.addEventListener("change", () => {
      updateVisibility();
      renderPreview(readForm());
      markEdited();
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // Publishing pushes the form as it stands; the server also accepts the
    // stored draft when the body is empty (see POST /api/presence/publish).
    const payload = readForm();
    $("#form-errors").hidden = true;

    if (!payload.name.trim()) return showErrors(new Error("Activity name is required."));
    if (payload.type === 1 && !payload.url.trim()) return showErrors(new Error("A Streaming activity needs a URL."));
    if (!payload.targets.bot && !payload.targets.profile) {
      return showErrors(new Error("Pick at least one place to show the presence."));
    }

    const button = $("#apply-btn");
    button.disabled = true;
    button.textContent = "Publishing…";
    try {
      // Cancel any queued autosave: it would immediately recreate the draft we
      // are about to publish.
      if (draftTimer) {
        clearTimeout(draftTimer);
        draftTimer = null;
      }
      pendingSave = false;
      const result = await api("/api/presence/publish", "POST", payload);
      setDirty(false);
      draftSavedAt = null;
      if (state) state.draft = null;
      setDraftHint("Published — this is what Discord shows now.");
      $("#discard-btn").hidden = true;
      field("restartTimer").checked = false;
      state.presence = result.presence;
      state.bot = result.bot;
      renderPreview(result.presence);
      renderBot(result.bot);
      renderPreviewNote(result.presence);
      toast("Published");
    } catch (error) {
      showErrors(error);
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Publish";
    }
  });

  $("#discard-btn").addEventListener("click", async () => {
    try {
      if (draftTimer) {
        clearTimeout(draftTimer);
        draftTimer = null;
      }
      pendingSave = false;
      await api("/api/presence/draft", "DELETE");
      state.draft = null;
      draftSavedAt = null;
      fillForm(state.presence);
      renderPreview(state.presence);
      setDirty(false);
      setDraftHint("Draft discarded — back to what is live.");
      $("#discard-btn").hidden = true;
      toast("Draft discarded");
    } catch (error) {
      toast(error.message, true);
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
    markEdited();
    renderPreview({ ...readForm(), largeImage: draft.largeImage, smallImage: draft.smallImage });
    if (url) toast(`Set as ${kind} image — publish to show it`);
  }

  /** Upload one file into a slot: resize, POST, stage it. */
  async function uploadToSlot(slot, file) {
    if (!slot || !file) return;
    const size = slot.dataset.size === "small" ? 256 : 512;
    slot.classList.add("is-busy");
    try {
      const dataUrl = await upload.prepare(file, size);
      const result = await api("/api/assets", "POST", { dataUrl, name: file.name });
      state.assets = [result.asset, ...state.assets.filter((asset) => asset.id !== result.asset.id)];
      renderAssets(state.assets);
      renderPickerAssets(state.assets);
      setImage(slot.dataset.size, `asset:${result.asset.id}`, result.asset.url);
    } catch (error) {
      toast(error.message, true);
    } finally {
      slot.classList.remove("is-busy");
    }
  }

  let activeSlot = null;

  for (const slot of $$(".upload-slot")) {
    const input = slot.querySelector("input[type=file]");
    const open = () => input.click();
    slot.addEventListener("click", (event) => {
      // The synthetic click on the hidden input bubbles back up here; ignoring it
      // stops the file picker from being requested twice.
      if (event.target === input) return;
      open();
    });
    slot.addEventListener("focus", () => {
      activeSlot = slot;
    });
    slot.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });

    // Drag and drop
    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      slot.classList.add("is-drop");
    });
    slot.addEventListener("dragleave", () => slot.classList.remove("is-drop"));
    slot.addEventListener("drop", async (event) => {
      event.preventDefault();
      slot.classList.remove("is-drop");
      const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/"));
      if (!file) return toast("Drop an image file (PNG, JPEG, WebP or GIF).", true);
      activeSlot = slot;
      await uploadToSlot(slot, file);
    });

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      activeSlot = slot;
      await uploadToSlot(slot, file);
      input.value = "";
    });
  }

  // Paste a screenshot straight in: ctrl/cmd+V anywhere on the dashboard goes to
  // the slot you last touched (the large image by default).
  document.addEventListener("paste", async (event) => {
    const items = [...(event.clipboardData?.items || [])];
    const item = items.find((entry) => entry.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    event.preventDefault();
    const slot = activeSlot || $("#slot-large");
    if (slot) slot.focus();
    await uploadToSlot(slot, file);
  });

  // Reuse picker: the same library, without leaving the editor.
  function renderPickerAssets(assets) {
    const grid = $("#picker-grid");
    if (!grid) return;
    grid.textContent = "";
    const list = Array.isArray(assets) ? assets : [];
    $("#picker-empty").hidden = list.length > 0;
    for (const asset of list) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "picker-item";
      const img = document.createElement("img");
      img.src = asset.url;
      img.alt = asset.name;
      img.loading = "lazy";
      button.append(img);
      button.addEventListener("click", () => {
        setImage(pickerTarget, `asset:${asset.id}`, asset.url);
        $("#asset-picker")?.close();
      });
      grid.append(button);
    }
  }

  let pickerTarget = "large";

  for (const button of $$("[data-pick-asset]")) {
    button.addEventListener("click", () => {
      pickerTarget = button.dataset.pickAsset;
      renderPickerAssets(state?.assets || []);
      const dialog = $("#asset-picker");
      if (dialog?.showModal) dialog.showModal();
      else toast("Upload an image first", true);
    });
  }

  $("#picker-close")?.addEventListener("click", () => $("#asset-picker")?.close());

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
    toast("URLs applied — press Publish to go live");
  });

  // ----------------------------------------------------------------- profile

  // With no application id there is no invite link to give out: hide the empty
  // input instead of handing over a discord.com URL that only errors.
  const inviteValue = $("#invite-url").value.trim();
  if (!inviteValue) {
    $("#invite-field").hidden = true;
    $("#invite-hint").hidden = false;
  }

  $("#copy-invite").addEventListener("click", async () => {
    if (!inviteValue) {
      toast("Add your application id first", true);
      return;
    }
    const ok = await copyText(inviteValue);
    toast(ok ? "Invite link copied" : "Copy failed", !ok);
  });

  $("#copy-activity")?.addEventListener("click", async () => {
    const href = $("#activity-link")?.href;
    if (!href || href.endsWith("#")) {
      toast("Add your application id first", true);
      return;
    }
    const ok = await copyText(href);
    toast(ok ? "Activity link copied" : "Copy failed", !ok);
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
      // Only the secret goes: a full reset() would blank the id the server keeps.
      event.target.elements.botToken.value = "";
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
      event.target.elements.clientSecret.value = "";
      toast("Sign-in settings saved");
      refresh();
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

  // ------------------------------------------------------------------- boot

  async function refresh() {
    try {
      const next = await api("/api/state");
      applyState(next, { fill: !dirty });
      // The settings forms are the owner's; a member must not ask for them
      // (the server answers 403, which would surface as a red toast).
      if (isAdmin) {
        const { settings } = await api("/api/settings");
        renderKeepAlive(next.keepAlive, next.meta, settings);
        const appForm = $("#app-form");
        if (!typingIn(appForm)) appForm.elements.clientId.value = settings.discord.clientId || "";
        $("#bot-token-hint").textContent = settings.discord.hasBotToken
          ? `Current token ${settings.discord.botTokenPreview}`
          : "No bot token saved yet";
        const ssoForm = $("#sso-form");
        if (!typingIn(ssoForm)) {
          ssoForm.elements.allowedIds.value = (settings.discord.allowedIds || []).join(", ");
        }
      }
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

  // ----------------------------------------------------------------- members

  /**
   * The Members tab is the owner's only surface for accounts: nobody can be
   * emailed an invite in this build, so accounts are made here (or at /register
   * while sign-ups are open) and passwords are handed over out of band.
   */
  const membersPane = $("#pane-members");

  function renderMembers(data) {
    const list = $("#members-list");
    const empty = $("#members-empty");
    if (!list) return;
    const users = data?.users || [];
    list.innerHTML = "";
    if (empty) empty.hidden = users.length > 0;

    const count = $("#members-count");
    if (count) count.textContent = String(users.length);

    for (const user of users) {
      const row = document.createElement("div");
      row.className = "member-row";

      const main = document.createElement("div");
      main.className = "member-main";
      const name = document.createElement("div");
      name.className = "member-name";
      name.textContent = user.name || user.email;
      const meta = document.createElement("div");
      meta.className = "member-meta";
      const bits = [user.email];
      if (user.linked) bits.push("Discord linked");
      else bits.push("no Discord yet");
      bits.push(user.presenceName ? `card: ${user.presenceName}` : "no card");
      if (user.photos) bits.push(`${user.photos} photo${user.photos === 1 ? "" : "s"}`);
      bits.push(`added ${timeAgo(user.createdAt)}`);
      meta.textContent = bits.join(" · ");
      meta.title = meta.textContent;
      main.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "member-actions";

      const reset = document.createElement("button");
      reset.className = "btn ghost small";
      reset.type = "button";
      reset.textContent = "Reset password";
      reset.addEventListener("click", async () => {
        const password = window.prompt(
          `New password for ${user.email}\nAt least 10 characters. Send it to them yourself.`
        );
        if (!password) return;
        try {
          await api(`/api/admin/users/${encodeURIComponent(user.id)}/password`, "POST", { password });
          toast("Password changed. Pass it on to them.");
        } catch (error) {
          toast(error.message, true);
        }
      });

      const unlink = document.createElement("button");
      unlink.className = "btn ghost small";
      unlink.type = "button";
      unlink.textContent = user.linked ? "Unlink Discord" : "Unlink";
      unlink.disabled = !user.linked;
      unlink.addEventListener("click", async () => {
        if (!window.confirm(`Disconnect ${user.email} from their Discord account?`)) return;
        try {
          await api(`/api/admin/users/${encodeURIComponent(user.id)}/unlink`, "POST", {});
          toast("Discord account unlinked.");
          await loadMembers();
        } catch (error) {
          toast(error.message, true);
        }
      });

      const remove = document.createElement("button");
      remove.className = "btn ghost small danger";
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        const ok = window.confirm(
          `Delete ${user.email}?\nTheir card and photos go with it. This cannot be undone.`
        );
        if (!ok) return;
        try {
          await api(`/api/admin/users/${encodeURIComponent(user.id)}`, "DELETE");
          toast("Account removed.");
          await loadMembers();
        } catch (error) {
          toast(error.message, true);
        }
      });

      actions.append(reset, unlink, remove);
      row.append(main, actions);
      list.append(row);
    }
  }

  async function loadMembers() {
    if (!isAdmin || !membersPane) return;
    try {
      renderMembers(await api("/api/admin/users"));
    } catch (error) {
      toast(error.message, true);
    }
  }

  if (isAdmin && membersPane) {
    const toggle = $("#allow-signup");
    toggle?.addEventListener("change", async () => {
      try {
        await api("/api/settings", "POST", { allowSignup: toggle.checked });
        toast(toggle.checked ? "Anyone with the link can sign up." : "Sign-ups closed.");
      } catch (error) {
        toggle.checked = !toggle.checked;
        toast(error.message, true);
      }
    });

    $("#member-create")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formEl = event.currentTarget;
      const email = formEl.elements.namedItem("email").value.trim();
      const name = formEl.elements.namedItem("name").value.trim();
      const password = formEl.elements.namedItem("password").value;
      try {
        await api("/api/admin/users", "POST", { email, name, password });
        formEl.reset();
        toast("Account created. Send them the password.");
        await loadMembers();
      } catch (error) {
        toast(error.message, true);
      }
    });

    // Refetched on focus so a new sign-up shows up without a reload.
    $('.tab[data-tab="members"]')?.addEventListener("click", () => void loadMembers());
    void loadMembers();
  }

  // The OAuth link round-trip drops its answer in the query string.
  const linkResult = new URLSearchParams(location.search).get("link");
  if (linkResult) {
    const LINK_MESSAGES = {
      ok: "Discord connected. Open the app in Discord and this card goes live.",
      taken: "That Discord account is already linked to another StatusC0rd account.",
      failed: "Discord could not be connected. Try again in a moment.",
      unconfigured: "The owner has not added a Discord application ID and secret yet.",
      cancelled: "Discord linking was cancelled."
    };
    toast(LINK_MESSAGES[linkResult] || "Discord linking finished.", linkResult !== "ok");
    history.replaceState(null, "", `${location.pathname}${location.hash}`);
  }

  void (async () => {
    await refresh();
    connectEvents();
    setInterval(tickTimer, 1000);
    // The session's last-seen time ages out, so the pill needs a nudge.
    setInterval(renderProfilePill, 30_000);
  })();

  window.addEventListener("beforeunload", (event) => {
    // Drafts autosave, so only an in-flight save is worth a prompt.
    if (!pendingSave) return undefined;
    event.preventDefault();
    event.returnValue = "";
    return "";
  });
})();
