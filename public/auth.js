/* StatusC0rd sign-in — 400px card, email + password, register toggle. */
(function () {
  "use strict";

  function node(id) { return document.getElementById(id); }

  var tokenInput = node("link-token");
  var hasLink = Boolean(tokenInput && tokenInput.value);
  var loginForm = node("form-login");
  var registerForm = node("form-register");
  var errorBox = node("auth-error");
  var needLink = node("need-link");

  if (needLink) needLink.hidden = hasLink;

  function selectForm(register) {
    loginForm.hidden = register;
    registerForm.hidden = !register;
    errorBox.textContent = "";
  }

  node("goto-register").addEventListener("click", function () { selectForm(true); });
  node("goto-login").addEventListener("click", function () { selectForm(false); });

  function showError(message) { errorBox.textContent = message || ""; }

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
    post("/api/auth/login", { email: node("l-email").value, password: node("l-pass").value, token: tokenInput ? tokenInput.value : "" }).then(function (r) {
      if (r.ok) location.href = "/";
      else showError((r.body && r.body.error) || "Could not log in.");
    });
  });

  registerForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var email = node("r-email").value;
    var pass = node("r-pass").value;
    var pass2 = node("r-pass2").value;
    if (String(pass).length < 8) { showError("Password needs 8 characters or more."); return; }
    if (pass !== pass2) { showError("Those passwords do not match."); return; }
    post("/api/auth/register", {
      email: email,
      password: pass,
      token: tokenInput ? tokenInput.value : ""
    }).then(function (r) {
      if (r.ok) location.href = "/";
      else showError((r.body && r.body.error) || "Could not create the account.");
    });
  });

  // Arriving from ;rpc with no error shown: registration is the point.
  selectForm(Boolean(hasLink && !errorBox.textContent));
})();
