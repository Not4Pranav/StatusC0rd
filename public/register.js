"use strict";

(() => {
  const MESSAGES = {
    closed: "Sign-ups are closed on this server. Ask the owner for an account.",
    mismatch: "The two passwords do not match.",
    invalid: "That could not be created — check the email and password."
  };

  const alertBox = document.getElementById("alert");
  const form = document.getElementById("register-form");
  const params = new URLSearchParams(location.search);
  const code = params.get("error");
  const detail = params.get("message");

  if (document.body.dataset.signupEnabled !== "true") {
    // The server already refuses; the form should not pretend otherwise.
    form?.remove();
    alertBox.textContent = MESSAGES.closed;
    alertBox.hidden = false;
  } else if (code) {
    alertBox.textContent = detail || MESSAGES[code] || "That did not work. Please try again.";
    alertBox.hidden = false;
  }

  const password = document.getElementById("password");
  const confirm = document.getElementById("confirm");

  function checkMatch() {
    if (!password || !confirm) return true;
    const same = password.value === confirm.value;
    confirm.setCustomValidity(same ? "" : "The two passwords do not match.");
    return same;
  }

  password?.addEventListener("input", checkMatch);
  confirm?.addEventListener("input", checkMatch);

  form?.addEventListener("submit", (event) => {
    if (!checkMatch()) {
      event.preventDefault();
      confirm.reportValidity();
      return;
    }
    if (password.value.length < 10) {
      event.preventDefault();
      alertBox.textContent = "Passwords need at least 10 characters.";
      alertBox.hidden = false;
    }
  });
})();
