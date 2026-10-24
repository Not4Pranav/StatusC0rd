const API = "https://discord.com/api/v10";

async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  if (!res.ok) throw new Error(`Discord token endpoint ${res.status}: ${await res.text()}`);
  return res.json();
}

function baseParams() {
  return {
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET
  };
}

async function exchangeCode(code) {
  return tokenRequest({ ...baseParams(), grant_type: "authorization_code", code, redirect_uri: process.env.REDIRECT_URI });
}

async function refreshToken(refresh_token) {
  return tokenRequest({ ...baseParams(), grant_type: "refresh_token", refresh_token });
}

async function fetchMe(accessToken) {
  const res = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`users/@me ${res.status}`);
  return res.json();
}

module.exports = { exchangeCode, refreshToken, fetchMe };
