/* StatusC0rd sign-in — Google-style card: email first, then password. */
(function () {
  "use strict";

  function node(id) { return document.getElementById(id); }

  var tokenInput = node("link-token");
  var hasLink = Boolean(tokenInput && tokenInput.value);
  var loginForm = node("form-login");
  var registerForm = node("form-register");
  var errorBox = node("auth-error");
  var needLink = node("need-link");
  var title = node("auth-title");
  var sub = node("auth-sub");
  var passStep = node("login-pass-step");
  var loginBtn = node("btn-login");
  var onPassStep = false;

  if (needLink) needLink.hidden = hasLink;

  function selectForm(register) {
    var form = register ? registerForm : loginForm;
    loginForm.hidden = register;
    registerForm.hidden = !register;
    title.textContent = form.getAttribute("data-title");
    sub.textContent = form.getAttribute("data-sub");
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

  function toggleShow(boxId, inputId) {
    var box = node(boxId);
    var input = node(inputId);
    if (!box || !input) return;
    box.addEventListener("change", function () { input.type = box.checked ? "text" : "password"; });
  }

  toggleShow("l-show", "l-pass");
  toggleShow("r-show", "r-pass");

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!onPassStep) {
      onPassStep = true;
      passStep.hidden = false;
      node("hi-email").textContent = node("l-email").value;
      loginBtn.textContent = "Sign in";
      node("l-pass").focus();
      return;
    }
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

  // Arriving from ;rpc with no error shown: registration is the point.
  selectForm(Boolean(hasLink && !errorBox.textContent));
})();
