/* StatusC0rd dashboard — one page, vanilla JS, no build step. */
(function () {
  "use strict";

  var TYPES = { 0: "PLAYING A GAME", 1: "STREAMING", 2: "LISTENING TO", 3: "WATCHING", 4: "CUSTOM STATUS", 5: "COMPETING IN" };
  var IDS = ["pill-bot", "pill-bot-text", "pill-activity", "pill-activity-text", "logout", "f-name", "f-type", "f-details", "f-state", "row-url", "f-url", "pick-large", "thumb-large", "fallback-large", "pick-small", "thumb-small", "fallback-small", "f-large-text", "f-small-text", "btn-rows", "add-button", "f-timer", "row-restart", "f-restart", "f-enabled", "save", "save-note", "errors", "photo-input", "upload", "photo-grid", "discord-user", "activity-status", "publish-card", "card-link", "copy-link", "open-card", "s-site-name", "s-keepalive", "s-interval", "s-client-id", "s-client-secret", "s-bot-token", "save-settings", "pv-large", "pv-fallback", "pv-small-wrap", "pv-small", "pv-type", "pv-name", "pv-details", "pv-state", "pv-time", "pv-buttons", "picker", "picker-close", "picker-grid", "picker-empty", "sdk-connect", "sdk-status", "pill-sdk", "pill-sdk-text", "toast"];
  var el = {};
  IDS.forEach(function (id) { el[id] = document.getElementById(id); });

  var state = null;
  var draft = null;
  var csrf = "";
  var previewStart = null;
  var pickerSlot = null;
  var slotTarget = null;
  var pollTimer = null;

  function $(id) { return el[id]; }

  function toast(message) {
    var t = $("toast");
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function updateCounts() {
    document.querySelectorAll(".count[data-for]").forEach(function (badge) {
      var input = document.getElementById(badge.dataset.for);
      if (input) badge.textContent = String(input.value.length) + "/" + (badge.dataset.max || "128");
    });
  }

  function node(id) { return document.getElementById(id); }

  var STATUS_BUTTONS = ["online", "idle", "dnd", "invisible"];

  function selectStatus(value) {
    var wanted = STATUS_BUTTONS.indexOf(value) >= 0 ? value : "online";
    if (draft) draft.status = wanted;
    document.querySelectorAll("#status-row .status-btn").forEach(function (button) {
      button.classList.toggle("selected", button.dataset.status === wanted);
    });
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ "content-type": "application/json" }, options.headers || {});
    if (csrf) options.headers["x-csrf"] = csrf;
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 401) { location.href = "/"; throw new Error("signed out"); }
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  /* ---------- images ---------- */

  function assetUrl(value) {
    var text = String(value || "");
    var match = /^asset:([a-f0-9]+)$/.exec(text);
    if (match) {
      var asset = (state && state.assets || []).filter(function (a) { return a.id === match[1]; })[0];
      return asset ? asset.url : "";
    }
    return /^https?:\/\//i.test(text) ? text : "";
  }

  /* ---------- preview ---------- */

  function drawElapsed() {
    var t = $("pv-time");
    if (!previewStart) { t.textContent = ""; return; }
    var seconds = Math.max(0, Math.floor((Date.now() - previewStart) / 1000));
    var pad = function (v) { return String(v).padStart(2, "0"); };
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    t.textContent = (h > 0 ? h + ":" + pad(m) : pad(m)) + ":" + pad(s) + " elapsed";
  }

  function renderPreview() {
    if (!draft) return;
    var type = Number(draft.type) || 0;
    $("pv-type").textContent = TYPES[type] || "PLAYING";
    $("pv-name").textContent = draft.name || "Editing details...";
    $("pv-details").textContent = type === 4 ? "" : (draft.details || "");
    $("pv-state").textContent = type === 4 ? (draft.name || "") : (draft.state || "");

    var large = assetUrl(draft.largeImage);
    var small = assetUrl(draft.smallImage);
    if (large) { $("pv-large").src = large; $("pv-large").hidden = false; $("pv-fallback").hidden = true; }
    else { $("pv-large").hidden = true; $("pv-large").removeAttribute("src"); $("pv-fallback").hidden = false; }
    if (small) { $("pv-small").src = small; $("pv-small-wrap").hidden = false; }
    else { $("pv-small-wrap").hidden = true; }

    var box = $("pv-buttons");
    box.textContent = "";
    (draft.buttons || []).forEach(function (b) {
      if (!b.label) return;
      var chip = document.createElement("span");
      chip.textContent = b.label;
      box.appendChild(chip);
    });

    previewStart = draft.startedAt ? Number(draft.startTimestamp) > 0 ? Number(draft.startTimestamp) : (previewStart || Date.now()) : null;
    drawElapsed();
  }

  /* ---------- form ---------- */

  function renderImageSlots() {
    var large = assetUrl(draft.largeImage);
    var small = assetUrl(draft.smallImage);
    if (large) { $("thumb-large").src = large; $("thumb-large").hidden = false; $("fallback-large").hidden = true; }
    else { $("thumb-large").hidden = true; $("fallback-large").hidden = false; }
    if (small) { $("thumb-small").src = small; $("thumb-small").hidden = false; $("fallback-small").hidden = true; }
    else { $("thumb-small").hidden = true; $("fallback-small").hidden = false; }
  }

  function renderButtonRows() {
    var box = $("btn-rows");
    box.textContent = "";
    (draft.buttons || []).forEach(function (button, index) {
      var row = document.createElement("div");
      row.className = "row2 btn-row";
      var labelWrap = document.createElement("label");
      labelWrap.className = "field";
      var labelTag = document.createElement("span");
      labelTag.textContent = "Button " + (index + 1);
      var labelInput = document.createElement("input");
      labelInput.maxLength = 32;
      labelInput.placeholder = "label";
      labelInput.value = button.label || "";
      labelInput.addEventListener("input", function () { draft.buttons[index].label = labelInput.value; renderPreview(); });
      labelWrap.appendChild(labelTag);
      labelWrap.appendChild(labelInput);
      var urlWrap = document.createElement("label");
      urlWrap.className = "field";
      var urlTag = document.createElement("span");
      urlTag.textContent = "Link";
      var urlInput = document.createElement("input");
      urlInput.placeholder = "https://…";
      urlInput.value = button.url || "";
      urlInput.addEventListener("input", function () { draft.buttons[index].url = urlInput.value; renderPreview(); });
      urlWrap.appendChild(urlTag);
      urlWrap.appendChild(urlInput);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn ghost small";
      remove.textContent = "×";
      remove.title = "Remove this button";
      remove.addEventListener("click", function () { draft.buttons.splice(index, 1); renderButtonRows(); renderPreview(); });
      row.appendChild(labelWrap);
      row.appendChild(urlWrap);
      row.appendChild(remove);
      box.appendChild(row);
    });
  }

  function fillForm(p) {
    draft = clone(p);
    $("f-name").value = draft.name || "";
    $("f-type").value = String(Number(draft.type) || 0);
    selectStatus(draft.status || "online");
    $("f-details").value = draft.details || "";
    $("f-state").value = draft.state || "";
    $("f-url").value = draft.url || "";
    $("row-url").hidden = String(draft.type) !== "1";
    $("f-timer").checked = Boolean(draft.startedAt);
    $("row-restart").hidden = !draft.startedAt;
    $("f-enabled").checked = Boolean(draft.enabled);
    $("f-large-text").value = draft.largeText || "";
    $("f-small-text").value = draft.smallText || "";
    renderButtonRows();
    renderImageSlots();
    renderPreview();
    updateCounts();
  }

  function payload() {
    return {
      name: $("f-name").value,
      type: Number($("f-type").value),
      status: draft.status || "online",
      details: $("f-details").value,
      state: $("f-state").value,
      url: $("f-url").value,
      largeImage: draft.largeImage || "",
      smallImage: draft.smallImage || "",
      largeText: $("f-large-text").value,
      smallText: $("f-small-text").value,
      startedAt: $("f-timer").checked,
      restartTimer: $("f-restart").checked,
      buttons: (draft.buttons || []).filter(function (b) { return b.label || b.url; }),
      targets: { bot: Boolean(state && state.user && state.user.admin), profile: true },
      enabled: $("f-enabled").checked
    };
  }

  function showErrors(errors) {
    var box = $("errors");
    box.textContent = "";
    (errors || []).forEach(function (message) {
      var li = document.createElement("li");
      li.textContent = message;
      box.appendChild(li);
    });
    box.hidden = !errors || errors.length === 0;
  }

  /* ---------- photos ---------- */

  function renderPhotos() {
    var grid = $("photo-grid");
    grid.textContent = "";
    $("picker-empty").hidden = (state.assets || []).length > 0;
    (state.assets || []).forEach(function (asset) {
      var tile = document.createElement("div");
      tile.className = "tile";
      var img = document.createElement("img");
      img.src = asset.url;
      img.alt = "";
      img.loading = "lazy";
      var actions = document.createElement("div");
      actions.className = "tile-actions";
      [["L", "Use as large", function () { draft.largeImage = "asset:" + asset.id; renderImageSlots(); renderPreview(); }],
       ["S", "Use as small", function () { draft.smallImage = "asset:" + asset.id; renderImageSlots(); renderPreview(); }],
       ["×", "Delete", function () { removePhoto(asset.id); }]].forEach(function (entry) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost tiny";
        b.textContent = entry[0];
        b.title = entry[1];
        b.addEventListener("click", entry[2]);
        actions.appendChild(b);
      });
      tile.appendChild(img);
      tile.appendChild(actions);
      grid.appendChild(tile);
    });
  }

  function removePhoto(id) {
    api("/api/assets/" + id, { method: "DELETE" }).then(function (r) {
      if (!r.ok) { toast(r.body.error || "Could not delete that photo."); return; }
      var ref = "asset:" + id;
      if (draft.largeImage === ref) draft.largeImage = "";
      if (draft.smallImage === ref) draft.smallImage = "";
      renderImageSlots();
      renderPreview();
      refresh().then(function () { toast("Photo deleted."); });
    });
  }

  function uploadPhotos(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var done = 0;
    var failed = 0;
    var uploadedIds = [];
    Promise.all(list.map(function (file) {
      return fetch("/api/assets", {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-csrf": csrf },
        body: file
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (res.ok) { done += 1; if (body.asset && body.asset.id) uploadedIds.push(body.asset.id); }
          else { failed += 1; toast(body.error || "Upload failed."); }
        });
      }).catch(function () { failed += 1; });
    })).then(function () {
      return refresh().then(function () {
        if (slotTarget && uploadedIds.length) {
          draft[slotTarget === "large" ? "largeImage" : "smallImage"] = "asset:" + uploadedIds[0];
          renderImageSlots();
          renderPreview();
        }
        slotTarget = null;
        if (done && !failed) toast("Uploaded " + done + (done > 1 ? " photos." : " photo."));
      });
    });
  }

  /* ---------- picker ---------- */

  function openPicker(slot) {
    if (!(state.assets || []).length) { toast("Upload a photo first."); return; }
    pickerSlot = slot;
    var grid = $("picker-grid");
    grid.textContent = "";
    state.assets.forEach(function (asset) {
      var tile = document.createElement("div");
      tile.className = "tile";
      var img = document.createElement("img");
      img.src = asset.url;
      img.alt = "";
      img.loading = "lazy";
      tile.appendChild(img);
      tile.addEventListener("click", function () {
        if (pickerSlot === "large") draft.largeImage = "asset:" + asset.id;
        else draft.smallImage = "asset:" + asset.id;
        $("picker").close();
        renderImageSlots();
        renderPreview();
      });
      grid.appendChild(tile);
    });
    $("picker").showModal();
  }

  /* ---------- status ---------- */

  function timeAgo(iso) {
    var ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return "just now";
    var minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "seconds ago";
    if (minutes < 60) return minutes + " min ago";
    return Math.floor(minutes / 60) + " h ago";
  }

  function renderStatus() {
    var bot = state.bot || {};
    var botPill = $("pill-bot");
    var botText = $("pill-bot-text");
    if (!bot.enabled) { botPill.dataset.state = "off"; botText.textContent = "Bot off"; }
    else if (bot.connected) { botPill.dataset.state = "live"; botText.textContent = "Bot online"; }
    else { botPill.dataset.state = "busy"; botText.textContent = "Bot " + (bot.status || "connecting"); }

    var act = state.activity || {};
    var actPill = $("pill-activity");
    var actText = $("pill-activity-text");
    if (act.connected) { actPill.dataset.state = "live"; actText.textContent = "On your profile"; }
    else if (act.lastSeenAt) { actPill.dataset.state = "busy"; actText.textContent = "Seen " + timeAgo(act.lastSeenAt); }
    else { actPill.dataset.state = "off"; actText.textContent = "Activity idle"; }

    var soc = state.social || {};
    var socPill = node("pill-sdk");
    var socText = node("pill-sdk-text");
    if (socPill && socText) {
      if (soc.connected && soc.status === "ready") { socPill.dataset.state = "live"; socText.textContent = "Card live from server"; }
      else if (soc.connected) { socPill.dataset.state = "busy"; socText.textContent = "Discord " + (soc.status || "connecting"); }
      else if (soc.authorized) { socPill.dataset.state = "busy"; socText.textContent = "Reconnecting"; }
      else { socPill.dataset.state = "off"; socText.textContent = "Not connected"; }
    }
    var socLine = node("sdk-status");
    if (socLine) {
      var parts = [];
      if (!soc.armed) parts.push("Server presence is not armed: " + (soc.loadError || "the Discord Social SDK library is not installed on the server."));
      if (soc.authorized && soc.connected && soc.status === "ready") parts.push("Connected - your saved card is on your profile right now, pushed from the server. No Discord window needed.");
      else if (soc.authorized && soc.connected) parts.push("Discord connection: " + (soc.status || "connecting") + (soc.lastError ? " - " + soc.lastError : "") + ".");
      else if (soc.authorized) parts.push("Authorized - the server reconnects your card automatically; press Connect Discord if it stays quiet.");
      else parts.push("Press Connect Discord once: authorize, and your card stays on your profile from the server - no window, no launcher.");
      socLine.textContent = parts.join(" ");
    }
    var socBtn = node("sdk-connect");
    if (socBtn) socBtn.hidden = Boolean(soc.connected && soc.status === "ready");
    var owner = state.user || {};
    $("discord-user").textContent = "Signed in as " + (owner.username || "your Discord account") + (owner.admin ? " (admin)." : ".");
    var pvUser = document.getElementById("pv-user");
    if (pvUser) pvUser.textContent = owner.username || "you";
    var pvAvatar = document.getElementById("pv-avatar");
    var pvFallback = document.getElementById("pv-avatar-fallback");
    var pvDeco = document.getElementById("pv-deco");
    if (pvAvatar) {
      if (owner.avatarUrl) { pvAvatar.src = owner.avatarUrl; pvAvatar.hidden = false; if (pvFallback) pvFallback.hidden = true; }
      else { pvAvatar.hidden = true; pvAvatar.removeAttribute("src"); if (pvFallback) pvFallback.hidden = false; }
    }
    if (pvDeco) {
      if (owner.decorationUrl) { pvDeco.src = owner.decorationUrl; pvDeco.hidden = false; }
      else { pvDeco.hidden = true; pvDeco.removeAttribute("src"); }
    }
    var pfUser = document.getElementById("pf-user");
    if (pfUser) pfUser.textContent = owner.username || "you";
    var pfEmail = document.getElementById("pf-email");
    if (pfEmail) pfEmail.textContent = owner.email || "";
    var pfAvatar = document.getElementById("pf-avatar");
    var pfFallback = document.getElementById("pf-avatar-fallback");
    var pfDeco = document.getElementById("pf-deco");
    if (pfAvatar) {
      if (owner.avatarUrl) { pfAvatar.src = owner.avatarUrl; pfAvatar.hidden = false; if (pfFallback) pfFallback.hidden = true; }
      else { pfAvatar.hidden = true; pfAvatar.removeAttribute("src"); if (pfFallback) pfFallback.hidden = false; }
    }
    if (pfDeco) {
      if (owner.decorationUrl) { pfDeco.src = owner.decorationUrl; pfDeco.hidden = false; }
      else { pfDeco.hidden = true; pfDeco.removeAttribute("src"); }
    }
    var launchBtn = node("launch-btn");
    if (launchBtn) launchBtn.href = state.launchUrl || "#";

    var lines = [];
    if (state.social && state.social.connected && state.social.status === "ready") lines.push("Your card is live on your profile via the server connection - nothing to keep open.");
    else if (act.connected) lines.push("Your card is on your profile right now" + (act.username ? " (as " + act.username + ")" : "") + ".");
    else if (act.error) lines.push(act.error);
    else if (act.lastSeenAt) lines.push("The in-Discord app last checked in " + timeAgo(act.lastSeenAt) + ".");
    else lines.push("The in-Discord app has not checked in yet. Press Go live in Discord above, or open the App Launcher in Discord and start " + (state.siteName || "StatusC0rd") + ".");
    $("activity-status").textContent = lines.join(" ");
  }

  function renderCardPage() {
    $("publish-card").checked = Boolean(state.settings && state.settings.cardPublished);
    var base = state.publicUrl || location.origin;
    var path = state.cardPath || "/card";
    $("card-link").value = base.replace(/\/+$/, "") + path;
    $("open-card").href = path;
    var supportBtn = node("support-server");
    if (supportBtn) {
      supportBtn.href = state.supportUrl || "#";
      supportBtn.hidden = !state.supportUrl;
    }
  }

  /* ---------- boot ---------- */

  function fillSettings() {
    var s = state.settings || {};
    $("s-site-name").value = s.siteName || "";
    node("s-support-url").value = state.supportUrl || "";
    $("s-keepalive").value = s.keepAlive === false ? "off" : "on";
    $("s-interval").value = String(s.keepAliveMinutes || 10);
    $("s-client-id").value = s.clientId || "";
    $("s-client-secret").value = "";
    $("s-bot-token").value = "";
  }

  /* ---------- role ---------- */

  function devVisible() {
    try { return window.localStorage.getItem("statusc0rd-dev") === "1"; } catch (error) { return false; }
  }

  function setDevVisible(on) {
    try { window.localStorage.setItem("statusc0rd-dev", on ? "1" : "0"); } catch (error) {}
    applyRole();
  }

  function applyRole() {
    var admin = Boolean(state.user && state.user.admin);
    var dev = admin && devVisible();
    ["status-row", "status-row-label", "row-bot"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = !admin;
    });
    ["row-client-id", "pill-bot", "panel-instance"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = !dev;
    });
    var devBtn = document.getElementById("dev-toggle");
    if (devBtn) {
      devBtn.hidden = !admin;
      devBtn.textContent = dev ? "Hide developer options" : "Developer options";
    }
    var pfAdmin = document.getElementById("pf-pill-admin");
    if (pfAdmin) pfAdmin.hidden = !admin;
  }

  function refresh() {
    return api("/api/state").then(function (r) {
      if (!r.ok) { toast(r.body && r.body.error || "Could not load the dashboard."); return; }
      var hadDraft = Boolean(draft);
      state = r.body;
      csrf = state.csrf;
      applyRole();
      if (!hadDraft) {
        fillForm(state.presence);
        fillSettings();
      }
      renderPhotos();
      renderStatus();
      renderCardPage();
    });
  }

  function bind() {
    $("f-name").addEventListener("input", function () { draft.name = $("f-name").value; renderPreview(); });
    $("f-type").addEventListener("change", function () {
      draft.type = Number($("f-type").value);
      $("row-url").hidden = draft.type !== 1;
      renderPreview();
    });
    $("f-details").addEventListener("input", function () { draft.details = $("f-details").value; renderPreview(); });
    $("f-state").addEventListener("input", function () { draft.state = $("f-state").value; renderPreview(); });
    $("f-timer").addEventListener("change", function () {
      draft.startedAt = $("f-timer").checked;
      $("row-restart").hidden = !draft.startedAt;
      renderPreview();
    });
    $("f-large-text").addEventListener("input", function () { draft.largeText = $("f-large-text").value; });
    document.querySelectorAll(".count[data-for]").forEach(function (badge) {
      var input = document.getElementById(badge.dataset.for);
      if (input) input.addEventListener("input", updateCounts);
    });
    $("f-small-text").addEventListener("input", function () { draft.smallText = $("f-small-text").value; });
    $("add-button").addEventListener("click", function () {
      draft.buttons = draft.buttons || [];
      if (draft.buttons.length >= 2) { toast("Discord shows two buttons at most."); return; }
      draft.buttons.push({ label: "", url: "" });
      renderButtonRows();
    });
    $("save").addEventListener("click", function () {
      $("save-note").textContent = "Saving…";
      api("/api/presence", { method: "POST", body: JSON.stringify(payload()) }).then(function (r) {
        if (r.ok) {
          fillForm(r.body.presence);
          showErrors([]);
          $("save-note").textContent = "Live · " + new Date().toLocaleTimeString();
          refresh();
          if (window.matchMedia && window.matchMedia("(max-width: 1080px)").matches) {
            var livePreview = document.getElementById("sec-preview");
            if (livePreview) livePreview.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        } else {
          $("save-note").textContent = "";
          showErrors(r.body.errors || [r.body.error || "Could not save the card."]);
        }
      });
    });
    $("upload").addEventListener("click", function () { $("photo-input").click(); });
    $("photo-input").addEventListener("change", function () {
      uploadPhotos($("photo-input").files);
      $("photo-input").value = "";
    });
    document.querySelectorAll("#status-row .status-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        selectStatus(button.dataset.status);
        renderPreview();
      });
    });
    node("upload-large").addEventListener("click", function () { slotTarget = "large"; node("slot-input").click(); });
    node("upload-small").addEventListener("click", function () { slotTarget = "small"; node("slot-input").click(); });
    node("slot-input").addEventListener("change", function () {
      uploadPhotos(node("slot-input").files);
      node("slot-input").value = "";
    });
    node("clear-large").addEventListener("click", function () { draft.largeImage = ""; renderImageSlots(); renderPreview(); });
    node("clear-small").addEventListener("click", function () { draft.smallImage = ""; renderImageSlots(); renderPreview(); });
    node("delete-account").addEventListener("click", function () {
      if (!window.confirm("Delete your account? Your card, your photos and your public card page all go.")) return;
      api("/api/account", { method: "DELETE" }).then(function (r) {
        if (r.ok) location.href = "/";
        else toast(r.body.error || "Could not delete the account.");
      });
    });
    $("pick-large").addEventListener("click", function () { openPicker("large"); });
    $("pick-small").addEventListener("click", function () { openPicker("small"); });
    $("picker-close").addEventListener("click", function () { $("picker").close(); });
    $("copy-link").addEventListener("click", function () {
      var input = $("card-link");
      input.select();
      if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(function () { toast("Link copied."); });
      else { document.execCommand("copy"); toast("Link copied."); }
    });
    $("publish-card").addEventListener("change", function () {
      api("/api/settings", { method: "POST", body: JSON.stringify({ cardPublished: $("publish-card").checked }) }).then(function (r) {
        if (r.ok) toast($("publish-card").checked ? "The card page is public." : "The card page is private.");
        else toast(r.body.error || "Could not change the card page.");
      });
    });
    $("save-settings").addEventListener("click", function () {
      if (!(state.user && state.user.admin)) { toast("Those settings are admin-only."); return; }
      var body = {
        siteName: $("s-site-name").value,
        supportUrl: node("s-support-url").value.trim(),
        keepAlive: $("s-keepalive").value === "on",
        keepAliveMinutes: Number($("s-interval").value) || 10,
        clientId: $("s-client-id").value.trim()
      };
      if ($("s-client-secret").value.trim()) body.clientSecret = $("s-client-secret").value.trim();
      if ($("s-bot-token").value.trim()) body.botToken = $("s-bot-token").value.trim();
      api("/api/settings", { method: "POST", body: JSON.stringify(body) }).then(function (r) {
        if (r.ok) {
          fillSettings();
          toast("Instance saved.");
        } else toast(r.body.error || "Could not save the instance.");
      });
    });
    var devBtn = node("dev-toggle");
    if (devBtn) devBtn.addEventListener("click", function () { setDevVisible(!devVisible()); });
    var connectBtn = node("sdk-connect");
    if (connectBtn) connectBtn.addEventListener("click", function () { location.href = "/oauth/connect"; });
    $("logout").addEventListener("click", function () {
      fetch("/logout", { method: "POST" }).then(function () { location.href = "/"; });
    });
    document.querySelectorAll("[data-preset]").forEach(function (button) {
      button.addEventListener("click", function () {
        var preset = JSON.parse(button.dataset.preset);
        draft = Object.assign(clone(draft), preset, { buttons: clone(preset.buttons || draft.buttons || []) });
        fillForm(draft);
      });
    });
  }

  setInterval(drawElapsed, 1000);
  bind();
  refresh().then(function () {
    pollTimer = setInterval(function () { refresh(); }, 12000);
  });
})();
