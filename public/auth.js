/* StatusC0rd sign-in page — email + password, vanilla JS, no build step. */
(function () {
  "use strict";

  function node(id) { return document.getElementById(id); }

  var tokenInput = node("link-token");
  var hasLink = Boolean(tokenInput && tokenInput.value);
  var loginForm = node("form-login");
  var registerForm = node("form-register");
  var tabLogin = node("tab-login");
  var tabRegister = node("tab-register");
  var errorBox = node("auth-error");
  var needLink = node("need-link");

  if (needLink) needLink.hidden = hasLink;

  function selectTab(register) {
    tabLogin.classList.toggle("selected", !register);
    tabRegister.classList.toggle("selected", register);
    loginForm.hidden = register;
    registerForm.hidden = !register;
    errorBox.textContent = "";
  }

  tabLogin.addEventListener("click", function () { selectTab(false); });
  tabRegister.addEventListener("click", function () { selectTab(true); });

  // Arriving from ;rpc with no error shown: the register tab is the point.
  if (hasLink && !errorBox.textContent) selectTab(true);

  function showError(message) {
    errorBox.textContent = message || "";
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        return { ok: res.ok, body: payload };
      });
    });
  }

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    post("/api/auth/login", { email: node("l-email").value, password: node("l-pass").value }).then(function (r) {
      if (r.ok) location.href = "/";
      else showError((r.body && r.body.error) || "Could not log in.");
    });
  });

  registerForm.addEventListener("submit", function (event) {
    event.preventDefault();
    post("/api/auth/register", {
      email: node("r-email").value,
      password: node("r-pass").value,
      token: tokenInput ? tokenInput.value : ""
    }).then(function (r) {
      if (r.ok) location.href = "/";
      else showError((r.body && r.body.error) || "Could not create the account.");
    });
  });
})();
