# StatusC0rd

Set your own Discord rich presence from a web page: text, photos, buttons and a
live timer — plus a bot that keeps a card online 24/7.

> **The full setup is in [SETUP.md](SETUP.md).** Every step, from creating the
> Discord application to putting the website online for free, with the catches of
> each free host. This README is the overview.

```
Browser ──HTTPS──▶ StatusC0rd server
                     ├─▶ /assets/<id>.png  → photos Discord can fetch
                     ├─▶ Discord Activity  → your own profile (photos + buttons)
                     └─▶ Discord gateway   → the bot card, always online
```

Two things, nothing else: **a website to build the card**, and **a bot to keep a
card online**.

---

## What it does

| | Bot card | Your profile — in-Discord app |
| --- | --- | --- |
| Who shows it | the bot account | your own Discord account |
| Name, type, state | ✅ | ✅ |
| Details / second line | ⚠️ gateway is limited | ✅ |
| **Photos** | ❌ Discord drops images for bots | ✅ |
| Buttons | ❌ | ✅ |
| Elapsed timer | ✅ | ✅ |
| How long it stays | 24/7, no browser needed | while the panel is open |
| Extra download | none | **none** |

Discord renders **only name, type and state** for bot accounts, so photos and
buttons can only reach a *user's* profile — that is what the in-Discord app is
for. Nothing is installed: Discord opens the page, the page talks to the local
client, and your card appears.

---

## Accounts

One instance, many people, one card each.

- **The owner** holds the dashboard key. That key opens the admin panel: the
  Discord application, the bot, and the member list.
- **Everyone else** signs up at `/register` with an email and a password, builds
  their own card, and connects their Discord account once. Their card goes to
  their profile; it can never touch the bot or anyone else's card.
- Sign-ups can be closed from **Members**, and accounts can be created by hand.

No email is sent by this build: the address is a login, not a mailbox. The owner
resets passwords and hands them over.

---

## Run it locally

Needs Node 20+.

```sh
npm ci
npm start          # http://localhost:3000
```

The first visit serves a three-step wizard: dashboard key, Discord application,
first card. Everything afterwards is configured from the dashboard.

> A local instance is enough to build cards, but Discord cannot fetch photos from
> `localhost` and the Activity needs a public HTTPS URL. For a real deployment,
> follow [SETUP.md](SETUP.md).

---

## Deploy free

The shortest path is **Render's free tier**: fork this repository, then
<https://dashboard.render.com> → **New +** → **Blueprint** → pick the fork.
`render.yaml` supplies Node 22, `npm ci`, `npm start` and the `/health` check.
Set `PUBLIC_URL`, `CLIENT_ID`, `CLIENT_SECRET` and optionally `DISCORD_TOKEN` and
`DASHBOARD_KEY` in the environment — they survive a restart, the disk does not.

Oracle Always Free and GCP's e2-micro also work, and both give you a real disk.
[SETUP.md § 3 and Part 2](SETUP.md#3-what-is-free-and-what-is-not) has the
step-by-step for each, the free-tier catches, and the HTTPS setup.

**The bot can live elsewhere.** A free web host sleeps, and a sleeping process has
no Discord connection — so the 24/7 card dies with it. Run the same repo a second
time on any small always-on box with `BOT_WORKER=1`, `BOT_URL` and a shared
`BOT_WORKER_TOKEN`, and it holds only the gateway: it reads the card from the
website every ten seconds and reports back, so the dashboard still shows the
truth. `docker-compose.yml` runs both halves from this one repository if you prefer one
command. Details in [SETUP.md 6.5](SETUP.md#65-hosting-the-bot-on-a-different-machine).

---

## Environment

Everything is optional; the wizard writes the same values to `data/settings.json`
and the environment wins when both exist.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | `settings.json`, `assets/`, setup token |
| `PUBLIC_URL` | unset | public origin for photo URLs and the keep-alive |
| `CLIENT_ID` | unset | Discord application ID (public) |
| `CLIENT_SECRET` | unset | OAuth2 secret; the in-Discord app needs it |
| `DISCORD_TOKEN` | unset | bot token for the 24/7 card |
| `DASHBOARD_KEY` | unset | the owner's key; setting it skips the wizard |
| `SESSION_SECRET` | generated | cookie signing key, 32+ characters |
| `ALLOWED_DISCORD_IDS` | unset | who may sign in with Discord / launch the app |
| `KEEP_ALIVE` | `true` | keep this host awake (`PUBLIC_URL` required) |
| `KEEP_ALIVE_INTERVAL_MINUTES` | `10` | ping interval, 5–60 |
| `BOT_ENABLED` | on with a token | `false` runs without a gateway |
| `BOT_WORKER` | unset | `1` = this process is the Discord-only worker |
| `BOT_URL` | unset | the website a worker reads its card from |
| `BOT_WORKER_TOKEN` | unset | shared secret for `/api/bot/*`; enables split hosting |
| `LOG_REQUESTS` | on | one line per page/API request; `0` silences it |

The complete table — including `BOT_POLL_SECONDS`, `SETUP_TOKEN`,
`SETUP_REQUIRE_TOKEN`, `REDIRECT_URI` and `TRUST_PROXY` — is [Part 12 of SETUP.md](SETUP.md#part-12-every-setting-and-environment-variable).

---

## Routes

| Method | Route | What |
| --- | --- | --- |
| `GET` | `/` | the front page when signed out; the dashboard when signed in |
| `GET` | `/setup` | first-run wizard |
| `GET`/`POST` | `/login`, `/register`, `POST /logout` | sign in and sign up |
| `GET` | `/auth/discord`, `/auth/discord/link`, `/auth/discord/callback` | Discord sign-in and account linking |
| `GET` | `/activity/` | the in-Discord app (photos + buttons) |
| `GET` | `/c/:handle` | a member's public card page — private until published |
| `POST` | `/api/card` | handle and publish switch for that page |
| `GET` | `/api/bot/card` | the owner's card for a separately hosted bot (token-gated) |
| `POST` | `/api/bot/status` | the worker's connection report |
| `GET` | `/assets/:hash.:ext` | uploaded photos, cached for a year |
| `GET` | `/health` | `{"status":"ok"}` and nothing else |
| `POST` | `/api/presence`, `/api/presence/publish`, `/api/presence/draft`, `/api/presence/clear` | the card |
| `GET`/`POST`/`DELETE` | `/api/assets` | the photo library |
| `GET`/`POST` | `/api/settings` | instance configuration (owner) |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/admin/users` | member accounts (owner) |
| `GET` | `/api/state`, `/api/events` | the dashboard's state and its SSE stream |

Everything except `GET /health`, `/assets/*`, `/activity/*` and the auth pages
needs a session; every write also needs the CSRF token from `/api/state`.
[Part 15 of SETUP.md](SETUP.md#part-15-appendix-every-route) lists every route.

---

## Tests

```sh
npm test           # node:test, no network, no Discord credentials
```

Covers the rules that break silently: card validation, the one-card-per-account
store, upload sniffing and limits, key hashing, rate limiters, the keep-alive,
public card handles, and the bot worker's polling, backing off and reporting.
`SETUP.md` Part 10 has the pre-deploy checklist.

---

## Security

- scrypt-hashed dashboard key and member passwords; both compared in constant
  time, five failures per IP locks sign-in for 15 minutes.
- Signed `HttpOnly`, `SameSite=Lax` cookies, `Secure` in production; CSRF
  double-submit on every write (header or form field — never the query string);
  OAuth state is random, single-use, 10 minutes.
- Each member's card, photos and Discord link are isolated on the server: a
  member cannot write the bot's presence or read another account's data, whether
  or not the UI shows the button.
- One owner: accounts are always members and the admin API refuses a role
  change, so the dashboard key is the only way into the admin panel.
- Uploads are sniffed by magic bytes, capped at 2 MB, and re-served from
  content-hashed filenames. Every format's true dimensions are read before the
  file is stored (16×16 to 4096×4096), and each account may keep 60 photos /
  30 MB with a 500 MB ceiling for the instance.
- A card may only reference photos its own account uploaded, and deleting a
  photo clears it from the card that used it.
- Each account can share its card at `/c/<handle>`; the page is private until
  the owner switches it on, exposes nothing but the card itself, and disappears
  with the account.
- Setup cannot be claimed remotely without the one-time setup token, and it runs
  once — afterwards the endpoint refuses to run again.

---

## Layout

```
index.js            boot: env, store, bot, keep-alive, HTTP server
app.js              routes and middleware
src/presence.js     the card model, validation, Discord payloads
src/settings.js     accounts, per-user cards, photos, the store
src/bot.js          the 24/7 gateway presence
src/worker.js       split hosting: the bot alone, reading its card over HTTP
docker-compose.yml  both halves, one command
src/activity.js     the in-Discord app's auth and config
src/assets.js       uploads
views/              server-rendered pages
public/             dashboard, login, register, setup, activity assets
```
