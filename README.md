# StatusC0rd

A small, self-hosted web dashboard that controls a Discord bot's **rich presence**
(status, activity type, details, images and elapsed timer) and optionally lets
trusted people sign in with Discord to edit it.

```
Browser ──HTTPS──▶ Express dashboard (auth + CSRF + rate limits)
                        │
                        ├──▶ Discord Gateway (bot presence)
                        └──▶ data/config.json (atomic, 0600)
```

- **Dashboard only:** no bot token required to boot (`BOT_ENABLED=false`).
- **Discord sign-in:** optional `identify` OAuth for allowlisted accounts.
- **Live:** the page updates over Server-Sent Events; presence updates are
  queued so Discord's rate limit is never tripped.
- **Zero secrets in the browser:** tokens and the OAuth session stay server-side.

---

## Breaking change: user-account rich presence is gone

Version 2.0.0 removes the "/api/rpc" user-account RPC feature that shipped in
1.0.0. It could not work in production, for three independent reasons:

1. The `rpc` / `rpc.activities.write` OAuth scopes are **partner-only**; Discord
   documents them as "only available to approved partners".
2. RPC connections are made from a **local Discord client** over IPC or
   `ws://127.0.0.1:6463–6472`. A hosted server cannot reach a visitor's local
   Discord client.
3. Discord's public documentation marks **RPC over WebSocket as deprecated**,
   available only to old private-beta participants. The 1.0.0 code connected to
   `wss://rpc.discord.gg`, which no longer serves that purpose.

Keeping that code meant storing other people's OAuth tokens on the server for a
feature that could never connect. It also carried a real token-leak risk: the
old implementation wrote `data/users.json` with `stream.buttons`, an activity
field that does not exist in the bot API and is rejected by the Discord RPC
activity schema.

If an old deployment still has `data/users.json`, it contains stale access and
refresh tokens. **Delete that file.** The current app warns on startup when it
finds it and never reads it.

Rich-presence **buttons** are likewise gone: Discord does not render buttons on
bot presences, only on RPC presences which are unavailable here. The dashboard
now explains this instead of silently lying to you.

---

## What the dashboard does

| Feature | Details |
| --- | --- |
| Activity types | Playing, Streaming, Listening, Watching, Custom status, Competing |
| Status | Online, Idle, Do not disturb, Invisible |
| Text | Activity name, details, state (newlines stripped, length-clamped) |
| Assets | Large/small image **keys** plus hover text |
| Timer | Elapsed timer, preserved across edits, restartable |
| Streaming | Requires an `https://twitch.tv` or `https://youtube.com` URL |

Validation runs on the server, so a bad payload cannot produce a silent no-op:
Discord simply ignores invalid presence data, which made the old version look
like it "randomly stopped working".

---

## Requirements

- Node.js 20 or newer (22 LTS recommended)
- A Discord application with a bot user
- A publicly reachable HTTPS URL for a hosted deployment

The bundled application is **VanC0rd** (`1554342719923560518`). Its client ID
and public key are public identifiers; never publish the bot token, client
secret, session secret or dashboard key.

---

## Quick start (local)

```sh
npm install
cp .env.example .env
```

Generate two different secrets:

```sh
openssl rand -hex 32   # → SESSION_SECRET
openssl rand -hex 32   # → DASHBOARD_KEY
```

Fill in `.env`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `CLIENT_ID` | yes | Application/client ID, used for the invite link and OAuth |
| `DISCORD_TOKEN` | required in production | Bot token from Developer Portal → Bot (locally, an empty token simply starts dashboard-only mode) |
| `BOT_ENABLED` | no (default `true`) | `false` runs the dashboard without a gateway connection |
| `SESSION_SECRET` | yes | Signs the session cookie; 32+ random characters |
| `DASHBOARD_KEY` | one auth method | Password for the dashboard key form |
| `CLIENT_SECRET` | for Discord SSO | OAuth2 client secret |
| `ALLOWED_DISCORD_IDS` | for Discord SSO | Comma separated Discord user IDs allowed to sign in |
| `REDIRECT_URI` | recommended | Exact registered callback URL |
| `PORT` | no (default `3000`) | HTTP port |
| `NODE_ENV` | recommended | `production` enables secure cookies + HSTS |
| `DATA_DIR` | no (default `./data`) | Where `config.json` lives |
| `TRUST_PROXY` | no | Express `trust proxy` value; defaults to `1` in production |

You must configure **at least one** sign-in method: `DASHBOARD_KEY`, or
`CLIENT_SECRET` + `ALLOWED_DISCORD_IDS`. The app refuses to boot otherwise and
tells you which variables are missing.

Start it:

```sh
npm start        # or: npm run dev   (node --watch)
```

Open <http://localhost:3000/login>, sign in with `DASHBOARD_KEY`, edit the
presence and press **Apply presence**. Health check: `/health`.

### Running without Discord

`BOT_ENABLED=false` keeps the whole dashboard usable (login, editor, live
preview, persisted config); it simply reports "Dashboard only" and never opens a
gateway connection. Handy for UI work and for CI.

---

## Discord Developer Portal setup

1. Select the **VanC0rd** application (ID `1554342719923560518`).
2. **Bot** → reset the token, put it in `DISCORD_TOKEN`, never commit it.
3. **Rich Presence → Art Assets** → upload the images whose keys you type in the
   dashboard. Asset *keys* (for example `logo`) are required; arbitrary image
   URLs are rejected by Discord for bot presences.
4. *(Optional, for Discord sign-in)* **OAuth2** → copy the client secret to
   `CLIENT_SECRET`, and add the redirect URL
   `https://<your-host>/auth/discord/callback`.
5. *(Optional)* enable the **Server Members Intent** only if you later add
   features that need it - this dashboard does not.

No interaction endpoint or public key is used: the app does not receive Discord
webhooks, so `PUBLIC_KEY` is informational.

---

## Deployment (Render)

`render.yaml` describes a free Node web service:

1. Push this repository to GitHub.
2. Create a **Blueprint** from `render.yaml` (or a Node web service with
   `npm ci` / `npm start`).
3. Set the secrets marked `sync: false`: `DISCORD_TOKEN`, `DASHBOARD_KEY`,
   `CLIENT_SECRET` (optional), `ALLOWED_DISCORD_IDS` (optional) and
   `REDIRECT_URI = https://<your-service>.onrender.com/auth/discord/callback`.
   `SESSION_SECRET` is generated by Render.
4. Register the same redirect URL in the Discord Developer Portal.
5. Deploy, open `/login`, sign in.

`/health` returns `200` with `{"status":"ok",...}` and `503` if the data
directory is not writable, so Render can detect a broken deployment.

**Persistence:** free Render services have an ephemeral filesystem, so
`data/config.json` is reset on redeploy. Attach a persistent disk (paid) and set
`DATA_DIR` to its mount path if the presence must survive deploys. Secret values
always come from the environment, never from disk.

---

## Security model

- **Sessions** are signed (HMAC-SHA256) cookies, `HttpOnly`, `SameSite=Lax`,
  8-hour expiry and `Secure` in production. The cookie holds only an identity and
  a CSRF token - no Discord tokens are ever stored.
- **Sign-in** uses a constant-time comparison against `DASHBOARD_KEY`; five
  failures per IP trigger a 15-minute lockout. Discord sign-in is restricted to
  `ALLOWED_DISCORD_IDS`.
- **CSRF** double-submit tokens are required for every state-changing request.
- **OAuth state** is random, single-use and expires after 10 minutes. Access
  tokens are discarded immediately after fetching `/users/@me`.
- **Headers:** CSP (no inline scripts), `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `COOP`/`CORP`, HSTS in production.
- **Validation:** every field is length-clamped, control characters are stripped,
  asset keys are pattern-checked and stream URLs are host-checked.
- **Writes** to `data/config.json` are atomic (temp file + rename) with mode
  `0600`; corrupt files are moved aside instead of being overwritten.
- **Rate limits:** login attempts and presence writes are throttled; presence
  updates to Discord are coalesced to at most one every 4.5 seconds.

### About framing

In development the CSP allows the app to be embedded in a hosted live-preview
iframe. With `NODE_ENV=production` framing is limited to `'self'`, which
prevents clickjacking. Do not loosen that in production.

---

## Docker

```sh
docker build -t statusc0rd .
docker run -d --name statusc0rd \
  -p 3000:3000 \
  -e CLIENT_ID=1554342719923560518 \
  -e DISCORD_TOKEN=... \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e DASHBOARD_KEY=$(openssl rand -hex 32) \
  -e NODE_ENV=production \
  -v statusc0rd-data:/app/data \
  statusc0rd
```

The image runs as the unprivileged `node` user and has a `/health` healthcheck.
Mount `/app/data` (or set `DATA_DIR`) so the presence survives container
recreation.

## HTTP API

All API routes require an authenticated session. Mutations also require an
`x-csrf-token` header.

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness/readiness probe |
| `GET` | `/login` | Sign-in page |
| `POST` | `/login` | Dashboard key sign-in (`key`, `_csrf`) |
| `POST` | `/logout` | End the session |
| `GET` | `/auth/discord` | Start Discord sign-in |
| `GET` | `/auth/discord/callback` | OAuth2 callback |
| `GET` | `/api/state` | Current user, presence, bot state, CSRF token |
| `GET` | `/api/presence` | Stored presence configuration |
| `POST` | `/api/presence` | Validate, persist and apply a presence |
| `POST` | `/api/presence/clear` | Remove the activity |
| `GET` | `/api/events` | Server-Sent Events stream of state changes |

Example:

```sh
curl -s -X POST https://your-host/api/presence \
  -H 'content-type: application/json' \
  -H 'cookie: statusc0rd.sid=…' \
  -H 'x-csrf-token: …' \
  -d '{"name":"Building StatusC0rd","type":0,"status":"online","details":"v2.0.0"}'
```

Presence payload fields: `enabled`, `name`, `type` (0–5), `status`
(`online|idle|dnd|invisible`), `details`, `state`, `url`, `largeImage`,
`largeText`, `smallImage`, `smallText`, `startedAt`, `restartTimer`.

---

## Development

```sh
npm run dev      # reload on change
npm run check    # syntax check every entry point
npm test         # 61 unit + HTTP integration tests (node:test, no extra deps)
```

```
index.js          entry point: env validation, startup, graceful shutdown
app.js            Express app (routes, auth, SSE) - exported for tests
src/env.js        environment parsing + validation
src/presence.js   presence model, validation, activity builder
src/bot.js        gateway connection + presence rate-limit queue
src/auth.js       constant-time compare, CSRF, rate limiters
src/oauth.js      Discord OAuth2 (identify) with timeouts
src/store.js      atomic JSON store
src/views.js      tiny `{{TOKEN}}` HTML renderer (auto-escaped)
views/            login, dashboard, error pages
public/           styles.css, app.js, login.js, favicon
test/             node:test suites
```

The HTTP tests inject a fake bot and a temporary data directory, so they never
touch Discord or your real `data/config.json`.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Invalid configuration: …` on boot | Read the list; usually a missing `SESSION_SECRET` or no sign-in method |
| "Connection error" pill, invalid token | Re-copy `DISCORD_TOKEN`; the bot retries with backoff, the dashboard stays up |
| Presence not visible | Check `BOT_ENABLED`, that the activity name is non-empty, and that the bot shares a server with you |
| Images not rendering | Upload art assets in the Developer Portal and use their *keys*, not URLs |
| `401` on `/api/state` | Session expired - sign in again |
| `403` CSRF token | Stale page after a session change - reload |
| Login says "too many attempts" | IP lockout (5 failures / 15 min); wait or restart the process |
| Discord sign-in `redirect_uri` error | `REDIRECT_URI` must match the portal registration exactly, including scheme and path |

---

## License

No license file is included in this repository; all rights reserved by the
repository owner.
