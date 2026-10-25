# StatusC0rd

Set up a Discord rich presence from your browser: text, photos, buttons and a
live timer — then keep it online 24/7.

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

> **Four files, one product.** Every setup step lives in `docs/`, split by *where
> the server runs* — the only part that actually differs.
>
> | File | Covers |
> | --- | --- |
> | [`docs/setup.md`](docs/setup.md) | the shared steps: the Discord application, the wizard, the editor, your profile, the 24/7 bot, verification, security, environment variables, troubleshooting |
> | [`docs/setup-local.md`](docs/setup-local.md) | your own PC, Mac or Raspberry Pi, start to finish — including the tunnel that gives you a public HTTPS URL |
> | [`docs/setup-cloud.md`](docs/setup-cloud.md) | a VPS or managed platform you pay for: DNS, firewall, systemd, Caddy, Docker, backups |
> | [`docs/setup-free-cloud.md`](docs/setup-free-cloud.md) | Render free tier, Oracle Always Free, GCP free tier — with the catch of each |
>
> Any running instance serves these same files at **`/guide`**, **`/guide/local`**,
> **`/guide/cloud`** and **`/guide/free-cloud`**, so the repository, GitHub and
> the website can never disagree.

| You want to… | Read |
| --- | --- |
| understand what the thing does | [`§1`](docs/setup.md#1-what-the-user-gets) · [`§2`](docs/setup.md#2-what-the-developer-gets) |
| choose where it will run | [`§3`](docs/setup.md#3-pick-where-it-runs) |
| create the Discord application (ID, secret, bot token, Activities, URL mapping) | [`§4`](docs/setup.md#4-step-1-the-discord-application) |
| run it on your own computer, Mac or Pi | [`local §1`](docs/setup-local.md#1-what-you-need) |
| get a public HTTPS URL from a home machine | [`local §4`](docs/setup-local.md#4-a-public-https-url) |
| keep it alive after logout / reboot | [`local §7`](docs/setup-local.md#7-keep-it-running-after-logout-and-reboot) |
| deploy on a VPS with your own domain | [`cloud §2`](docs/setup-cloud.md#2-create-the-server) |
| deploy on Render free (fastest, no card) | [`free §2`](docs/setup-free-cloud.md#2-path-a-render-free) |
| deploy on Oracle Always Free (permanent) | [`free §3`](docs/setup-free-cloud.md#3-path-b-oracle-always-free) |
| deploy on GCP Always Free | [`free §4`](docs/setup-free-cloud.md#4-path-c-gcp-always-free-e2-micro) |
| finish the first boot and the wizard | [`§6`](docs/setup.md#6-step-3-first-boot-and-the-wizard) |
| design the card and publish it | [`§7`](docs/setup.md#7-step-4-design-and-publish-the-card) |
| put it on your own profile (no install) | [`§8`](docs/setup.md#8-step-5-on-your-own-profile-no-install) |
| keep the bot online 24/7 | [`§9`](docs/setup.md#9-step-6-the-bot-card-always-online) |
| publish a share card | [`§10`](docs/setup.md#10-step-7-the-share-card-optional) |
| use the optional companion instead | [`§11`](docs/setup.md#11-step-8-the-optional-companion) |
| verify the install | [`§12`](docs/setup.md#12-step-9-verify-the-whole-install) |
| update, back up, move hosts | [`§13`](docs/setup.md#13-step-10-updates-and-backups) |
| rotate keys and lock down access | [`§14`](docs/setup.md#14-step-11-security-and-rotation) |
| look up an environment variable | [`§15`](docs/setup.md#15-environment-variables) |
| fix a problem | [`§18`](docs/setup.md#18-troubleshooting) |

Just want it on localhost to poke at it?

```sh
npm ci
npm start          # http://localhost:3000 → the setup wizard
```

Requirements: Node.js 20+ (22 LTS recommended). Photos need a public HTTPS URL
(Discord refuses `http://` and `localhost`), which matters even locally — see
[`local §4`](docs/setup-local.md#4-a-public-https-url).

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

The bot lives on the server, so its card is online as long as the server is. It
reconnects with exponential backoff after network blips and Discord restarts, and
the built-in keep-alive makes a sleeping free instance look busy so it is not
spun down. How to turn that on — and how to keep the process running on each kind
of host — is [`§9`](docs/setup.md#9-step-6-the-bot-card-always-online).

---

## Routes

| Route | Who it is for |
| --- | --- |
| `/activity/` | the in-Discord app — Discord loads this inside the client (no install) |
| `/welcome` | anyone — what StatusC0rd does |
| `/guide` | anyone — the setup docs, rendered from `docs/*.md` (`/guide/local`, `/guide/cloud`, `/guide/free-cloud`) |
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
| `GET` | `/guide`, `/guide/:slug` | The setup docs, rendered from `docs/*.md` (`local`, `cloud`, `free-cloud`) |
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
npm ci         # once
npm start      # http://localhost:3000
```

No build step, no transpiler, no test harness to install: the whole app is plain
CommonJS plus a browser script. `node --watch index.js` if you want a reload on
save.

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
src/guide.js           serves docs/*.md at /guide, /guide/local, /guide/cloud,
                       /guide/free-cloud
src/markdown.js        the small Markdown subset those files are written in
src/companion/agent.js the companion (also served as a personalized script)
views/                 setup, dashboard, login, welcome, guide, card, activity
public/                styles, dashboard JS, setup JS, upload helper, activity app
docs/                  the four guides (also served at /guide, /guide/local,
                       /guide/cloud, /guide/free-cloud)
```

---

## License

No license file is included; all rights reserved by the repository owner.
