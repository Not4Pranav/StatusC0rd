# StatusC0rd

Set up a Discord rich presence from your browser: text, photos, buttons and a
live timer — then keep it online 24/7.

![status: tested](https://img.shields.io/badge/tests-108%20passing-3ddc97)

```
Browser ──HTTPS──▶ StatusC0rd server
                     ├─▶ Discord gateway   → the bot card, always online
                     ├─▶ /assets/<id>.png  → photos Discord can fetch
                     └─▶ companion (your PC) → your own profile, full rich presence
```

Everything is configured from the website. There is no config file to edit and
no restart needed after the first launch.

---

## Two places a presence can appear

| | Bot card | **Your profile** |
| --- | --- | --- |
| Who shows it | the bot account | your own Discord account |
| Text (name, type, state) | ✅ | ✅ |
| Details / second line | ⚠️ gateway is limited | ✅ |
| **Photos** | ❌ Discord drops images for bots | ✅ |
| Buttons | ❌ | ✅ |
| Elapsed timer | ✅ (status text only) | ✅ |
| Needs your computer on | ❌ runs on the server | ✅ while the companion runs |

Discord renders **only `name`, `type` and `state`** for bot accounts — images and
buttons are stripped by the gateway. That is a Discord restriction, not a bug
here. So photos and buttons are delivered by a tiny **companion** you run on
your own computer (one command, no install): it talks to your local Discord
client and follows whatever you set on the dashboard.

The dashboard can target either place, or both.

---

## Quick start

```sh
npm install
npm start
```

Open <http://localhost:3000>. On first run you land on the **setup wizard**:

1. **Account** — create the dashboard key (there is a “generate a strong key”
   button). Optionally add an OAuth2 client secret + allowed Discord user IDs to
   enable “Continue with Discord”.
2. **Bot** — the **Application (client) ID** (Developer Portal → General
   Information) plus the bot token (Developer Portal → Bot → Reset Token).
   “Test connection” verifies the token before saving. The ID is required: it is
   what Discord attributes your activity to, and the companion cannot connect
   without it. You can still skip the bot and run dashboard-only.
3. **Presence** — name, type, two lines of text, and **upload photos** (square
   cropped automatically), plus the **public URL** Discord should fetch those
   photos from (pre-filled with the address you are using). “Finish setup” saves
   everything and signs you in.

Requirements: Node.js 20+ (22 LTS recommended), and for photos a **public HTTPS
URL** (see below).

> If you expose the app to the internet before finishing setup, the wizard asks
> for the one-time setup token printed in the server log
> (`data/setup-token.txt`). A stranger cannot claim an unconfigured instance.

---

## Photos: how they actually work

1. You pick an image in the dashboard. It is downscaled to a square (512 px
   large / 256 px small) and uploaded to the server.
2. The server stores it in `data/assets/` (deduplicated by content hash) and
   serves it at `https://your-host/assets/<id>.png` with
   `Access-Control-Allow-Origin: *` so Discord's media proxy can fetch it.
3. The companion asks the server for the presence and receives
   `assets.large_image = "https://your-host/assets/<id>.png"`.
4. Discord's RPC accepts an **external HTTPS URL** for `large_image` /
   `small_image`, so the photo appears on your profile immediately.

Consequences worth knowing:

- **HTTPS is required for photos.** Discord will not fetch `http://` or
  `localhost` URLs. Use a real domain, a tunnel, or a host like Render.
- Discord caches artwork for a few minutes; a brand-new image may take a moment
  and occasionally needs a Discord restart.
- Prefer uploaded artwork? You can also paste a Discord **asset key** (the key
  from Rich Presence → Art Assets). Keys work for the companion too, but external
  URLs are what make the in-dashboard upload flow work.
- Need a photo on the bot card? Discord does not render it. Use the companion.

---

## Put it on your own profile (companion)

Dashboard → **My profile** → *Pair this computer*.

**No terminal needed:** download the launcher for your OS and double-click it.

- **macOS** — `StatusC0rd-mac.zip`; unzip (Safari does it automatically) and
  double-click `StatusC0rd.command`. It is shipped as a zip on purpose: macOS
  strips the execute bit from plain downloads, while Archive Utility restores the
  `0755` mode stored in the archive.
- **Windows** — `StatusC0rd.bat`, double-click.
- **Linux** — `statusc0rd.sh`; `chmod +x` once, then run (or use the `curl | node`
  line below).

Each launcher is generated for that one paired device, checks for Node.js, and
downloads/runs the companion in a window with live status.

Prefer a terminal:

```sh
curl -fsSL "https://your-host/companion.js?pair=<token>" | node      # macOS / Linux
curl.exe -fsSL "https://your-host/companion.js?pair=<token>" | node  # Windows PowerShell
```

The launchers are personalized: anyone holding one can push presence to that
pairing, so treat the file like a password and **Remove** the device if it leaks.

The script:

- finds your local Discord client (`discord-ipc-0…9`, including Flatpak/Snap
  paths on Linux and named pipes on Windows),
- performs the RPC handshake with your application ID from the dashboard,
- pushes the full activity — photos, details, state, buttons, timer,
- polls the dashboard every 5 s, so **anything you change in the browser shows
  up on your profile within seconds**,
- reconnects automatically when Discord restarts, re-applies after it wakes up,
- clears the presence when you press `Ctrl+C`,
- reports back so the dashboard shows “Profile live” and a last-seen time.

Notes:

- Needs Node.js 20+ on that machine. No packages, no build step, no Discord
  password, no token — it only talks to your own Discord client.
- Pairing tokens are stored **hashed**; revoke a device any time in
  **My profile → Paired devices**.
- The generated script contains its pairing token — treat the command like a
  password. Keep it out of screencasts and git.
- Discord RPC does not support the *Streaming* and *Custom status* types; the
  companion renders those as **Playing** so the update never fails.

---

## 24/7 online

The bot lives on the server, so it is online as long as the server is:

- **Render/Fly/Railway:** keep the service running (see below). A free Render web
  service sleeps after idle time, which disconnects the gateway.
- **Built-in keep-alive:** set your public URL under **Bot & 24/7** and StatusC0rd
  pings its own `/health` every N minutes (min 5) to generate the inbound traffic
  that keeps a free instance awake. The dashboard shows the last successful ping.
- **Docker/self-host:** a normal always-on process; the bot reconnects with
  exponential backoff after network blips and Discord restarts.

---

## Deployment

New here, or want the $0 walkthrough (Discord app → free host → first presence →
pairing, plus which free hosts are actually worth using)? See
[docs/free-setup.md](docs/free-setup.md) — or open **`/guide`** on any running
instance, which renders that same file in the browser. `/welcome` is the public
overview page, so a fresh deployment can be handed to a stranger as-is:

| Route | Who it is for |
| --- | --- |
| `/welcome` | anyone — what StatusC0rd does, and how the three free paths differ |
| `/guide` | anyone — the full setup guide, rendered from `docs/free-setup.md` |
| `/setup` | the operator, on first boot, for the three-step wizard |
| `/` | the signed-in dashboard |

### Render

`render.yaml` provisions a Node web service with `/health` as the health check.

1. Push this repo to GitHub and create a Blueprint from `render.yaml`.
2. Set `PUBLIC_URL` to `https://<service>.onrender.com` (or just finish the setup
   wizard and paste the URL in **Bot & 24/7** — it is stored server-side).
3. Open `/setup` and complete the wizard. Prefer secrets in the dashboard? Leave
   `DISCORD_TOKEN` empty; if you set it in Render, it overrides the stored value.
4. Free instances have an ephemeral disk: `data/` (settings, photos) resets on
   redeploy or restart. Free services cannot attach disks; keeping `DASHBOARD_KEY`,
   `CLIENT_ID`, `DISCORD_TOKEN` and `PUBLIC_URL` in the environment means a wiped
   install still boots straight into the dashboard (the wizard is skipped) and the
   bot reconnects on its own. For durable photos and pairing, use a host with real
   storage - see `docs/free-setup.md`.

`SESSION_SECRET` is generated by Render. `PUBLIC_URL` matters twice: it is the
base for photo URLs and the keep-alive target.

### Docker

```sh
docker build -t statusc0rd .
docker run -d --name statusc0rd -p 3000:3000 \
  -e PUBLIC_URL=https://status.example.com \
  -v statusc0rd-data:/app/data \
  statusc0rd
```

Then finish the setup wizard at `https://status.example.com/setup`. The image
runs as the unprivileged `node` user with a `/health` health check.

### Vercel (not recommended)

Vercel functions cannot hold a persistent Discord gateway connection, keep
in-memory rate limiters, stream SSE, or write to a local `data/` directory. The
dashboard would work as a demo, but the bot would be offline. Use Render, Fly,
Railway or Docker for this app.

---

## Configuration (all optional)

Environment variables override what the website stored — useful for managed
hosts. A completely unconfigured instance still boots and serves the wizard.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3000`) |
| `NODE_ENV` | `production` tightens framing rules (`frame-ancestors 'self'`) |
| `DATA_DIR` | Where `settings.json`, `assets/` and the setup token live (default `./data`) |
| `CLIENT_ID` | Discord application ID (unset by default; the wizard stores it) |
| `DISCORD_TOKEN` | Bot token; overrides the stored one |
| `BOT_ENABLED` | `false` runs the dashboard without a gateway connection |
| `SESSION_SECRET` | Cookie signing key (auto-generated when unset) |
| `DASHBOARD_KEY` | Dashboard key; overrides the stored hash |
| `SETUP_TOKEN` | Fixed setup token instead of the generated one |
| `CLIENT_SECRET` | OAuth2 secret, enables “Continue with Discord” |
| `ALLOWED_DISCORD_IDS` | Comma separated Discord user IDs allowed to sign in |
| `PUBLIC_URL` | Public HTTPS origin used for photo URLs and keep-alive |
| `KEEP_ALIVE` / `KEEP_ALIVE_INTERVAL_MINUTES` | Force keep-alive on/off and interval |
| `REDIRECT_URI` | Override the OAuth callback (defaults to `<PUBLIC_URL>/auth/discord/callback`) |
| `TRUST_PROXY` | Which hops may set `X-Forwarded-*` (`false`, a hop count, or a proxy list; defaults to loopback + private ranges) |

Secrets are stored in `data/settings.json` with mode `0600`, never in the
browser, and the dashboard key is only kept as a scrypt hash.

---

## HTTP API

Session cookie + `x-csrf-token` for mutations. Companion endpoints use a
`Authorization: Bearer <pairing token>` header instead.

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Status, setup state, bot state |
| `GET` | `/setup` | Setup wizard |
| `POST` | `/api/setup/verify` | Unlock setup with the setup token |
| `POST` | `/api/setup/asset` | Upload a photo during setup |
| `POST` | `/api/setup/test-bot` | Validate a bot token |
| `POST` | `/api/setup/complete` | Save key + bot + first presence, sign in |
| `GET` | `/login`, `POST /login`, `POST /logout` | Dashboard session |
| `GET` | `/auth/discord`, `/auth/discord/callback` | Optional Discord sign-in |
| `GET` | `/` | Dashboard |
| `GET` | `/api/state` | Presence, bot, photos, devices, keep-alive, meta |
| `POST` | `/api/presence` | Validate + save + apply (bot and/or companion) |
| `POST` | `/api/presence/clear` | Clear everywhere |
| `GET` | `/api/events` | SSE stream of state changes |
| `GET`/`POST` | `/api/assets` | List / upload photos |
| `DELETE` | `/api/assets/:id` | Delete a photo |
| `GET`/`POST` | `/api/settings` | Read / update settings, rotate the key |
| `POST` | `/api/companion/pairings` | Create a device pairing (returns the command) |
| `DELETE` | `/api/companion/pairings/:id` | Revoke a device |
| `GET` | `/companion.js?pair=…` | Personalized companion script |
| `GET` | `/api/companion/config` | Presence payload for the companion (ETag) |
| `POST` | `/api/companion/heartbeat` | Device status + presence confirmation |
| `GET` | `/assets/:id.png` | Public photo (used by Discord) |

Presence payload: `name`, `type` (0–5), `status`, `details`, `state`, `url`,
`largeImage`, `smallImage`, `largeText`, `smallText`, `buttons[{label,url}]`,
`startedAt`, `restartTimer`, `targets{bot,companion}`. Images accept an uploaded
photo reference (`asset:<id>`), an `https://` URL, or a Discord asset key.

---

## Security

- Signed `HttpOnly`, `SameSite=Lax` session cookies; `Secure` in production.
- Dashboard key stored as a **scrypt** hash, compared in constant time; 5 failed
  attempts per IP → 15-minute lockout.
- CSRF double-submit tokens on every mutation; OAuth state is random, single-use
  and expires.
- CSP without inline scripts, `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `COOP`/`CORP`, HSTS in production, no framing in production.
- Setup cannot be claimed remotely without the one-time setup token.
- Uploads are sniffed by magic bytes, size-capped (2 MB) and re-served from
  content-hashed filenames; only the image types Discord accepts are stored.
- Pairing tokens are hashed at rest and revocable; each device is independent.
- Atomic `0600` writes with corrupt-file recovery; presence updates are coalesced
  to respect Discord's rate limits.

---

## Development

```sh
npm run dev    # node --watch
npm run check  # parse every source file
npm test       # 108 tests (node:test only)
```

`test/companion-e2e.test.js` is the proof for the headline flow: it boots a real
dashboard, uploads a real PNG, sets text + photo + two buttons, pairs a device,
then runs the **actual companion** against a temporary UNIX socket that emulates
the Discord client. It asserts the exact `SET_ACTIVITY` frame Discord receives
(photo URL, hover text, both buttons, `metadata.button_urls`, timer), that a
dashboard edit arrives without reloading, and that clearing/stopping removes the
presence.

```
index.js               boot, banner, graceful shutdown
app.js                 Express app (wizard, dashboard, API, companion endpoints)
src/settings.js        persistent settings + scrypt key + pairings
src/assets.js          image validation, hashed storage, public URLs
src/presence.js        presence model, validation, activity builder per target
src/bot.js             gateway connection, backoff, rate-limited presence queue
src/keepalive.js       self-ping loop for 24/7 hosting
src/oauth.js           Discord OAuth2 (identify) with timeouts
src/auth.js            constant-time compare, CSRF, rate limiters
src/views.js           tiny auto-escaping `{{TOKEN}}` renderer
src/companion/agent.js the companion (also served as a personalized script)
views/                 setup, dashboard, login, error
public/                styles, dashboard JS, setup JS, upload helper
test/                  node:test suites (presence, settings, assets, bot,
                       keepalive, companion IPC, HTTP integration)
```

The tests inject a fake bot and a temporary data directory, and the companion
suite runs a real UNIX-socket server that emulates Discord's IPC handshake.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Photos show in the preview but not on my profile | The companion is not running, or Discord cannot fetch the URL. Check **Bot & 24/7 → Public URL** is the https URL you actually use, and that `https://your-host/assets/<id>.png` opens in a browser. |
| Photos never appear on the bot card | Expected — Discord strips assets for bot accounts. Use the companion. |
| New image missing in Discord | Discord caches artwork for a few minutes; restart Discord if it lingers. |
| “Discord is not running” in the companion | Start the Discord desktop app (not the web version) and leave it open. |
| Companion says “no longer paired” | The device was removed in **My profile**; pair again. |
| Bot pill says offline | Bad `DISCORD_TOKEN`, or the host is asleep. Check the log line, and enable keep-alive for free hosts. |
| Wizard asks for a setup token | You opened it from a non-local address; copy the token from the log or `data/setup-token.txt`. |
| `EADDRINUSE` on start | Another process owns `PORT`; set `PORT` to something else. |
| Lost the dashboard key | Delete `data/settings.json` (you lose settings/photos) or unset `DASHBOARD_KEY` and re-run `/setup`. |

---

## License

No license file is included; all rights reserved by the repository owner.
