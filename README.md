# StatusC0rd

Set up a Discord rich presence from your browser: text, photos, buttons and a
live timer — then keep it online 24/7.

![status: tested](https://img.shields.io/badge/tests-131%20passing-3ddc97)

```
Browser ──HTTPS──▶ StatusC0rd server
                     ├─▶ Discord gateway   → the bot card, always online
                     ├─▶ /assets/<id>.png  → photos Discord can fetch
                     └─▶ Discord Activity  → your own profile, photos + buttons
                          (and, optionally, the companion on your PC)
```

Everything is configured from the website. There is no config file to edit and
no restart needed after the first launch.

---

## Two places a presence can appear

| | Bot card | **Your profile** — in-Discord app | **Your profile** — companion |
| --- | --- | --- | --- |
| Who shows it | the bot account | your own Discord account | your own Discord account |
| Text (name, type, state) | ✅ | ✅ | ✅ |
| Details / second line | ⚠️ gateway is limited | ✅ | ✅ |
| **Photos** | ❌ Discord drops images for bots | ✅ | ✅ |
| Buttons | ❌ | ✅ where the client renders them | ✅ |
| Elapsed timer | ✅ (status text only) | ✅ | ✅ |
| How long it stays | 24/7, no browser needed | while the Activity panel is open | while the companion runs |
| Extra download | none | **none** | one launcher file |

Discord renders **only `name`, `type` and `state`** for bot accounts — images and
buttons are stripped by the gateway. That is a Discord restriction, not a bug
here. So photos and buttons are delivered by the **in-Discord app**: a Discord
Activity, i.e. a web page Discord loads inside the client and lets talk to the
local user. Nothing to install, nothing to keep running beyond the window itself.

The dashboard can target the bot card, your own profile, or both. The companion
under *Advanced* does the same job from your own machine for people who would
rather not open the Activity.

---

## Setup

> **Every setup step lives in one file: [`docs/setup.md`](docs/setup.md).**
> It walks from an empty Discord account to a card on your own profile — the
> Discord application, three free hosting paths, the wizard, the editor, the
> in-Discord app, 24/7, updates, backups, security, every environment variable
> and the troubleshooting table. Any running instance serves the same file at
> **`/guide`**, so the repository and the website can never disagree.

| You want to… | Read |
| --- | --- |
| understand what the thing does | [`§1`](docs/setup.md#1-what-the-user-gets) · [`§2`](docs/setup.md#2-what-the-developer-gets) |
| pick a free host | [`§3`](docs/setup.md#3-which-free-stack-to-pick) |
| create the Discord application (ID, secret, bot token, Activities) | [`§4`](docs/setup.md#4-step-1-the-discord-application) |
| deploy on Render (fastest, no card) | [`§5`](docs/setup.md#5-step-2-path-a-render) |
| deploy on Oracle Always Free (permanent) | [`§6`](docs/setup.md#6-step-3-path-b-oracle-always-free) |
| run it on your own PC / Raspberry Pi | [`§7`](docs/setup.md#7-step-4-path-c-your-own-pc-or-pi) |
| finish the first boot and the wizard | [`§8`](docs/setup.md#8-step-5-first-boot-and-the-wizard) |
| design the card and publish it | [`§9`](docs/setup.md#9-step-6-design-and-publish-the-card) |
| put it on your own profile (no install) | [`§10`](docs/setup.md#10-step-7-on-your-own-profile-no-install) |
| keep the bot online 24/7 | [`§11`](docs/setup.md#11-step-8-the-bot-card-always-online) |
| publish a share card | [`§12`](docs/setup.md#12-step-9-the-share-card-optional) |
| use the optional companion instead | [`§13`](docs/setup.md#13-step-10-the-optional-companion) |
| verify the install | [`§14`](docs/setup.md#14-step-11-verify-the-whole-install) |
| update, back up, move hosts | [`§15`](docs/setup.md#15-step-12-updates-and-backups) |
| rotate keys and lock down access | [`§16`](docs/setup.md#16-step-13-security-and-rotation) |
| look up an environment variable | [`§17`](docs/setup.md#17-environment-variables) |
| fix a problem | [`§20`](docs/setup.md#20-troubleshooting) |

Just want it on localhost to poke at it?

```sh
npm ci
npm start          # http://localhost:3000 → the setup wizard
```

Requirements: Node.js 20+ (22 LTS recommended). Photos need a public HTTPS URL
(Discord refuses `http://` and `localhost`), which matters even locally — see
[`§7`](docs/setup.md#7-step-4-path-c-your-own-pc-or-pi).

---

## The editor

Everything that reaches Discord is edited on one screen:

- **Templates** — ten starting points (“Focus mode”, “Listening”, “Building” …).
  A click fills the form; the photo and target choices you already made survive.
- **Photos inline** — drag a file onto a slot, paste a screenshot with `Ctrl`/`Cmd`
  `+ V`, pick a file, or press **Reuse** to pull one from the library. The photo
  slots sit in the same form as the text and the buttons.
- **Draft → Publish** — every edit is staged and autosaved as a *draft*, and
  nothing reaches Discord until you press **Publish**. **Discard draft** puts the
  live card back. A half-typed line never appears on your profile.
- **Faithful preview** — dark and light theme, full and compact card, because
  Discord renders both and they do not look the same.
- **Share card** — one button publishes `/c/<slug>`, a read-only page with
  `Open Graph` tags, so the card unfurls with its photo when posted anywhere.
  Rotate the slug or switch it off whenever you like.

---

## 24/7 online

The bot lives on the server, so it is online as long as the server is:

- **Built-in keep-alive:** set your public URL under **Bot & 24/7** and StatusC0rd
  pings its own `/health` every N minutes (min 5) to generate the inbound traffic
  that keeps a free instance awake. The dashboard shows the last successful ping.
- **Free web services sleep.** Render spins down after 15 minutes of no traffic,
  which drops the gateway connection; the keep-alive is what prevents that.
- **Self-hosted:** a normal always-on process — the bot reconnects with
  exponential backoff after network blips and Discord restarts.

---

## Routes

| Route | Who it is for |
| --- | --- |
| `/activity/` | the in-Discord app — Discord loads this inside the client (no install) |
| `/welcome` | anyone — what StatusC0rd does |
| `/guide` | anyone — the complete setup guide, rendered from `docs/setup.md` |
| `/setup` | the operator, on first boot, for the three-step wizard |
| `/` | the signed-in dashboard |
| `/c/<slug>` | the optional public share card |

---

## HTTP API

Session cookie + `x-csrf-token` for mutations. Companion endpoints use a
`Authorization: Bearer <pairing token>` header instead.

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Public liveness only (`status`, `uptimeSeconds`) |
| `GET` | `/api/health` | Full operator report (version, storage, bot, activity) — session required |
| `GET` | `/setup` | Setup wizard |
| `POST` | `/api/setup/verify` | Unlock setup with the setup token |
| `POST` | `/api/setup/asset` | Upload a photo during setup |
| `POST` | `/api/setup/test-bot` | Validate a bot token |
| `POST` | `/api/setup/complete` | Save key + bot + first presence, sign in |
| `GET` | `/login`, `POST /login`, `POST /logout` | Dashboard session |
| `GET` | `/auth/discord`, `/auth/discord/callback` | Optional Discord sign-in |
| `GET` | `/` | Dashboard |
| `GET` | `/welcome` | Marketing page (no session) |
| `GET` | `/guide` | This setup guide, rendered from `docs/setup.md` |
| `GET` | `/activity` | Redirects to the in-Discord app shell at `/activity/` |
| `GET` | `/api/setup/status` | What the wizard should show (needs setup, token required, managed values) |
| `GET` | `/api/state` | Presence, bot, photos, devices, keep-alive, meta |
| `GET` | `/api/presence` | Fully resolved presence, with photo URLs |
| `POST` | `/api/presence` | Validate + save + apply (bot and/or companion) |
| `POST` | `/api/presence/draft` | Stage edits without publishing |
| `POST` | `/api/presence/publish` | Publish the stored draft (or the posted body) |
| `DELETE` | `/api/presence/draft` | Discard the draft |
| `POST` | `/api/templates/:id` | Merge a template into the current config |
| `POST` | `/api/share` | Create or rotate the public card slug (optional `slug` body field) |
| `DELETE` | `/api/share` | Switch the public card off |
| `GET` | `/c/:slug` | Public read-only card with Open Graph tags |
| `POST` | `/api/presence/clear` | Clear everywhere |
| `GET` | `/api/events` | SSE stream of state changes |
| `GET`/`POST` | `/api/assets` | List / upload photos |
| `DELETE` | `/api/assets/:id` | Delete a photo |
| `GET`/`POST` | `/api/settings` | Read / update settings, rotate the key |
| `POST` | `/api/companion/pairings` | Create a device pairing (returns the command) |
| `DELETE` | `/api/companion/pairings/:id` | Revoke a device |
| `GET` | `/companion.js?pair=…` | Personalized companion script |
| `GET` | `/companion/start.:ext` | `.command` / `.sh` / `.bat` launcher for a pairing |
| `GET` | `/companion/start-mac.zip` | The macOS launcher, zipped so it stays executable |
| `GET` | `/api/companion/config` | Presence payload for the companion (ETag) |
| `POST` | `/api/companion/heartbeat` | Device status + presence confirmation |
| `GET` | `/assets/:hash.:ext` | Public photo, `Access-Control-Allow-Origin: *` (used by Discord) |

`GET /favicon.ico` redirects to the SVG icon. Presence payload: `name`, `type`
(0–5), `status`, `details`, `state`, `url`,
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
  `COOP`/`CORP`, HSTS in production, no framing of the dashboard in production
  (the Activity page alone allows Discord as its frame ancestor).
- Setup cannot be claimed remotely without the one-time setup token.
- Uploads are sniffed by magic bytes, size-capped (2 MB) and re-served from
  content-hashed filenames; only the image types Discord accepts are stored.
- Pairing tokens are hashed at rest and revocable; each device is independent.
- `/health` answers `{"status":"ok"}` to anyone and nothing more — version,
  storage state, bot status and the Activity session stay behind the session at
  `/api/health`.
- The public card `/c/<slug>` is opt-in, carries a random slug, exposes only the
  presence fields, and dies the moment sharing is switched off.
- Atomic `0600` writes with corrupt-file recovery; presence updates are coalesced
  to respect Discord's rate limits.

---

## Development

```sh
npm run dev    # node --watch
npm run check  # parse every source file
npm test       # 135 tests (node:test only)
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
src/activity.js        the in-Discord app's server half (code exchange, payload)
src/oauth.js           Discord OAuth2 (identify) with timeouts
src/auth.js            constant-time compare, CSRF, rate limiters
src/views.js           tiny auto-escaping `{{TOKEN}}` renderer
src/companion/agent.js the companion (also served as a personalized script)
views/                 setup, dashboard, login, welcome, guide, card, activity
public/                styles, dashboard JS, setup JS, upload helper, activity app
docs/setup.md          the one setup document (also served at /guide)
test/                  node:test suites (presence, settings, assets, bot,
                       keepalive, companion IPC, HTTP integration)
```

The tests inject a fake bot and a temporary data directory, and the companion
suite runs a real UNIX-socket server that emulates Discord's IPC handshake.

---

## License

No license file is included; all rights reserved by the repository owner.
