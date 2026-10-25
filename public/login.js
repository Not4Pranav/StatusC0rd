"use strict";

(() => {
  const MESSAGES = {
    invalid: "That dashboard key is not correct.",
    bad_credentials: "That email and password do not match an account.",
    locked: "Too many failed attempts. Please wait a few minutes and try again.",
    key_disabled: "Dashboard key sign-in is disabled on this server.",
    discord_disabled: "Discord sign-in is not configured on this server.",
    cancelled: "Discord sign-in was cancelled.",
    state: "That sign-in attempt was invalid or expired. Please try again.",
    expired: "The sign-in attempt took too long. Please try again.",
    not_allowed: "That Discord account is not linked to an account here, and is not allowed by the owner.",
    discord_failed: "Discord sign-in failed. Please try again in a moment."
  };

  const body = document.body;
  const keyEnabled = body.dataset.keyEnabled === "true";
  const discordEnabled = body.dataset.discordEnabled === "true";
  const signupEnabled = body.dataset.signupEnabled === "true";

  const keyForm = document.getElementById("key-form");
  const ownerBox = document.getElementById("owner-box");
  const keyHelp = document.getElementById("key-help");
  const discordButton = document.getElementById("discord-btn");
  const discordHelp = document.getElementById("discord-help");
  const signupHint = document.getElementById("signup-hint");
  const divider = document.getElementById("divider");
  const alertBox = document.getElementById("alert");

  if (!keyEnabled) {
    keyForm?.remove();
    if (keyHelp) keyHelp.hidden = false;
  }

  if (!signupEnabled) {
    signupHint?.remove();
  }

  if (!discordEnabled) {
    discordButton?.remove();
    if (discordHelp) discordHelp.hidden = true;
  }

  if (!keyEnabled && !discordEnabled) divider?.remove();

  const params = new URLSearchParams(location.search);
  const code = params.get("error");
  const detail = params.get("message");
  if (code) {
    alertBox.textContent = detail || MESSAGES[code] || "Sign-in failed. Please try again.";
    alertBox.hidden = false;
    if (code === "invalid" || code === "locked") {
      // A wrong key is the owner's problem, so open that section for them.
      if (ownerBox) ownerBox.open = true;
      const input = document.getElementById("key");
      input?.focus();
      input?.select();
    } else if (code === "bad_credentials") {
      const input = document.getElementById("email");
      input?.focus();
      input?.select();
    }
  } else {
    document.getElementById("email")?.focus();
  }
})();
