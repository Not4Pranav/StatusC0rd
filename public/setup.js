"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const body = document.body;
  const needsToken = body.dataset.needsToken === "true";
  const botManaged = body.dataset.botManaged === "true";
  const upload = window.StatusC0rdUpload;

  const state = {
    setupToken: "",
    clientId: body.dataset.clientId || "",
    botToken: "",
    clientSecret: "",
    allowedIds: [],
    adminKey: "",
    images: { large: "", small: "" },
    imageRefs: { large: "", small: "" },
    step: 1
  };

  // ---------------------------------------------------------------- helpers

  function alertBox(message, kind = "error") {
    const box = $("#alert");
    if (!message) {
      box.hidden = true;
      box.textContent = "";
      return;
    }
    box.className = `alert${kind === "ok" ? " is-ok" : ""}`;
    box.textContent = message;
    box.hidden = false;
  }

  async function api(path, method = "GET", payload) {
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (state.setupToken) headers["x-setup-token"] = state.setupToken;
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status})`);
      error.needsToken = Boolean(data?.needsToken);
      throw error;
    }
    return data || {};
  }

  function showStep(step) {
    state.step = step;
    for (const section of document.querySelectorAll(".step")) {
      section.hidden = Number(section.dataset.step) !== step;
    }
    for (const tab of document.querySelectorAll("#steps li")) {
      const value = Number(tab.dataset.stepTab);
      tab.classList.toggle("is-active", value === step);
      tab.classList.toggle("is-done", value < step);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function randomKey() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ------------------------------------------------------------------ step 1

  if (needsToken) {
    $("#lock-box").hidden = false;
    $("#account-step").hidden = true;
  }

  $("#unlock-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = $("#setup-token").value.trim();
    if (!token) return;
    state.setupToken = token;
    try {
      await api("/api/setup/verify", "POST", { token });
      $("#lock-box").hidden = true;
      $("#account-step").hidden = false;
      alertBox("");
    } catch (error) {
      state.setupToken = "";
      alertBox(error.message);
    }
  });

  $("#gen-key").addEventListener("click", () => {
    const key = randomKey();
    $("#admin-key").value = key;
    $("#admin-key-2").value = key;
    alertBox("Generated a strong key - store it in your password manager now.", "ok");
  });

  $("#redirect-hint").textContent = `${location.origin}/auth/discord/callback`;

  $("#account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const key = $("#admin-key").value;
    const repeat = $("#admin-key-2").value;
    if (key.length < 12) return alertBox("Use at least 12 characters for the dashboard key.");
    if (key !== repeat) return alertBox("The two keys do not match.");

    state.adminKey = key;
    state.clientSecret = $("#client-secret").value.trim();
    state.allowedIds = $("#allowed-ids")
      .value.split(/[\s,]+/)
      .map((id) => id.replace(/[^0-9]/g, ""))
      .filter((id) => /^\d{5,25}$/.test(id));

    alertBox("");
    showStep(2);
  });

  // ------------------------------------------------------------------ step 2

  if (botManaged) {
    $("#bot-token").placeholder = "configured by the server environment";
    $("#bot-token").disabled = true;
    $("#client-id").disabled = true;
  }

  $("#test-bot").addEventListener("click", async () => {
    const button = $("#test-bot");
    const result = $("#bot-result");
    const botToken = $("#bot-token").value.trim();
    if (!botToken) return alertBox("Paste the bot token first.");
    button.disabled = true;
    button.textContent = "Testing…";
    result.hidden = true;
    alertBox("");
    try {
      const data = await api("/api/setup/test-bot", "POST", {
        botToken,
        clientId: $("#client-id").value.trim()
      });
      state.botToken = botToken;
      result.className = "alert is-ok";
      result.textContent = `Connected as ${data.bot.tag}. This bot will stay online 24/7.`;
      result.hidden = false;
    } catch (error) {
      result.hidden = true;
      alertBox(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Test connection";
    }
  });

  $("#bot-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.clientId = $("#client-id").value.trim().replace(/[^0-9]/g, "") || state.clientId;
    state.botToken = $("#bot-token").value.trim();
    alertBox("");
    showStep(3);
  });

  $("#skip-bot").addEventListener("click", () => {
    state.botToken = "";
    alertBox("");
    showStep(3);
  });

  // ------------------------------------------------------------------ step 3

  function labelFor(type) {
    return ["PLAYING", "STREAMING", "LISTENING TO", "WATCHING", "", "COMPETING IN"][type] || "PLAYING";
  }

  function renderPreview() {
    const name = $("#presence-name").value.trim();
    $("#setup-preview-type").textContent = labelFor(Number($("#presence-type").value));
    $("#setup-preview-name").textContent = name || "Your activity";
    $("#setup-preview-details").textContent = $("#presence-details").value.trim();
    $("#setup-preview-state").textContent = $("#presence-state").value.trim();
    $("#setup-preview-large").hidden = !state.images.large;
    $("#setup-preview-fallback").hidden = Boolean(state.images.large);
    if (state.images.large) $("#setup-preview-large").src = state.images.large;
    $("#setup-preview-small-wrap").hidden = !state.images.small;
    if (state.images.small) $("#setup-preview-small").src = state.images.small;
  }

  for (const id of ["presence-name", "presence-details", "presence-state", "presence-type"]) {
    $(`#${id}`).addEventListener("input", renderPreview);
    $(`#${id}`).addEventListener("change", renderPreview);
  }

  for (const slot of document.querySelectorAll(".upload-slot")) {
    const input = slot.querySelector("input[type=file]");
    const image = slot.querySelector("img");
    slot.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        alertBox("");
        slot.classList.add("is-busy");
        const size = slot.id === "slot-small" ? 256 : 512;
        const dataUrl = await upload.prepare(file, size);
        const uploaded = await api("/api/setup/asset", "POST", { dataUrl, name: file.name });
        const key = slot.id === "slot-small" ? "small" : "large";
        state.images[key] = uploaded.asset.url;
        state.imageRefs[key] = `asset:${uploaded.asset.id}`;
        image.src = uploaded.asset.url;
        image.hidden = false;
        slot.querySelector("span").hidden = true;
        renderPreview();
      } catch (error) {
        alertBox(error.message);
      } finally {
        slot.classList.remove("is-busy");
        input.value = "";
      }
    });
  }

  $("#back-2").addEventListener("click", () => showStep(2));

  $("#finish").addEventListener("click", async () => {
    const button = $("#finish");
    const name = $("#presence-name").value.trim();
    if (!state.adminKey) return alertBox("Go back and set a dashboard key.");
    if (!name) return alertBox("Give the activity a name.");

    button.disabled = true;
    button.textContent = "Saving…";
    alertBox("");
    try {
      const payload = {
        setupToken: state.setupToken,
        adminKey: state.adminKey,
        publicUrl: location.origin,
        keepAlive: $("#keep-alive").checked,
        keepAliveIntervalMinutes: 10,
        discord: {
          clientId: state.clientId,
          botToken: state.botToken,
          clientSecret: state.clientSecret,
          allowedIds: state.allowedIds
        },
        presence: {
          enabled: true,
          name,
          type: Number($("#presence-type").value),
          status: $("#presence-status").value,
          details: $("#presence-details").value,
          state: $("#presence-state").value,
          largeImage: state.imageRefs.large || state.images.large || "",
          smallImage: state.imageRefs.small || state.images.small || "",
          targets: { bot: Boolean(state.botToken), companion: true }
        }
      };
      const result = await api("/api/setup/complete", "POST", payload);
      $("#finish-hint").textContent = "Saved - opening your dashboard…";
      location.href = result.redirect || "/";
    } catch (error) {
      if (error.needsToken) {
        showStep(1);
        $("#lock-box").hidden = false;
      }
      alertBox(error.message);
      button.disabled = false;
      button.textContent = "Finish setup";
    }
  });

  // -------------------------------------------------------------------- init

  renderPreview();
  if (!needsToken) $("#admin-key").focus();
  else $("#setup-token").focus();
})();
