# The setup guide

> **One product, four documents.** Everything that is the same wherever you run
> StatusC0rd lives here. The part that differs — *where the server actually
> runs* — has its own start-to-finish file:
>
> - [**Your own computer**](setup-local.md) — a PC, a Mac or a Raspberry Pi.
> - [**Cloud server**](setup-cloud.md) — a VPS or managed platform you pay for.
> - [**Free cloud**](setup-free-cloud.md) — Render free tier, Oracle Always Free,
>   GCP free tier.
>
> Every running instance serves these same files at **`/guide`** (and
> `/guide/local`, `/guide/cloud`, `/guide/free-cloud`). Edit a Markdown file once
> and the repository, GitHub and the website all show the update.

**Read this page for:** the Discord application, the wizard, the dashboard tab by
tab, going live on your profile, the 24/7 bot card, verification, security,
environment variables and troubleshooting.

**Read a path file for:** creating the machine, installing Node or Docker,
HTTPS, keeping it running, updating and backing up *that* kind of host.

| You are | Path file | Time |
| --- | --- | --- |
| Running it on your own machine | [setup-local.md](setup-local.md) | ~15 min |
| Renting a cloud server | [setup-cloud.md](setup-cloud.md) | ~30 min |
| Wanting free hosting | [setup-free-cloud.md](setup-free-cloud.md) | 10–60 min |

**Before you start:** [what the user gets](#1-what-the-user-gets) ·
[the developer view](#2-what-the-developer-gets) ·
[pick a host](#3-pick-where-it-runs) ·
[the Discord application](#4-step-1-the-discord-application)

**Go live:** [first boot](#6-step-3-first-boot-and-the-wizard) ·
[the dashboard, tab by tab](#7-the-dashboard-tab-by-tab) ·
[design and publish](#8-step-4-design-and-publish-the-card) ·
[your own profile](#9-step-5-on-your-own-profile-no-install) ·
[24/7 bot card](#10-step-6-the-bot-card-always-online) ·
[share card](#11-step-7-the-share-card-optional) ·
[companion](#12-step-8-the-optional-companion)

**Look after it:** [verify](#13-step-9-verify-the-whole-install) ·
[update and back up](#14-step-10-updates-and-backups) ·
[security](#15-step-11-security-and-rotation) ·
[environment variables](#16-environment-variables) ·
[limits](#18-limits-worth-knowing) ·
[troubleshooting](#19-troubleshooting) ·
[the checklist](#20-all-in-one-checklist)

**Reference:** [every URL and every response](#21-appendix-every-url-and-every-response) —
the full page and JSON surface, status codes, error shapes and rate limits.

---

## 1. What the user gets

Discord shows two different things, and StatusC0rd fills both:

| | **Bot card** (always on) | **Your own profile** (rich) |
| --- | --- | --- |
| Shows | activity name, type, one line of text | large + small photo, hover texts, details, state, **two buttons**, timer |
| Runs on | your server, 24/7 | the Discord client itself, as a web Activity |
| Needs a download | no | **no** |
| Setup | a bot token in the wizard | click **Open in Discord** once |
| Editable from | the dashboard | the dashboard, no restart, no rejoin |

Why the split: Discord's bot gateway only accepts `name`, `type` and `state` for
presence, so photos and buttons are impossible on a bot card. For *your own*
profile they exist, but only a Discord client may set them. There are two ways to
be that client, and StatusC0rd ships both:

- **The in-Discord app — default, zero install.** StatusC0rd is also a Discord
  Activity: a web page Discord loads *inside* the client. It asks for the
  `identify` and `rpc.activities.write` scopes and pushes your saved card to your
  profile while the panel is open. Works on desktop, web and mobile.
- **The optional companion.** A ~700-line Node script that talks to the local
  Discord socket. Nothing to enable inside Discord, but it has to be installed
  and kept running. Only worth it if you want the presence without opening a
  panel — see §12.

### The user's five minutes

1. Open the site → sign in with the dashboard key (or **Continue with Discord**
   if the operator enabled it).
2. **Presence** tab → pick a template or type it: name, type, status, two lines,
   optional timer. Drag or paste a photo into the large/small slots, add up to
   two buttons (label + `https://` URL). The preview mirrors Discord, including
   its light theme and compact card.
3. **Publish.** The bot card updates within a second and stays up 24/7 if the
   operator added a bot token. Nothing reaches Discord before you publish — edits
   are autosaved as a *draft*, and **Discard draft** puts the live card back.
4. **My profile** tab → **Open in Discord** (or StatusC0rd from Discord's app
   launcher). A panel opens inside Discord showing the same card; the badge
   flips to **Profile live**.
5. The same card, with photos and buttons, is now on your own profile. Dashboard
   edits arrive in about 5 seconds without rejoining. Closing the panel clears
   the card instead of leaving a stale one behind.
6. Optional: **Share card** publishes `/c/<slug>` — a read-only page with the
   same card and proper link previews for bios, READMEs and servers. Rotate or
   switch it off at any time.

---

## 2. What the developer gets

```
Browser ──HTTPS──▶ your host (this repo, Node 20+)
                     ├─▶ Discord gateway     → bot card, 24/7, auto-reconnect
                     ├─▶ /assets/<id>.<ext>  → the photos Discord downloads
                     ├─▶ /health             → health check + keep-alive target
                     ├─▶ /activity/          → the in-Discord app (no install)
                     └─▶ companion (opt.)    → same card without the Activity
```

- `index.js` boots the settings store, the bot, the keep-alive and the HTTP server,
  then prints the banner (and the setup token on a first run).
- `app.js` is the whole HTTP surface: views, auth, presence CRUD, photo upload,
  pairings, launcher downloads, the generated companion script. §21 lists every
  route it mounts.
- `src/activity.js` is the server half of the in-Discord app: it exchanges the
  Activity's OAuth2 code (the client secret never reaches the browser), verifies
  who is asking, and shapes the saved presence into a `setActivity` payload.
- `src/companion/agent.js` is the optional companion, served at `/companion.js`
  with the device's config prepended; it speaks Discord's IPC protocol directly,
  with no extra dependencies. The app itself never loads it.
- `src/guide.js` renders `docs/*.md` for `/guide`, so the docs and the site are
  the same bytes.
- `data/` holds `settings.json` (mode `0600`), `assets/` and `setup-token.txt`.
  `DATA_DIR` moves it. **That directory is the deployment's state.**

Every file, so nothing is a mystery later:

| Path | What it does |
| --- | --- |
| `index.js` | boot, banner, graceful shutdown (10 s budget) |
| `app.js` | Express app: pages, session, API, companion endpoints, error pages |
| `src/settings.js` | `settings.json` store, scrypt dashboard key, assets list, device pairings, env overrides |
| `src/env.js` | reads `process.env`, warns about malformed values, never throws |
| `src/auth.js` | constant-time compare, CSRF, `RateLimiter`, `LoginLimiter`, client key |
| `src/presence.js` | the presence model, every validation rule, per-target `buildActivity()` |
| `src/bot.js` | gateway connection, reconnect backoff, rate-limited presence queue |
| `src/keepalive.js` | the self-ping loop, 5-minute floor, 10 s timeout |
| `src/assets.js` | magic-byte sniffing, size and dimension limits, hashed files, prune |
| `src/activity.js` | the in-Discord app's server half: code exchange, identity, payload |
| `src/oauth.js` | Discord OAuth2 (`identify`) with request timeouts |
| `src/templates.js` | the ten starting points and how a template merges |
| `src/guide.js` | finds and renders `docs/*.md`; the `/guide` tab strip |
| `src/markdown.js` | the Markdown subset the docs are written in |
| `src/views.js` | auto-escaping `{{TOKEN}}` renderer, `escapeHtml` |
| `src/zip.js` | a minimal stored-zip writer for the macOS launcher |
| `src/companion/agent.js` | the companion: IPC, polling, heartbeat, shutdown |
| `views/*.html` | setup, dashboard, login, welcome, guide, card, activity, error |
| `public/*` | styles, dashboard JS, setup JS, login JS, upload helper, activity app |
| `docs/*.md` | these four documents; the site serves them verbatim |

There is no build step: `npm ci` once, `npm start` after that. To change what
Discord shows, edit `src/presence.js` (validation and limits) or a file in
`views/`; to change what this page says, edit `docs/setup.md`.

---

## 3. Pick where it runs

Everything below is genuinely usable, and the two free options are genuinely
free. "Best" depends on what you want to trade.

| | **Your own computer** | **Cloud server** | **Free cloud** |
| --- | --- | --- | --- |
| Guide | [Local setup](setup-local.md) | [Cloud setup](setup-cloud.md) | [Free-cloud setup](setup-free-cloud.md) |
| Cost | $0 (plus your electricity) | ~$4–6/month | **$0** |
| Time to first URL | ~15 min | ~30 min | 10–60 min |
| Always on | only while the machine is awake | yes | yes, with caveats: Render free sleeps, Oracle stays up |
| Disk | your disk, persistent | 20–80 GB, persistent | Render free is **ephemeral**; Oracle gives 200 GB persistent |
| HTTPS | a tunnel (Cloudflare), no router changes | Caddy + Let's Encrypt | included on Render; Caddy on Oracle |
| Stable URL | only with a named tunnel or DuckDNS | yes, your domain | Render: yes, `*.onrender.com`. Oracle: DuckDNS or your domain |
| Best for | trying it, a Raspberry Pi, a home lab | "set it once, forget it", several users | trying it today, free forever |

**Recommendation**

- Just want to see it working today, and a sleeping instance is fine →
  [free cloud, Path A (Render)](setup-free-cloud.md#2-path-a-render-free).
- Want free and permanent, with photos that never vanish →
  [free cloud, Path B (Oracle)](setup-free-cloud.md#3-path-b-oracle-always-free).
- Already have a machine that is on all day →
  [your own computer](setup-local.md).
- Want a proper server with your own domain and no free-tier surprises →
  [cloud server](setup-cloud.md).

Not recommended: **Vercel**, **Netlify** and other serverless hosts — no
long-running process, no writable disk, no SSE, so the bot is simply offline.
**Fly.io**, **Koyeb** and **Railway** no longer have a free tier for new
accounts; they work fine as paid hosts and are covered in the cloud file.

Whatever you pick, the end state is the same four things:

1. An `https://` URL that reaches the app from the internet.
2. `PUBLIC_URL` set to exactly that origin (photos and keep-alive need it).
3. A writable `data/` directory that survives restarts, or the same values in
   the environment instead — the wizard and the environment write the same
   settings, and the environment wins (§16).
4. A process that starts again after a reboot.

---

## 4. Step 1: the Discord application

You are collecting **four values**. Three are required-ish, one is optional. This
step is identical for every host, so do it first.

### 4.1 Create the application

1. Open <https://discord.com/developers/applications> and sign in.
2. **New Application** → give it a name (this is also the default activity name;
   you can change the card name later in the dashboard).
3. Accept the terms.

### 4.2 Copy the Application ID (this is `CLIENT_ID`)

**General Information → Application ID** — a long number such as
`123456789012345678`. Copy it.

It is public, not a secret. It appears in the invite link and in the in-Discord
app's launch URL, and StatusC0rd needs it for both.

> The **Public Key** on the same page is for HTTP interactions. StatusC0rd does
> not use it — ignore it.

### 4.3 Copy the Client Secret (this is `CLIENT_SECRET`)

**OAuth2 → General → Client Secret → Reset Secret** (or *Copy*). Treat it like a
password: it is what lets *your server* finish the Discord sign-in for the
in-Discord app on the user's behalf.

Resetting the secret invalidates the old one, so if you reset it later, paste the
new value into the dashboard again (§15.3).

### 4.4 Copy the bot token (this is `DISCORD_TOKEN`, optional)

Only needed for the card that stays online 24/7 while nobody is around.

**Bot → Reset Token → Copy.** Discord shows it exactly once. If you lose it,
reset it again and update the dashboard.

Then, on the same page:

- **Public Bot** → turn **off** unless you actually want strangers inviting it.
- **Privileged Gateway Intents** → leave **all three off**. StatusC0rd only needs
  the `Guilds` intent, which is not privileged.
- **Requires OAuth2 Code Grant** → leave off.

### 4.5 Enable the in-Discord app (five clicks, once)

This is the part that puts photos and buttons on a profile with nothing
installed. It needs your public URL, so do it after the host exists — or do it
now and fix the URL afterwards.

1. **Activities → Settings** → tick **Enable Activities**. Discord registers the
   `Launch` entry-point command for you.
2. **Activities → URL Mappings** → add a mapping with prefix **`/`** and target
   **`https://YOUR-HOST/activity/`**. Keep the trailing slash: the page uses
   relative URLs (`./api/token`).
3. Nothing else is needed here — the client secret from §4.3 is already the
   server-side half of the handshake.

### 4.6 Install the app so the launcher knows about it

Presence-on-profile does not require the bot to be in a server, but the **App
Launcher** entry and `/launch` do, and they need the commands scope:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=0
```

Open that URL, pick a server you own, authorise. The dashboard also shows a
ready-made invite link with the bot scope under **Bot & 24/7** (it is hidden when
no application ID is configured, because a `client_id=` with no value is a dead
page).

> If you only want the in-Discord app and no bot presence at all, use
> `&scope=applications.commands` and untick **The bot** in the presence targets.

### 4.7 Optional — sign in to the dashboard with Discord

Instead of typing the dashboard key, an allowlisted Discord account can sign in
with one click.

1. **OAuth2 → Redirects** → add `https://YOUR-HOST/auth/discord/callback`.
2. In the dashboard: **Settings → Discord sign-in** → paste the client secret and
   your Discord **user ID** (Discord → Settings → Advanced → Developer Mode →
   right click your name → *Copy User ID*). Separate several IDs with commas.
3. Sign out: the login page now offers **Continue with Discord**.

Anyone not on that allowlist is rejected, whatever their account. The dashboard
key keeps working, so you can never lock yourself out — unless `DASHBOARD_KEY` is
set in the environment, in which case that value is the only key.

### 4.8 What you should have before continuing

| Value | Where it came from | Secret? | Used for |
| --- | --- | --- | --- |
| Application ID | General Information | no | invite link, launch URL, RPC/Activity handshake |
| Client Secret | OAuth2 → General | **yes** | the server-side token exchange for the in-Discord app |
| Bot token | Bot → Reset Token | **yes** | the 24/7 text card (optional) |
| Your Discord user ID | right click your name | no | optional allowlist for Discord sign-in |

---

## 5. Step 2: deploy the app

Now pick exactly **one** of these and follow it start to finish. Each one takes
you from an empty account to a running instance with HTTPS and a URL:

| Host | File |
| --- | --- |
| Your PC, Mac or Raspberry Pi | [setup-local.md](setup-local.md) |
| A VPS you pay for (Hetzner, DigitalOcean, Linode, Vultr) | [setup-cloud.md](setup-cloud.md) |
| Render free tier | [setup-free-cloud.md](setup-free-cloud.md#2-path-a-render-free) |
| Oracle Always Free | [setup-free-cloud.md](setup-free-cloud.md#3-path-b-oracle-always-free) |
| GCP Always Free (e2-micro) | [setup-free-cloud.md](setup-free-cloud.md#4-path-c-gcp-always-free-e2-micro) |

Every path ends in the same place: the app is reachable at an `https://` URL and
`PUBLIC_URL` is set to that exact origin. Come back to §6 when it is.

> **The two values that matter most.** The wizard asks for an Application ID and
> an OAuth2 client secret; that pair alone is enough to put photos, text and
> buttons on your own profile through the in-Discord app. A bot token only adds
> the text card that stays online while you are away.

---

## 6. Step 3: first boot and the wizard

Open your URL. A fresh instance redirects everything to **`/setup`**, a three-step
wizard. Nothing is written to disk until you press **Finish setup**, and nothing
needs a restart afterwards.

### 6.1 Unlocking setup (only when it is reachable from the internet)

Loopback requests (`localhost`, `127.0.0.1`) may run the wizard directly. Anything
else must present the one-time setup token:

- it is printed in the server log at boot, and
- it is stored in `data/setup-token.txt` (mode `0600`),
- or set `SETUP_TOKEN` in the environment to fix your own value.

The unlock lasts 30 minutes. Once setup completes, the token is deleted and the
wizard answers *"Setup is already complete"* from the dashboard. Set
`SETUP_REQUIRE_TOKEN=1` to demand the token even on localhost.

One exception, in your favour: if a completed instance ever loses its dashboard
key (a hand-edited or half-restored `settings.json`), a fresh setup token is
generated on the next boot — see §15.1.

### 6.2 Step 1 — Account

- **Dashboard key** — 12 characters minimum. This is the only password that
  protects the operator side. Use **Generate a strong key** (it produces a long
  random key and reveals it once) or type your own; the field is `type=password`
  and the browser will offer to save it.
- **Repeat key** — must match.

The key is stored as a scrypt hash with a random salt. If you lose it you cannot
recover it; see §15.1.

### 6.3 Step 2 — Discord app

- **Application (client) ID** — from §4.2, digits only. Pasting spaces or the app
  *name* is the most common mistake; the field shows an inline hint if it looks
  wrong.
- **OAuth2 client secret** — from §4.3. It enables the in-Discord app (the token
  exchange happens server-side). You may skip it if you only want the bot card,
  but photos and buttons then have no way to reach your profile.
- Collapsed under **Optional · a bot card that stays online 24/7**:
  - **Bot token** — from §4.4. **Test bot connection** validates it against the
    Discord gateway before you save.
  - **Allow these Discord accounts to sign in without the key** — the optional
    allowlist from §4.7, plus the redirect URL you have to add in the portal.
- **Skip for now** is a real option: every value can be added later under
  **Settings**. It discards whatever is typed on this step, so use it only when
  you really want to leave both blank.

If a value is supplied by the environment (`CLIENT_ID`, `DISCORD_TOKEN`, …) the
matching field is disabled and shows the managed value — the environment always
wins.

**Test bot connection** logs a client in with the token you typed and prints the
account name on success; on failure it names the reason ("Discord rejected that
bot token" after a timeout or a 401). It changes nothing — the token is only
stored when you press **Continue** and **Finish setup**.

### 6.4 Step 3 — Presence

- **Activity name** (128 chars) — what Discord prints after "Playing".
- **Type** — Playing, Listening, Watching, Competing here; the dashboard editor
  adds Streaming (needs a Twitch or YouTube link) and Custom status (name only).
- **Status** — Online, Idle, Do not disturb, Invisible.
- **Details (line 1)** and **State (line 2)** — 128 chars each.
- **Large / small photo** — click the slot and pick a file. (Drag-and-drop and
  paste work in the dashboard editor, not in the wizard.) Photos are cropped to a
  square and downscaled in your browser before upload.
- **Keep this server awake** — the 24/7 keep-alive (§10). Leave it ticked; the
  wizard sets a 10-minute interval, changeable later under **Bot & 24/7**.
- **Public URL of this dashboard** — pre-filled with the address you are using.
  It must be the public `https://` origin; it is the base for photo URLs and the
  keep-alive target.

Press **Finish setup**. StatusC0rd saves the admin key, the Discord values, the
presence and the keep-alive settings, signs you in, and drops you on
**My profile** with the **Open in Discord** button in front of you.

> **The first presence targets itself.** *My own profile* is always on; *The bot*
> is ticked only if you gave a bot token, so a token-less setup never leaves a
> "bot" target waiting on a bot that does not exist. One checkbox on the
> **Presence** tab changes both, and so does `/api/presence`.

> **If `DASHBOARD_KEY` is set in the environment, this wizard never runs** — the
> instance counts as configured from the first boot. That is the right choice for
> hosts with an ephemeral disk, because it survives a wipe.

---

## 7. The dashboard, tab by tab

Everything is configured on the website; there is no config file to edit. This
section is the map of it — the pages, the top bar and the five tabs. The sections
after it are the walkthrough.

### 7.1 The pages the site serves

| Page | Who can open it | What it is |
| --- | --- | --- |
| `/welcome` | anyone | the two-minute overview, with links to the wizard and these docs |
| `/guide` | anyone | this document, plus `/guide/local`, `/guide/cloud`, `/guide/free-cloud` |
| `/setup` | the operator, first run only | the three-step wizard (§6) |
| `/login` | anyone | the dashboard key, or **Continue with Discord** when an allowlist is set (§15.4) |
| `/` | signed in | the dashboard described below |
| `/c/<slug>` | anyone holding the link | the optional public share card (§11) |
| `/activity/` | Discord, in its iframe | the in-Discord app that puts the card on your profile (§9) |
| `/health` | anyone | `{"status":"ok"}` and uptime, and nothing else |
| `/assets/<hash>.<ext>` | anyone | an uploaded photo, `Access-Control-Allow-Origin: *`, cached for a year |
| `/activity` | anyone | a 302 to `/activity/` — the trailing slash matters to Discord's proxy |
| `/favicon.ico` | anyone | a 302 to `/favicon.svg` |
| anything else | anyone | the 404 page (`/api/*` answers a JSON 404 instead) |

Before setup, every path redirects to `/setup`. After it, `/` needs a session and
sends you to `/login`; a session lasts 8 hours and then you sign in with the key
again. Dashboard pages are sent `no-store`, so a shared browser never keeps a
stale copy of your card.

The in-Discord app's JSON lives at `/activity/api/*` and is mounted a second time
at `/api/activity/*`; both answer the same thing, so the page works whether
Discord proxies it or you open it directly. §21 has every route.

### 7.2 The top bar

- **Brand and version** — the version this instance is running, the same number
  `/api/health` reports.
- **Bot pill** — *Bot online*, *Connecting…* (first connection after a boot or a
  new token), *Reconnecting…* (automatic backoff after a network blip), *Bot
  offline* (a bad token or a sleeping host), *Bot idle* (a token is configured but
  the gateway is not connected yet), *Bot stopped* (the process is shutting down)
  or *No bot* (no token at all). Hover it for the reason; the **Bot & 24/7** tab
  repeats it with the last presence update and uptime.
- **Profile pill** — *Profile live (Discord)* while the in-Discord app is pushing,
  *Profile live* while a paired companion is, *Profile idle* when a device is
  paired but silent, *Profile not live* when neither.
- **User chip** — your Discord name and avatar if you signed in with Discord,
  otherwise *Signed in*.
- **Setup guide** opens `/guide` in a new tab; **Sign out** ends the session.

### 7.3 The five tabs

| Tab | What it is for | Documented in |
| --- | --- | --- |
| **Presence** | the editor and the live preview: every field that reaches Discord | §8 |
| **Photos** | the image library — reuse, inspect or delete what you uploaded | §8.7 |
| **My profile** | the in-Discord app, the share card and the optional companion | §9, §11, §12 |
| **Bot & 24/7** | the bot's connection, its invite link and the keep-alive | §10 |
| **Settings** | application ID, client secret, bot token, allowlist, dashboard key | §7.4 |

### 7.4 Settings, form by form

**Application & bot**

| Field | What goes in it |
| --- | --- |
| Application (client) ID | the number from §4.2 — public, used for the launch link and the invite |
| Bot token | the token from §4.4. Write-only: it shows the current token's last characters underneath and accepts *leave blank to keep the current token*. Saving reconnects the bot at once |

**Discord sign-in**

| Field | What goes in it |
| --- | --- |
| OAuth2 client secret | from §4.3. Required for the in-Discord app, optional for key-only use |
| Allowed Discord user IDs | comma-separated user IDs; empty means "anyone who can install the app". The exact redirect URL to register in the portal is printed under the field |

**Dashboard key**

Choose a new key of 12 or more characters; the current one is required. The
session you are using survives the change, other devices sign in again. Lost the
old key? §15.1.

Three details that surprise people:

- **The bot token field is write-only.** It shows `Current token MTA…AbCd` (first
  six and last four characters) and accepts blank to keep what is stored. A bad
  token is replaced by pasting the new one, never by clearing the field.
- **The allowlist is capped at 50 IDs** and anything that is not 5–25 digits is
  silently dropped, so a typo can never lock you out by accident.
- **`DASHBOARD_KEY` in the environment wins over this form.** The form still
  accepts a new key, but sign-in keeps checking the environment value; change the
  variable instead. The other environment-managed values — public URL, client ID,
  client secret, bot token, allowlist — appear disabled in their forms.

Any value supplied by the environment shows up in the form but is disabled,
because the environment always wins.

### 7.5 How the page keeps up

- One SSE stream (`/api/events`) pushes every change: publish from your phone and
  the desktop tab updates without a reload. A 20-second poll takes over when the
  stream is blocked by a proxy.
- Edits are autosaved as a **draft** about a second after you stop typing, so
  nothing reaches Discord until you press **Publish** (§8.4).
- Validation errors appear above the form, Discord's own refusal arrives as a
  toast, and closing the tab with a save in flight asks first.
- It is a single-tenant dashboard: one key, one presence, one profile per
  instance. Several people each wanting their own card means several instances.

### 7.6 A first-run tour

Ten minutes, in this order:

1. Sign in with the key you chose in the wizard.
2. **Settings → Application & bot** — application ID and bot token → **Save**.
3. **Settings → Discord sign-in** — client secret → **Save**.
4. **Bot & 24/7** — confirm *Bot online*, copy the invite link, add the bot to a
   server of yours.
5. **Bot & 24/7** — set the public URL and leave the keep-alive on → **Save**.
6. **Presence** — name, type, status, both lines, a photo, up to two buttons.
7. **Publish** — the bot card changes within a second.
8. **My profile → Open in Discord** — the card lands on your profile (§9).
9. **My profile → Create share link** if you want a public `/c/…` card (§11).
10. Run the verification table in §13 once; it catches every typo.

---

## 8. Step 4: design and publish the card

Everything that reaches Discord is edited on one screen: the **Presence** tab.

### 8.1 Start from a template (optional)

Ten starting points under **Start from a template**: **Focus mode, Listening,
Building, Watching, Gaming, Studying, Reading, On a break, In the studio,
Ranked**. Clicking a template chip fills the form and toasts *“…” applied —
publish when you like it*; the photo you already picked and your target choices
survive. Nothing is published by clicking a template — you still press
**Publish**. (The chips are served by `/api/templates`, so a template can also
be applied over the API.)

### 8.2 The fields, with their real limits

| Field | Limit / rule | Notes |
| --- | --- | --- |
| Name | 128 chars, required | shown after the activity type |
| Type | 0 Playing · 1 Streaming · 2 Listening · 3 Watching · 4 Custom · 5 Competing | Streaming needs an `https://` Twitch or YouTube link |
| URL | 512 chars, `https://` | only used by Streaming |
| Details | 128 chars | line 1 |
| State | 128 chars | line 2 |
| Large image | uploaded photo, `https://` URL, or Discord asset key | |
| Large hover text | 128 chars | tooltip on the large image |
| Small image | same as large | overlaid in the corner |
| Small hover text | 128 chars | |
| Buttons | at most **2**; label 32 chars; URL must be `https://` | Discord renders them under the card |
| Timer | **Elapsed timer** on/off plus **Restart from now** | counts up from publication; leave *Restart from now* off to keep the original start time |

Two rules the form enforces before it sends anything:

- **A button without a label and an `https://` link is dropped**, and if that was
  the only button you get *"Buttons need a label and an https:// link."* rather
  than a silently empty card.
- **Custom status (type 4) hides Details, State, the timer and the buttons**, because
  Discord renders only one line for it: the activity name is used as the state
  text. That is why an empty "State" on a custom status is not a bug.

Image fields accept three things: a photo you uploaded (`asset:<hash>`), an
`https://` URL, or a Discord asset key (letters, numbers, `_` and `-`). `http://`
image URLs are rejected — Discord will not fetch them.

### 8.3 Photos

- Use **drag and drop**, **paste** (`Ctrl`/`Cmd` + `V`), the file picker, or
  **Reuse** to pull one out of your library. Each slot has **Remove** next to it,
  and a collapsed **Use an image URL instead** box takes a plain `https://` link
  (handy for an image you already host).
- Accepted: PNG, JPEG, WebP, animated GIF. Minimum 16×16, maximum 4096×4096,
  2 MB per image after decoding. Animated GIFs are uploaded untouched, so they
  must be under 2 MB *before* upload.
- Still images are cropped to a square in the browser (512 px large, 256 px
  small) and converted to WebP, so a 12 MB phone photo still works.
- Images are stored under `data/assets/<hash>.<ext>`, deduplicated by content,
  and served at `https://YOUR-HOST/assets/<hash>.<ext>` with
  `Access-Control-Allow-Origin: *` so Discord's media proxy can fetch them.
- **Photos need a public HTTPS URL.** `http://` and `localhost` are ignored by
  Discord. If the photo shows as a letter or a silhouette, the public URL is the
  usual suspect.

### 8.4 Draft, publish, discard, clear

Four buttons sit under the form, and each one has exactly one job:

| Button | What it does |
| --- | --- |
| **Publish** | validates, saves and applies. The bot card changes immediately and the in-Discord app picks it up within about 5 seconds |
| **Discard draft** | throws the staged edits away and puts the live card back in the form |
| **Clear** | asks once, then switches the presence off everywhere — the bot card goes away and the Activity reports "no presence is live" |
| **Put it on my profile** | jumps to the **My profile** tab; it does not publish |

- Every edit is staged and autosaved as a **draft** — on any device — and nothing
  reaches Discord until you press **Publish**.
- The tag next to **Live preview** says where the card currently is: **Saved**
  (stored, bot not connected), **On bot**, **Live** (a companion is reporting it)
  or **Cleared**.
- Validation errors appear above the form and the first one is also the reason the
  draft hint shows; Discord's own refusal arrives as a toast.
- Closing the tab with a save in flight asks for confirmation; everything else is
  already saved.

### 8.5 The preview tools

The **Live preview** card is the same markup Discord draws, so it can be checked
in the two shapes that actually differ:

- **Dark / Light** — Discord has both themes, and the small text on a photo reads
  very differently on each.
- **Compact** — the narrow form of the card Discord uses in some views; buttons
  and the timer are the first things to disappear there.

Both choices are remembered in the browser only (nothing is stored on the server,
and nothing about them reaches Discord). The elapsed timer in the preview ticks
live from the moment you publish.

### 8.6 Where it shows

Two checkboxes under **Show this presence on**:

- **The bot** — the text card, 24/7, on your server.
- **My own profile** — photos, buttons, timer, in the Discord app.

Pick one or both; at least one is required. Un-ticking *My own profile* is why an
Activity can legitimately show "no presence" while the dashboard looks fine — the
Activity names that reason explicitly.

### 8.7 The Photos tab

Uploads are not thrown away when you publish: every image you ever uploaded is
in the library, and the **Photos** tab is where you manage it.

| Action | How |
| --- | --- |
| Use a stored photo | **Photos** → **Large** or **Small** under the thumbnail, then **Publish** |
| Upload without touching the card | drag a file onto the **Presence** photo slots (that is the normal route) |
| Delete | the **×** on the thumbnail — the file and its metadata are removed |
| See the public URL | the thumbnail links to `/assets/<hash>.<ext>`; open it to check that Discord can fetch it |
| Start over | delete the file, or pick another photo — nothing else references it |

Identical files are de-duplicated by content hash, so re-uploading the same photo
does not fill the disk. Uploads are capped at 2 MB and 4096×4096; the browser
already shrinks ordinary phone photos well below that.

The library is the list in `settings.json`, and the files live in `data/assets/`.
At boot StatusC0rd deletes any file in that folder that is not in the list, so a
half-finished upload or a hand-copied file cannot linger. Deleting a photo in the
dashboard removes both the entry and the file, and any card that used it falls
back to the letter — re-pick or re-upload it and publish again.

If the tab shows a yellow **"This dashboard is not on HTTPS"** warning, Discord
will refuse to load your images — fix `PUBLIC_URL` first (§16), then publish
again.

---

## 9. Step 5: on your own profile, no install

1. **My profile** tab → **Open in Discord** (with **Copy link** beside it, if you
   would rather paste the URL somewhere). That link is
   `https://discord.com/activities/<your-app-id>`; the same app is in Discord's
   **App Launcher** inside a voice channel, and as `/launch` if you installed the
   commands scope.
2. The first launch runs Discord's authorisation prompt (`identify` +
   `rpc.activities.write`). Accept it once per install.
3. The panel shows your card exactly as Discord will render it, with a pill in the
   corner: **On your profile**, or **On your profile · no buttons** on older
   clients that reject the button fields.
4. Back in the dashboard, the **My profile** badge turns to **Profile live** with
   a "last update" time, and a green dot appears on the Activity step.
5. Edit anything in the dashboard — the panel updates within ~5 seconds, without
   reopening.

**What you should expect**

| Situation | Result |
| --- | --- |
| Panel open | the card is on your profile, timer counting, buttons clickable |
| Panel closed | the card is removed — Discord gives nothing else, for anybody |
| Second device | open the app there too; the last one to set the card wins |
| No application ID | the launch link is disabled and says to add one in Settings |
| No client secret | the server answers `not_configured`, and the panel explains it |
| Not on `ALLOWED_DISCORD_IDS` | `403 not_allowed`, message in the panel |
| Discord rejects the payload | "Discord refused the activity" with Discord's reason |

**What the panel itself does**

- It polls the dashboard every 5 seconds (and immediately when you switch back to
  it), so an edit made in the browser is on your profile without a reload.
- Errors have their own cards with a **Try again** button: *Open this inside
  Discord* (the page was opened in a browser instead), *Discord refused the
  connection* (the authorisation prompt was declined or timed out), *Could not
  reach the dashboard* (the server is down or the URL mapping is wrong) and
  *Discord refused the activity* (Discord rejected one field — the message says
  which).
- *No application id* adds an **Open the dashboard** button that jumps straight to
  **Settings → Application & bot**.
- The authorisation prompt appears once per install; after that the panel opens
  straight into the card. Everything it needs is a browser session inside
  Discord — no token, no file and no account access beyond `identify` and
  `rpc.activities.write`.

The bot card (§10) is the part that stays after you close the panel.

---

## 10. Step 6: the bot card, always online

The bot runs on the server, so its card is online as long as the server is. Three
things make that true:

1. **A bot token** in the wizard or **Settings** (or `DISCORD_TOKEN`). Without
   one the dashboard still works — the **Bot & 24/7** tab just says *No bot*.
2. **A process that restarts itself** — systemd, Docker `--restart
   unless-stopped`, pm2, or the host's own supervisor. The path file you followed
   has the exact unit or command:
   [local](setup-local.md#7-keep-it-running-after-logout-and-reboot) ·
   [cloud](setup-cloud.md#5-install-the-app-and-run-it-as-a-service) ·
   [free cloud](setup-free-cloud.md#2-path-a-render-free).
3. **The keep-alive.** Free web services sleep after a period without inbound
   traffic. StatusC0rd pings its own public URL on a timer so the host never sees
   an idle service. On a VPS, on Oracle or on GCP it changes nothing and can be
   switched off.

**Turning it on** — **Bot & 24/7 → 24/7 online**:

- **Keep the service awake** (ticked by default; the wizard calls the same
  checkbox *Keep this server awake*).
- **Ping every (minutes)** — 5 to 60, default 10, clamped by the server. Keep it
  under the host's idle timeout (Render: 15 minutes).

The card shows **Active** with "Last ping … · N pings" once a ping succeeds. If it
says **Waiting**, the URL is unreachable from the server. If it says **Paused**,
the URL is missing.

Environment equivalents: `KEEP_ALIVE=true|false`,
`KEEP_ALIVE_INTERVAL_MINUTES=10`. Keep-alive only starts when `PUBLIC_URL` is set.

**The bot status panel** shows connection state, the bot account (**Account**),
**Last presence update** and **Uptime**. Below it the **Invite link** field holds
the ready-made authorise URL with a **Copy** button; it is hidden, with a hint
instead, until an application ID is configured. The expected states are *Bot online*, *Connecting…*,
*Reconnecting…* (network blip, automatic exponential backoff), *Bot offline*
(bad token or a sleeping host) and *No bot*.

> A bot card can only carry **name, type and state**. Discord strips images and
> buttons for bot accounts; that is a platform limit, not a bug here.
>
> It also means the **State (line 2)** field is the text people read on the bot
> card — **Details (line 1)** exists only on your own profile. Put the sentence
> you want on the bot card in *State* and leave *Details* for the richer card.

---

## 11. Step 7: the share card (optional)

**My profile → Share card → Create share link** publishes a read-only page at
`/c/<random-slug>` with the same card and real `Open Graph` / Twitter tags, so it
unfurls with its photo anywhere.

- **Open** shows the page; **Copy** copies the URL; **New link** rotates the slug
  (the old one stops working immediately); **Switch off** deletes it.
- The page carries the presence fields and nothing else: no email, no token, no
  session, no dashboard link.
- Slugs are random 10-character lowercase, and only a matching slug resolves —
  anything else is a 404. The API also takes a slug you choose (6–32 letters and
  numbers) if you want `/c/myname`; the dashboard always generates one.
- The card is regenerated from the live presence, so it updates when you publish.

**What the page actually contains** — it is one HTML response, no JavaScript, so
crawlers and phone cameras get the whole thing:

| Tag | Value |
| --- | --- |
| `<title>` | `<activity name> · StatusC0rd` |
| `og:type` / `og:site_name` | `website` / `StatusC0rd` |
| `og:url` + `link rel=canonical` | `https://YOUR-HOST/c/<slug>` |
| `og:title` / `og:description` | the activity name / details · state, or a fallback line if both are empty |
| `og:image` + `og:image:alt` + `twitter:image` | the large photo and its hover text — **omitted entirely** when there is no photo, rather than emitted empty |
| `twitter:card` | `summary_large_image` with a photo, `summary` without |

The response is `no-store`, so a rotated slug dies at the CDN too, and it is
served `X-Robots-Tag: all` — the link is meant to be shared, and the slug is the
only secret.

---

## 12. Step 8: the optional companion

Some people would rather not open a panel. The companion is a Node script that
talks to the local Discord client over its socket and pushes the same card. It is
the *advanced* path: it has to be installed and kept running, which is exactly
what the in-Discord app avoids.

Requirements: **Node.js 20+**, the **Discord desktop app** running, and an
application ID configured.

1. **My profile → Advanced: run it on your computer instead** → name the device
   (`My computer`) → **Pair this computer**.
2. Download the launcher for your OS:
   - **macOS** — `StatusC0rd-mac.zip`; unzip (Safari does it) and double-click
     `StatusC0rd.command`. It ships as a zip on purpose: macOS strips the execute
     bit from plain downloads, while Archive Utility restores the stored `0755`
     mode.
   - **Windows** — `StatusC0rd.bat`, double-click.
   - **Linux** — `statusc0rd.sh`; `chmod +x` once, then run.
3. Or use a terminal, no files at all:

   ```sh
   curl -fsSL "https://YOUR-HOST/companion.js?pair=<token>" | node      # macOS / Linux
   curl.exe -fsSL "https://YOUR-HOST/companion.js?pair=<token>" | node  # Windows PowerShell
   ```

4. Leave the window open. It polls the dashboard every 5 seconds, so edits in the
   browser appear on your profile within seconds; it reconnects when Discord
   restarts and clears the presence on `Ctrl`+`C`.

Notes that matter:

- Each launcher embeds that device's pairing token — treat it like a password.
  Revoke it under **My profile → Paired devices → Remove** if it leaks.
- Tokens are stored hashed; nothing about your Discord account is stored.
- Discord RPC does not support the *Streaming* or *Custom status* types; the
  companion renders those as **Playing** instead of failing.
- **Ten devices maximum** per instance. The pairing list shows each one's name,
  when it was created and when it last checked in; removing one invalidates its
  token immediately, and a running companion notices within a second and exits.

**What it does while it runs**

| | |
| --- | --- |
| Poll interval | 5 seconds; the dashboard's config endpoint answers `304 Not Modified` when nothing changed, so the poll costs almost nothing |
| Heartbeat | every 60 seconds, which is what turns the dashboard's profile pill green |
| Reconnect | 2 seconds, doubling to 30, whenever Discord restarts or the socket drops |
| On `Ctrl`+`C` | clears the presence first, then exits — no stale card is left behind |
| If the device was unpaired | prints "This computer was unpaired in the dashboard" and exits with code `2` |
| Socket lookup | Windows named pipes `\\.\pipe\discord-ipc-0…9`; on Linux/macOS `$XDG_RUNTIME_DIR`, `$TMPDIR`, `/tmp` and the Flatpak/Snap sandbox equivalents (`app/com.discordapp.Discord`, `snap.discord`, `.flatpak/dev.vencord.Vesktop`) |

**Running it by hand** (for a server, a script or a diagnosis). The generated
script carries its config inline; the raw script reads these instead:

```sh
STATUSC0RD_SERVER=https://YOUR-HOST \
STATUSC0RD_TOKEN=<pairing token> \
STATUSC0RD_APP_ID=<application id> \
STATUSC0RD_LABEL="My computer" node statusc0rd-companion.js

node statusc0rd-companion.js --dry-run        # print what the server would send
node statusc0rd-companion.js --print-config   # print the config it was given
```

`--dry-run` fetches `/api/companion/config` and prints the payload without
talking to Discord — the fastest way to tell a dashboard problem from a Discord
one.

---

## 13. Step 9: verify the whole install

Run through this once, on whatever host you chose. It catches every typical
mistake.

| # | Check | Expected |
| --- | --- | --- |
| 1 | `https://YOUR-HOST/health` | `{"status":"ok","uptimeSeconds":…,"timestamp":…}` (nothing else — that is deliberate). `503` plus `"status":"degraded"` means the data directory is not writable |
| 2 | Sign in, then `https://YOUR-HOST/api/health` | `status: ok`, `version`, `uptimeSeconds`, `storage: ok`, `setup: complete`, plus `bot`, `keepAlive` and `activity` blocks |
| 3 | **Bot & 24/7** | *Bot online*, account name, a recent presence update |
| 4 | **Bot & 24/7 → Keep-alive** | **Active**, "Last ping …", pings counting up |
| 5 | Upload a photo, **Publish**, open the photo URL from the asset list | the image loads, `https://` and no login |
| 6 | Discord, in a server where the bot is a member | the bot's card shows your activity text |
| 7 | **My profile → Open in Discord** | panel opens, pill says **On your profile** |
| 8 | Look at your own Discord profile | photo, both lines, timer, buttons |
| 9 | Change the state text in the dashboard | panel and profile update within ~5 s |
| 10 | Close the panel | the card disappears; the bot card is still there |
| 11 | **Share card → Create**, open `/c/<slug>` in a private window | the card renders; no dashboard |
| 12 | Open `/guide`, `/guide/local`, `/guide/cloud`, `/guide/free-cloud` | four pages, each with its own tab strip and contents list |
| 13 | `/welcome` and `/c/<slug>` in a private window | both load with no session; the card shows no dashboard link |
| 14 | Restart the host | with env values set, the dashboard comes back without the wizard; on an ephemeral disk, photos are gone — that is the host, not a bug |
| 15 | Optional: the companion | its window prints "Ready… syncs every 5s", and **Paired devices** turns green |

If a check fails, §19 has the symptom-to-cause table and §21 has every expected
status code.

---

## 14. Step 10: updates and backups

**Update** (any git-based host):

```sh
git pull
npm ci            # only when package-lock.json changed
# restart the process (Render/your host does it; Docker: rebuild and restart)
```

Check the new version at `/api/health` (`version`) or in the page footer.

**Back up** — `data/` is the whole state:

```sh
tar -czf statusc0rd-backup-$(date +%F).tgz data/
```

It contains `settings.json` (secrets, presence, share slug, hashed pairing
tokens), `assets/` (the photos) and possibly `setup-token.txt` (before setup).
Nothing else in the deployment is stateful.

**Restore or move hosts**: copy `data/` into the new deployment's `DATA_DIR`
before the first boot, set the same `PUBLIC_URL`, start it. The dashboard key,
presence, photos, share slug and paired devices all come back.

**If the disk is ephemeral** (Render free): either use a host with a real disk,
or keep `DASHBOARD_KEY`, `CLIENT_ID`, `CLIENT_SECRET`, `DISCORD_TOKEN` and
`PUBLIC_URL` in the environment so a wiped instance boots straight into a working
dashboard (the wizard is skipped) and only the photos and the presence text need
re-entering.

---

## 15. Step 11: security and rotation

### 15.1 The dashboard key

- Change it in **Settings → Dashboard key** — it requires the current key and a
  new one of 12+ characters.
- Five failed attempts from one IP block that IP for 15 minutes.
- **Lost it?** If `DASHBOARD_KEY` is set in the environment, that value is the
  key — nothing else to do. Otherwise:
  1. stop the service;
  2. open `data/settings.json` and set `admin` to
     `{"keyHash": "", "keySalt": "", "updatedAt": null}` (or delete the whole
     file to start from scratch — that also drops the presence, the photos stay
     on disk but are no longer listed);
  3. start the service again. Because a key is now missing while setup is marked
     complete, StatusC0rd mints a fresh setup token, prints it in the log and
     writes `data/setup-token.txt`;
  4. open `/setup`, unlock with that token and choose a new key.

  If you cannot reach the log or the filesystem, set `SETUP_TOKEN` in the
  environment before restarting and use your own value in step 4.

### 15.2 The bot token

Reset it in the portal (**Bot → Reset Token**), then paste the new value in
**Settings → Application & bot → Bot token**. The bot reconnects immediately; no
restart. A wrong token is visible as *Bot offline* with the reason in the log.

### 15.3 The client secret

Reset it in the portal (**OAuth2 → General**), paste the new one in **Settings**.
Until you do, the in-Discord app answers `not_configured` and Discord sign-in
stops working.

### 15.4 Who can use the instance

- **Dashboard sign-in** — the key, plus (optionally) allowlisted Discord accounts.
- **The in-Discord app** — anyone who can launch the app *and* is on
  `ALLOWED_DISCORD_IDS`, if that list is set. With no list, a single-tenant
  install trusts anyone who can install the app; that is fine for your own app,
  not for a shared one.
- **Companion devices** — one hashed token per device, revocable individually.
- **The share card** — public by design, opt-in, rotatable, switchable off.
- **`/health`** — public and minimal; version, storage, bot and Activity state are
  behind the session at `/api/health`.

**What the sign-in page can tell you.** Every failure is a redirect back to
`/login?error=…`, so the message you see is the whole diagnosis:

| Message | Meaning |
| --- | --- |
| *That dashboard key is not correct.* | wrong key |
| *Too many failed attempts…* | five wrong keys from this IP; 15-minute block |
| *Dashboard key sign-in is disabled on this server.* | `admin.keyHash` is empty and there is no `DASHBOARD_KEY`; sign in with Discord or run the wizard (§15.1) |
| *Discord sign-in is not configured on this server.* | no client secret, or an empty allowlist — both are required |
| *That Discord account is not on the allowlist for this dashboard.* | the account is fine, the instance is not open to it |
| *That sign-in attempt was invalid or expired.* | the OAuth `state` did not match, or you waited too long (10 minutes) |
| *Discord sign-in was cancelled.* | the prompt was declined |
| *Discord sign-in failed. Please try again in a moment.* | the token exchange failed — usually a wrong client secret or a redirect URL that does not match |

### 15.5 Rate limits

Every limit is per client IP and resets on its own — nothing has to be unlocked
by hand:

| Scope | Limit |
| --- | --- |
| Dashboard sign-in | 5 failures, then 15 minutes |
| Writes (publish, upload, settings, pairings, share) | 60 per minute |
| Setup endpoints (token, photo, bot test, finish) | 20 per 5 minutes |
| Companion (`/companion.js`, launchers, config, heartbeat) | 120 per minute |
| In-Discord app (`/activity/`, token exchange, presence) | 180 per minute |

Over the line you get `429` with a `Retry-After` header and *"Too many requests.
Please slow down."* Ordinary use — a 5-second poll, a draft every second while
you type to a limit of 60 a minute — is nowhere near any of them. The
authenticated endpoints also send `RateLimit-Remaining`.

### 15.6 Deployment hygiene

- Serve over HTTPS. Photos need it anyway, and the session cookie is marked
  `Secure` when the request arrives over TLS.
- `SESSION_SECRET` should be 32+ characters (`openssl rand -hex 32`); a random one
  is generated and stored if you do not set it.
- If the app is exposed **directly** to the internet with no proxy in front, set
  `TRUST_PROXY=false`. Behind Render/Cloudflare/Caddy the default
  (`loopback, linklocal, uniquelocal`) is correct.
- Delete `data/users.json` if you ever see a warning about it at boot: it is the
  old v1 token store and is no longer used.
- Back up `data/` before you upgrade (§14). It is the only thing that cannot be
  rebuilt from the repository.

The headers the app sends, for the record: `Content-Security-Policy` with no
inline scripts and `form-action 'self'` (framing is `frame-ancestors *` while
`NODE_ENV` is not `production`, which is what lets a hosted preview embed the
dashboard — set `NODE_ENV=production` on a real deployment); `X-Content-Type-Options: nosniff`;
`Referrer-Policy: same-origin`; `Permissions-Policy` denying camera, microphone
and geolocation; `Cross-Origin-Opener-Policy: same-origin` everywhere except the
Activity; HSTS in production over TLS. Framing is `frame-ancestors 'self'` in
production (so the dashboard cannot be clickjacked) and `https://discord.com` for
`/activity/` only. Uploaded photos are the one thing served with
`Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`,
because Discord's media proxy fetches them from another origin. Static files are
revalidated on every load; only `/assets/<hash>` is `immutable` for a year.

---

## 16. Environment variables

Environment variables are **optional**: the wizard writes the same values into
`data/settings.json`, and the environment wins when both exist. A completely
unconfigured instance still boots and serves `/setup`.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `production` adds HSTS, blocks framing of the dashboard, and marks cookies `Secure` behind TLS |
| `DATA_DIR` | `./data` | where `settings.json`, `assets/` and the setup token live |
| `PUBLIC_URL` | unset | public origin used for photo URLs, the companion and keep-alive; must be the real `https://` URL |
| `CLIENT_ID` | unset | Discord application ID (public) |
| `CLIENT_SECRET` | unset | OAuth2 secret; enables the in-Discord app and Discord sign-in |
| `DISCORD_TOKEN` | unset | bot token for the 24/7 text card |
| `BOT_ENABLED` | `true` when a token exists | `false` runs the dashboard without a gateway connection |
| `DASHBOARD_KEY` | unset | the sign-in key; setting it also marks the instance configured, skipping the wizard |
| `SESSION_SECRET` | generated | cookie signing key; 32+ characters if you set it |
| `SETUP_TOKEN` | generated | fixed setup token instead of the one written to `data/setup-token.txt` |
| `SETUP_REQUIRE_TOKEN` | unset | `1` demands the setup token even on localhost |
| `ALLOWED_DISCORD_IDS` | unset | comma/space separated user IDs allowed to use the dashboard and the in-Discord app |
| `KEEP_ALIVE` | `true` | force the keep-alive on or off (it still needs `PUBLIC_URL`) |
| `KEEP_ALIVE_INTERVAL_MINUTES` | `10` | ping interval, clamped to 5–60 |
| `REDIRECT_URI` | `<PUBLIC_URL>/auth/discord/callback` | override the OAuth callback |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | which hops may set `X-Forwarded-*`; `false` when exposed directly, or a hop count / proxy list |
| `LOG_REQUESTS` | on | one `[http] METHOD /path status bytes ms` line per page and API request; static files and the SSE stream are skipped. `0` silences it entirely |

A copy-paste template lives in `.env.example`. Invalid values do not stop the
server: it prints `[config] …` warnings at boot and carries on.

You can also drop a `.env` file next to `index.js` — it is read at boot, which is
handy on a VPS or a home machine. Managed hosts (Render, Railway) give you a
variables panel instead; use that so the values survive a redeploy.

---

## 17. Where every secret lives

| Thing | Where | Survives a restart? |
| --- | --- | --- |
| Dashboard key | `DASHBOARD_KEY` env, else scrypt hash + salt in `data/settings.json` | env: yes |
| Bot token | `DISCORD_TOKEN` env, else `data/settings.json` (`0600`) | env: yes |
| Client secret | `CLIENT_SECRET` env, else `data/settings.json` | env: yes |
| Session signing key | `SESSION_SECRET` env, else generated into `settings.json` | env: yes |
| Presence + draft | `data/settings.json` | only with a real disk |
| Photos | `data/assets/<hash>.<ext>` | only with a real disk |
| Pairing tokens | hashed inside `settings.json`, one per device | only with a real disk |
| Share slug | `settings.json`, revocable | only with a real disk |
| Setup token | `data/setup-token.txt` (`SETUP_TOKEN` overrides) | deleted when setup finishes |

Writes are atomic (temp file + rename) with mode `0600`, and a corrupt
`settings.json` is moved aside as `settings.json.corrupt-<timestamp>` instead of
being silently deleted.

---

## 18. Limits worth knowing

- **Photos and buttons cannot go on a bot card.** Discord's bot presence accepts
  only name/type/state. They belong to *your* profile, which the in-Discord app
  sets from a web page you already have.
- **Only a client can write to a user's profile.** No server, paid or free, can
  push rich presence to your account on its own. That is why the card appears
  while the Activity panel is open, and why the bot card is the 24/7 part.
- **Two buttons, maximum**, and their URLs must be `https://`.
- **Custom status (type 4)** renders as text only — no images, no buttons.
- **Streaming** needs a `https://` URL; the companion downgrades Streaming and
  Custom to *Playing* because local RPC does not accept them the same way.
- **Discord caches artwork for a few minutes.** A brand-new image can take a
  moment, and occasionally a Discord restart.
- **Free hosts sleep.** Render does after 15 minutes without traffic; the
  keep-alive (minimum 5 minutes) is what keeps the bot connected.
- **Photo limits:** 16×16 to 4096×4096, 2 MB after decoding, PNG/JPEG/WebP/GIF.
  The upload body may be up to 8 MB (that is the base64 of a 2 MB image plus
  slack); forms are capped at 64 KB.
- **Sessions last 8 hours.** Re-sign-in after that; the dashboard key still works.
- **Ten paired devices**, and **50 allowlisted Discord IDs**, are the caps. Both
  are per instance, both can be trimmed in the dashboard.
- **A setup grant lasts 30 minutes.** After that the wizard asks for the token
  again; nothing you already typed is lost until the page is closed.
- **Rate limits** are per IP and per minute-ish: 60 writes, 20 setup calls per
  5 minutes, 120 companion calls, 180 Activity calls, 5 sign-in failures. §15.5
  has the table.
- **The dashboard pushes over SSE with a 25-second heartbeat.** A proxy that
  buffers responses will hide it, which is why the page falls back to a 20-second
  poll — one wasted request per 20 s, not a broken page.
- **Discord is the final judge.** Everything here is validated twice (browser,
  then `src/presence.js`), and a third time by Discord; a payload it rejects shows
  up as a toast and in the Activity panel, never as a silent failure.

---

## 19. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/setup` reappears after a restart | ephemeral disk (Render free) and no `DASHBOARD_KEY` in the environment | put the values in the host's environment, or move to a host with a real disk |
| Photos show as a letter or silhouette | `PUBLIC_URL` is wrong, not `https://`, or the host is asleep so Discord cannot fetch `/assets/…` | set the real public URL in **Bot & 24/7**, re-publish, open the photo URL to confirm |
| *Profile live* never turns green | the Activity is not open, or the companion is not running | open the in-Discord app (or start the launcher) and keep it open |
| The profile card vanishes after a while | the Activity panel was closed — Discord only shows it while the app is open | reopen the app; the bot card stays 24/7 |
| Dashboard says *Bot offline* | wrong or reset bot token, or the host is asleep | paste the new token in Settings; check keep-alive |
| Bot goes offline every ~15 min | free host spinning down; keep-alive off or the URL is wrong | **Bot & 24/7** → correct URL, enable keep-alive, interval under 15 min |
| The in-Discord app says *No application id* | `CLIENT_ID` is not set | add it in Settings (or `CLIENT_ID`) and reload the app |
| *not_configured* in the Activity | no client secret on the server | add it in **Settings → Application & bot** |
| *not_allowed* in the Activity | your Discord account is not on `ALLOWED_DISCORD_IDS` | add your ID, or clear the list for a single-tenant install |
| Activity link opens a blank page | URL mapping missing or wrong | **Activities → URL Mappings**: prefix `/` → `https://YOUR-HOST/activity/` |
| The app is not in Discord's launcher | the app was installed without the commands scope | re-run the invite with the `bot applications.commands` scopes (§4.6) |
| Buttons do not appear | the client rejects button fields, or the card has none | the pill says **no buttons**; update the Discord client |
| "That dashboard key is not correct" | typo, or the key was rotated | try again; if truly lost see §15.1 |
| "Too many failed attempts" | five wrong keys from one IP | wait 15 minutes |
| Wizard asks for a setup token | you opened it from a non-local address | copy it from the log or `data/setup-token.txt`, or set `SETUP_TOKEN` |
| "Setup is locked" | the token expired (30-minute grant) or was rotated | re-enter the current token |
| `EADDRINUSE` on start | another process owns `PORT` | set `PORT` to a free port |
| Photos upload but Discord shows the old one | Discord's image cache | wait a few minutes or restart Discord |
| Share page 404s | sharing was switched off or the slug was rotated | create a new link under **My profile → Share card** |
| macOS: "cannot be opened because the developer cannot be verified" | downloaded `.command` quarantine | right-click → Open, once |
| macOS: double-click does nothing | an old plain `.command` without the execute bit | download `StatusC0rd-mac.zip` instead |
| Companion says "no longer paired" | the device was removed in the dashboard | pair again |
| `[config] …` warnings at boot | a malformed environment variable | fix the value; the server keeps running |
| "Too many requests. Please slow down." | a rate limit (§15.5) | wait for the `Retry-After` seconds; a scripted client should back off |
| "That upload is too large" | the image is over 2 MB after decoding, or the request body over 8 MB | use the browser's own crop/downscale, or shrink the file first |
| "Request body was not valid JSON" | a scripted `POST` without `Content-Type: application/json` | send the header; the dashboard never hits this |
| A photo URL answers 404 | the photo was deleted, or the file is gone while its entry remains | re-upload it (the library entry is what counts, not the file) |
| Every `/api/…` call answers 401 | the session expired (8 hours) or cookies are blocked | sign in again; check that nothing strips `statusc0rd.sid` |
| "Setup is already complete" | someone (or an env value) finished setup | sign in at `/login` instead; to redo it, see §15.1 |
| "This pairing link is invalid or was revoked" | the token was rotated, or the device was removed | pair again from **My profile** |
| The dashboard says *Bot idle* | the gateway is connected but the presence is not on the bot | check that **The bot** is ticked on the Presence tab and publish |
| `/api/health` says `degraded` | `data/` is not writable (permissions, full disk, read-only mount) | fix the mount or ownership; `/health` returns 503 until then |
| A blank page **and no `[http]` line for it in the host's log** | the request never reached Node — the platform's proxy answered instead (service asleep, out of instance hours, crashed, or still deploying) | check `/health` from outside; wake or redeploy; on Render confirm the service is **Live**, not *Suspended* |
| A blank page **and the log shows `GET / 200 27527b`** | the HTML was served, so the browser dropped the CSS/JS or the page was never rendered — an extension, a proxy, or an old cached bundle | hard reload (`Ctrl`/`Cmd`+`Shift`+`R`), then another browser or network; the log line proves the server's side is fine |
| The log shows `GET / aborted by the client` | the browser hung up mid-response, usually a proxy timing out on a cold free instance | wait for the instance to be warm (one `/health` 200 first) and reload |
| `/guide` answers "No such guide" | a typo in the path; only `local`, `cloud` and `free-cloud` exist | start at `/guide` |
| Browser console: 429 or `EventSource` errors | a proxy is rate-limiting or buffering | the page falls back to polling on its own; a 429 on writes means the limit in §15.5 |
| Keep-alive says **Waiting** | the server cannot reach `PUBLIC_URL` — DNS, TLS, or a sleeping host | open `https://YOUR-HOST/health` from outside; fix `PUBLIC_URL` |

Host-specific problems — tunnels, sleeping laptops, firewall ports, Docker,
systemd — are in the troubleshooting section of the path file you used.

---

## 20. All-in-one checklist

**One-time, Discord side** — §4

1. Application created; **Application ID** and **Client Secret** copied (§4.2–4.3).
2. Bot token copied, *Public Bot* off, privileged intents all off (§4.4).
3. **Activities → Enable Activities**; URL mapping `/` →
   `https://YOUR-HOST/activity/`, trailing slash kept (§4.5).
4. App installed with `bot applications.commands` (§4.6).
5. Optional: the OAuth2 redirect for Discord sign-in (§4.7).

**One-time, host** — [local](setup-local.md), [cloud](setup-cloud.md) or
[free cloud](setup-free-cloud.md)

6. The app is running, reachable at an `https://` URL, and starts again after a
   reboot.
7. `PUBLIC_URL` set to exactly that origin, no trailing slash.
8. A writable `data/` that survives restarts — or the Discord values in the
   environment instead (§16).
9. `/setup` finished, or `DASHBOARD_KEY` + `CLIENT_ID` + `CLIENT_SECRET` +
   `DISCORD_TOKEN` + `PUBLIC_URL` in the environment (§6).

**One-time, dashboard** — §7

10. Signed in at `/login`; the dashboard key is stored somewhere safe.
11. **Settings → Application & bot**: application ID and bot token saved.
12. **Settings → Discord sign-in**: client secret saved; allowlist set if the
    instance is not just yours.
13. **Bot & 24/7**: *Bot online*, invite link used, public URL saved, keep-alive
    on with an interval under the host's idle timeout (free hosts only).
14. **Presence**: a template or your own text, a photo, up to two buttons.
15. **Publish** → the bot card shows the text.
16. **My profile → Open in Discord** → the pill turns *Profile live (Discord)*.
17. Optional: **Share card → Create share link** (§11).
18. §13 verification table green, on the real public URL.

**Every time you change the card**

1. Edit on the **Presence** tab — nothing reaches Discord yet, it is a draft.
2. **Publish**.
3. Leave the in-Discord app open while you want the card on your profile.

Total cost: **$0** on the free paths. Total downloads for the person using the
card: **none**.

---

## 21. Appendix: every URL and every response

You do not need this page to get running — §1–§20 do that. It is here for the
other two jobs: **debugging with `curl`** and **knowing whether a route exists
before you script against it**. Everything below is what the code in `app.js`
actually mounts, not an idealised version.

### 21.1 What proves who you are

| Credential | How it travels | Opens |
| --- | --- | --- |
| dashboard session | `statusc0rd.sid` cookie — signed, `HttpOnly`, `SameSite=Lax`, `Secure` over TLS, 8 hours | `/` and every `/api/*` except setup, companion and Activity |
| CSRF token | `x-csrf-token` header, or `_csrf` in the body/query | every non-GET on a session route — take it from `/api/state` → `csrf` or the page's `<meta name="csrf-token">` |
| setup token | `x-setup-token` header, `setupToken` in the body, or `?setupToken=` | `/api/setup/*` while setup is incomplete, from anywhere that is not loopback |
| pairing token | `Authorization: Bearer <token>` (the companion sends this) | `/api/companion/config`, `/api/companion/heartbeat` |
| Activity token | `Authorization: Bearer <access token>` from the Discord SDK | `/activity/api/presence` |
| nothing | — | `/welcome`, `/guide*`, `/c/:slug`, `/health`, `/assets/*`, `/activity*` (status only), setup status |

Loopback requests (`127.0.0.1`, `::1`) may use `/api/setup/*` without the token
unless `SETUP_REQUIRE_TOKEN=1`; a setup grant, once given, lasts 30 minutes.

### 21.2 Pages

| Method | Path | Answer |
| --- | --- | --- |
| `GET` | `/welcome` | `200` the overview page |
| `GET` | `/guide` | `200` this document, rendered from `docs/setup.md` |
| `GET` | `/guide/:slug` | `200` for `local`, `cloud`, `free-cloud`; `404` page otherwise |
| `GET` | `/` | `200` dashboard with a session, else `302` → `/login` (or `/setup` before setup) |
| `GET` | `/login` | `200` sign-in page; `302` → `/` when already signed in |
| `GET` | `/setup` | `200` wizard while unconfigured; afterwards `302` → `/` or `/login` |
| `GET` | `/c/:slug` | `200` public card; `404` page for a wrong, rotated or disabled slug |
| `GET` | `/activity` | `302` → `/activity/` |
| `GET` | `/activity/` | `200` the in-Discord app; `frame-ancestors https://discord.com` |
| `GET` | `/assets/:hash.:ext` | `200` the image (`immutable`, `ACAO: *`); `404` text if the hash is unknown or the file is gone |
| `GET` | `/favicon.ico` | `302` → `/favicon.svg` |
| `GET` | anything else | `404` HTML error page — or `{"ok":false,"error":"Not found."}` under `/api/` |

`/?tab=profile` (and `photos`, `bot`, `settings`) opens the dashboard on that tab;
that is how the wizard hands you over.

### 21.3 Health

| Method | Path | Answer |
| --- | --- | --- |
| `GET` | `/health` | `200` `{"status":"ok","uptimeSeconds":N,"timestamp":"…"}` — or `503` with `"status":"degraded"` when `data/` is not writable. Nothing else, ever |
| `GET` | `/api/health` | `200`/`503` with `status`, `version`, `uptimeSeconds`, `storage` (`ok`/`unwritable`), `setup` (`complete`/`required`), `bot`, `keepAlive`, `activity`. Session required |

### 21.4 Setup (only while unconfigured)

| Method | Path | Answer |
| --- | --- | --- |
| `GET` | `/api/setup/status` | `200` `needsSetup`, `authenticated`, `needsToken`, `managed`, `defaults` |
| `POST` | `/api/setup/verify` | `200` with a correct setup token; `403` wrong, `409` setup already done |
| `POST` | `/api/setup/asset` | `200` `{asset:{id,url,…}}`; `400` for a bad image; needs setup access |
| `POST` | `/api/setup/test-bot` | `200` `{bot:{tag,id,username}}`; `400` if Discord rejects the token or does not answer within 15 s |
| `POST` | `/api/setup/complete` | `200` `{redirect:"/"}`; `400` bad input, `403` locked (add `needsToken`), `409` already complete |

### 21.5 Sign-in

| Method | Path | Answer |
| --- | --- | --- |
| `POST` | `/login` | `303` → `/` on success; `303` → `/login?error=…` otherwise (`invalid`, `locked` or `key_disabled`) |
| `POST` | `/logout` | `303` → `/login` (CSRF required) |
| `GET` | `/auth/discord` | `302` to Discord, or back to `/login?error=discord_disabled` |
| `GET` | `/auth/discord/callback` | `302` → `/` on success; `?error=…` otherwise (`cancelled`, `state`, `expired`, `not_allowed`, `discord_failed`) |

§15.4 translates each `error=` code.

### 21.6 The dashboard's JSON

All of these need the session; everything that is not a `GET` also needs the CSRF
token.

| Method | Path | Answer |
| --- | --- | --- |
| `GET` | `/api/state` | `200` the whole picture: `user`, `csrf`, `presence`, `activity`, `botActivity`, `bot`, `assets`, `draft`, `share`, `templates`, `pairings`, `keepAlive`, `activitySession`, `meta` |
| `GET` | `/api/events` | `200` `text/event-stream`: one `state` event immediately, then one per change, `: ping` every 25 s |
| `GET` | `/api/presence` | `200` `presence`, `activity` (profile payload), `botActivity` (gateway payload) — both fully resolved to URLs |
| `POST` | `/api/presence` | `200` saved **and applied**; `400` with `error` + `errors[]` |
| `POST` | `/api/presence/draft` | `200` `{draft}` staged; `400` same validation |
| `POST` | `/api/presence/publish` | `200` publishes the body, or the stored draft when the body is empty; `400` when there is nothing staged |
| `DELETE` | `/api/presence/draft` | `200` `{draft:null}` |
| `POST` | `/api/presence/clear` | `200` presence switched off everywhere, bot card cleared |
| `POST` | `/api/templates/:id` | `200` `{presence}` merged but **not** saved; `404` unknown template |
| `GET` | `/api/assets` | `200` `{assets:[{id,ext,mime,width,height,bytes,createdAt,url}]}` |
| `POST` | `/api/assets` | `200` `{asset}` from `{dataUrl,name}`; `400` for too large, too small, or not an image |
| `DELETE` | `/api/assets/:id` | `200`; `404` unknown |
| `POST` | `/api/share` | `200` `{share:{slug,url,createdAt}}`; `400` when there is no live presence or the slug is invalid |
| `DELETE` | `/api/share` | `200` `{share:null}` |
| `GET` | `/api/settings` | `200` `{settings}` — non-secret values plus `hasBotToken`, `botTokenPreview`, `hasClientSecret`, `managed`, `keyFromEnv` |
| `POST` | `/api/settings` | `200`; `400` bad URL/ID or a short key; `403` wrong current key when rotating |
| `GET` | `/api/companion/pairings` | `200` `{pairings}` (no tokens — only labels, times and status) |
| `POST` | `/api/companion/pairings` | `200` `{pairing, token, command, scriptUrl, launchers}` — the only time the token is returned; `400` at ten devices |
| `DELETE` | `/api/companion/pairings/:id` | `200`, token invalidated immediately |

**The presence payload**, whether it goes to `/api/presence`, `/draft` or
`/publish`:

| Field | Type | Rule |
| --- | --- | --- |
| `name` | string | required, 128 chars |
| `type` | number | 0 Playing · 1 Streaming · 2 Listening · 3 Watching · 4 Custom · 5 Competing |
| `status` | string | `online`, `idle`, `dnd`, `invisible` |
| `details`, `state` | string | 128 chars each |
| `url` | string | required for Streaming, must be `https://twitch.tv/…` or `https://youtube.com/…` |
| `largeImage`, `smallImage` | string | `asset:<hash>`, an `https://` URL, or a Discord asset key |
| `largeText`, `smallText` | string | 128 chars each |
| `buttons` | array | max 2 × `{label (32), url (https://)}`; invalid entries are dropped |
| `startedAt` | boolean | turns the elapsed timer on |
| `restartTimer` | boolean | re-bases the timer on this save instead of keeping the old start |
| `targets` | object | `{bot, companion}`; at least one must be true |
| `enabled` | boolean | `false` is what **Clear** sets |

There is **no PATCH semantics**: send the whole card. Only `type`, `status`,
`targets`, `enabled` and the timer fields fall back to what is stored; text and
images default to empty, and `name` is required. The one exception is `publish`
with an empty body, which publishes the stored draft as-is.

### 21.7 The in-Discord app

Mounted twice — `/activity/api/*` (the page's own, relative URLs) and
`/api/activity/*` (the same thing for a direct call).

| Method | Path | Answer |
| --- | --- | --- |
| `POST` | `/activity/api/token` | `200` `{accessToken, expiresIn}` from `{code}`; `400` missing code; `503 not_configured` with no client id or secret |
| `GET` | `/activity/api/presence` | `200` `{user, activity, assets, buttons, presence, reason, publicUrl, updatedAt}`; `401` no bearer token; `403 not_allowed`; `503 not_configured` |
| `GET` | `/activity/api/status` | `200` `{configured, applicationId, session:{connected, userId, username, lastSeenAt, error}}` — no auth needed |

`reason` is the sentence the panel shows when `activity` is `null`: no live
presence, *My own profile* unticked, or a card Discord cannot render.

### 21.8 The companion

| Method | Path | Answer |
| --- | --- | --- |
| `GET` | `/companion.js?pair=…` | `200` the agent with this device's config prepended (`no-store`); `404` text when the pairing is gone |
| `GET` | `/companion/start.sh?pair=…` | `200` the Linux launcher |
| `GET` | `/companion/start.command?pair=…` | `200` the macOS launcher |
| `GET` | `/companion/start.bat?pair=…` | `200` the Windows launcher |
| `GET` | `/companion/start-mac.zip?pair=…` | `200` `StatusC0rd-mac.zip` with the launcher at mode `0755` and a READ ME |
| `GET` | `/api/companion/config` | `200` `{label, appId, activity, updatedAt, status}`; `304` when `If-None-Match` matches; `401` not paired |
| `POST` | `/api/companion/heartbeat` | `200` `{ok:true}`; `401` not paired. Body may carry `discordConnected` or `error` |

### 21.9 Errors, in one shape

Anything under `/api/` answers JSON: `{"ok": false, "error": "…"}`, plus
`errors[]` on a presence validation failure. Everything else gets the HTML error
page with the same sentence on it.

| Status | Means | Typical cause |
| --- | --- | --- |
| `400` | the request was understood and refused | validation, bad image, nothing staged, invalid slug |
| `401` | no session, or no bearer token | expired session, revoked pairing |
| `403` | authenticated but not allowed | CSRF mismatch, not on the allowlist, setup locked, wrong current key |
| `404` | no such thing | unknown slug, unknown asset, revoked pairing, unknown guide |
| `409` | already done | setup completed twice |
| `413` | body too large | an upload over 8 MB (or a form over 64 KB) |
| `429` | rate limited | §15.5; `Retry-After` says how long |
| `500` | a real bug or an unwritable disk | the log has the stack trace |
| `503` | not configured, or storage is down | no client secret, unwritable `data/`, Discord unreachable |

### 21.10 Three commands worth having

```sh
# Is it alive, and can the world see it?
curl -s https://YOUR-HOST/health

# What does the operator side think? (paste the cookie from the browser)
curl -s -H "Cookie: statusc0rd.sid=$COOKIE" https://YOUR-HOST/api/health

# Watch the dashboard's own event stream, exactly as the page does
curl -N -H "Cookie: statusc0rd.sid=$COOKIE" https://YOUR-HOST/api/events
```

What the server thinks happened, in the host's log (one line per page and API
request, assets skipped):

```
[http] GET / 200 27527b 1ms
[http] POST /login 303 27b 2ms
[http] GET /api/state 200 2235b 2ms
```

A request that never produces one of these lines never reached the app — which
is the difference between "the server is down or still starting" and "the server
answered and the browser is the problem".

The companion's view of the same state, without touching Discord:

```sh
curl -s -H "Authorization: Bearer $PAIR_TOKEN" https://YOUR-HOST/api/companion/config
```

That is the whole surface — 52 routes: **12 page and file routes, 2 health,
5 setup, 4 sign-in, 19 dashboard, 3 Activity and 7 companion.** If a path is not
in this section, this build does not have it.
