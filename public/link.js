"use strict";

/**
 * The /link page: turn a code shown inside Discord into a connected account.
 *
 * Everything is done over JSON with the CSRF token from the page's meta tag, so
 * a failure can say what went wrong instead of reloading a page that looks the
 * same as before.
 */
(() => {
  const body = document.body;
  const form = document.getElementById("link-form");
  const input = document.getElementById("link-code");
  const submit = document.getElementById("link-submit");
  const alertBox = document.getElementById("alert");
  const connectedBox = document.getElementById("connected-box");
  const unlinkForm = document.getElementById("unlink-form");
  const unlinkSubmit = document.getElementById("unlink-submit");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";

  const connected = body.dataset.connected === "true";

  function show(message, kind = "error") {
    if (!message) {
      alertBox.hidden = true;
      alertBox.textContent = "";
      return;
    }
    alertBox.className = kind === "ok" ? "alert is-ok" : "alert";
    alertBox.textContent = message;
    alertBox.hidden = false;
  }

  function paint() {
    connectedBox.hidden = !connected;
    unlinkForm.hidden = !connected;
  }

  /** What a person types: spaces, dashes and lowercase all collapse away. */
  function clean(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  input?.addEventListener("input", () => {
    const start = input.selectionStart;
    const next = clean(input.value).slice(0, 8);
    if (next !== input.value) {
      input.value = next;
      // Keep the caret where the typing happened instead of jumping to the end.
      try {
        input.setSelectionRange(Math.min(start, next.length), Math.min(start, next.length));
      } catch {
        /* older browsers: leave the caret alone */
      }
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("");
    const code = clean(input.value);
    if (code.length !== 8) {
      show("That code needs eight characters. Copy it again from the app in Discord.");
      input.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "Connecting…";
    try {
      const res = await fetch("/api/link/claim", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ code })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Could not connect (HTTP ${res.status}).`);
      }
      input.value = "";
      const who = data.discordName ? `@${data.discordName}` : "Your Discord account";
      show(`${who} is connected. The app in Discord goes live within five seconds.`, "ok");
      body.dataset.connected = "true";
      connectedBox.hidden = false;
      unlinkForm.hidden = false;
      // The dashboard reads this flag on the way back.
      setTimeout(() => {
        window.location.href = "/?tab=profile&link=ok";
      }, 1200);
    } catch (error) {
      show(error.message || "Could not connect that code.");
    } finally {
      submit.disabled = false;
      submit.textContent = "Connect";
    }
  });

  unlinkForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("");
    unlinkSubmit.disabled = true;
    unlinkSubmit.textContent = "Disconnecting…";
    try {
      const res = await fetch("/api/link/remove", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: "{}"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not disconnect.");
      body.dataset.connected = "false";
      paint();
      show("Discord disconnected. Your card stays saved here; it just goes to no profile.", "ok");
    } catch (error) {
      show(error.message || "Could not disconnect.");
    } finally {
      unlinkSubmit.disabled = false;
      unlinkSubmit.textContent = "Disconnect Discord";
    }
  });

  paint();
  if (!connected && !clean(input?.value || "")) {
    input?.focus();
  }
})();
