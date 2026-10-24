"use strict";

(() => {
  const MESSAGES = {
    invalid: "That dashboard key is not correct.",
    locked: "Too many failed attempts. Please wait a few minutes and try again.",
    key_disabled: "Dashboard key sign-in is disabled on this server.",
    discord_disabled: "Discord sign-in is not configured on this server.",
    cancelled: "Discord sign-in was cancelled.",
    state: "That sign-in attempt was invalid or expired. Please try again.",
    expired: "The sign-in attempt took too long. Please try again.",
    not_allowed: "That Discord account is not on the allowlist for this dashboard.",
    discord_failed: "Discord sign-in failed. Please try again in a moment."
  };

  const body = document.body;
  const keyEnabled = body.dataset.keyEnabled === "true";
  const discordEnabled = body.dataset.discordEnabled === "true";

  const keyForm = document.getElementById("key-form");
  const keyHelp = document.getElementById("key-help");
  const discordButton = document.getElementById("discord-btn");
  const discordHelp = document.getElementById("discord-help");
  const divider = document.getElementById("divider");
  const alertBox = document.getElementById("alert");

  if (!keyEnabled) {
    keyForm?.remove();
    if (keyHelp) keyHelp.hidden = false;
  }

  if (!discordEnabled) {
    discordButton?.remove();
    if (discordHelp) discordHelp.hidden = true;
  }

  if (!keyEnabled || !discordEnabled) {
    divider?.remove();
  }

  const code = new URLSearchParams(location.search).get("error");
  if (code) {
    alertBox.textContent = MESSAGES[code] || "Sign-in failed. Please try again.";
    alertBox.hidden = false;
    if (code === "invalid" || code === "locked") {
      const input = document.getElementById("key");
      input?.focus();
      input?.select();
    }
  }
})();
