# StatusC0rd — the complete setup

Everything here is free. No paid plan, no domain, no email provider, no card on
file. This document takes you from an empty browser tab to a custom rich presence
on your own Discord profile and a bot that keeps a card online 24/7.

Read it top to bottom the first time. Every step says what you should see when it
worked, so you never have to guess whether to continue.

---

## Contents

1. [What you are building](#1-what-you-are-building)
2. [The one rule that shapes everything](#2-the-one-rule-that-shapes-everything)
3. [What is free, and what is not](#3-what-is-free-and-what-is-not)
4. [Part 1 — The Discord application](#part-1-the-discord-application)
5. [Part 2 — Put the website online (free)](#part-2-put-the-website-online-free)
6. [Part 3 — First boot and the wizard](#part-3-first-boot-and-the-wizard)
7. [Part 4 — Build your card in the dashboard](#part-4-build-your-card-in-the-dashboard)
8. [Part 5 — Put it on your own profile](#part-5-put-it-on-your-own-profile)
9. [Part 6 — The bot card, online 24/7](#part-6-the-bot-card-online-247)
10. [Part 7 — Accounts for your server](#part-7-accounts-for-your-server)
11. [Part 8 — Verify the whole thing](#part-8-verify-the-whole-thing)
12. [Part 9 — Keep your data](#part-9-keep-your-data)
13. [Part 10 — Updating](#part-10-updating)
14. [Part 11 — Security](#part-11-security)
15. [Part 12 — Every setting and environment variable](#part-12-every-setting-and-environment-variable)
16. [Part 13 — Every limit](#part-13-every-limit)
17. [Part 14 — Troubleshooting](#part-14-troubleshooting)
18. [Part 15 — Appendix: every route](#part-15-appendix-every-route)
19. [Part 16 — Frequently asked](#part-16-frequently-asked)

---

## 1. What you are building

Two things, on one small server:

```
Browser ──HTTPS──▶ StatusC0rd
                     ├─▶ /assets/<id>.png   photos Discord can fetch
                     ├─▶ Discord Activity   → your own profile: photos + buttons
                     └─▶ Discord gateway    → the bot card, always online
```

| | **Your profile** — in-Discord app | **The bot card** |
| --- | --- | --- |
| Whose card it is | yours | the bot account |
| Name, type, status | yes | yes |
| Details / second line | yes | limited by Discord |
| **Photos** | yes | **no** |
| **Buttons** | yes | **no** |
| Elapsed timer | yes | yes |
| How long it stays | while the panel is open | 24/7, no browser needed |
| Install required | **none** | none |

You will finish with:

- a free website on a public HTTPS address,
- your own account there, with a card showing text, photos, a timer and buttons,
- that card on your real Discord profile,
- optionally a bot whose card stays up while you are asleep,
- optionally accounts for other people, each with their own card.

---

## 2. The one rule that shapes everything

**A bot cannot show photos or buttons.** Discord only renders `name`, `type` and
`state` for bot accounts; images and buttons are stripped before they reach
anyone's screen. That is Discord's rule and no code can change it.

So there are two delivery paths, and the app uses both:

- **Your profile** (photos, buttons, both lines) is written by a **Discord
  Activity** — a web page Discord loads inside the client and lets talk to the
  local user. That is the *in-Discord app* in this project. Nothing is installed,
  and it only works while the panel is open.
- **The bot card** (text only) is written by a **gateway connection** from your
  server. It survives you closing Discord, shutting your laptop, and sleeping.

If someone promises photos on a bot card, they are wrong, or they are secretly
running an Activity.

---

## 3. What is free, and what is not

| Thing | Cost | The catch |
| --- | --- | --- |
| Discord application | free | none — you only need an account |
| StatusC0rd itself | free | open source, self-hosted |
| **Render free tier** | free | sleeps after 15 idle minutes; disk is wiped on restart; 750 instance-hours/month; 512 MB RAM |
| **Oracle Always Free** | free forever | signup needs a card (not charged); ARM capacity is sometimes unavailable; idle instances may be reclaimed |
| **GCP free tier** | free inside quota | 1 GB egress/month; only three US regions qualify; billing account required |
| HTTPS certificate | free | automatic on Render; Caddy on a VM |
| `https://something.onrender.com` address | free | you get no custom domain on the free plan |
| PostgreSQL, Redis, SMTP, mail API | **not needed** | the app has no email and no database |
| Photos | free | stored on your own server, served by it |
| A custom domain | **paid** (≈$10/year) | optional, never required |

**There is nothing to buy to complete this guide.** A domain is the only thing you
might want later, and the app works forever without one.

---

## Part 1. The Discord application

You need four things from the Discord Developer Portal. The first two are
required; the third is optional; the fourth is one toggle most people miss.

### 1.1 Create the application

1. Open <https://discord.com/developers/applications>.
2. **New Application** → give it a name (this name is visible in Discord, so pick
   what you want people to see) → accept the terms → **Create**.

### 1.2 Copy the Application ID

**General Information → Application ID** → **Copy**.

- It is a long number (17–20 digits), not the name.
- It is public and safe to share.
- In the dashboard this is the **Application (client) ID**.

### 1.3 Copy the Client Secret

**OAuth2 → Client Secret → Reset Secret → Copy**.

- Treat it like a password. It never reaches a browser; the server uses it to
  finish the Activity's sign-in.
- If it leaks, reset it here and paste the new one into the dashboard. Old
  sessions stop working, which is exactly what you want.

### 1.4 Optional: a bot token

Only needed for the 24/7 text card. Skip it if you only want photos and buttons
on your profile.

**Bot → Reset Token → Copy**.

- Shown once. Store it somewhere safe before leaving the page.
- Also on that page: turn **Public Bot** off if this app is just for you, so
  nobody else can invite it.
- No privileged intents are needed. The app only sets its own presence.

### 1.5 Turn the Activity on

**Activities → Settings → Enable Activities** (the toggle).

Without this, the in-Discord app has nowhere to run and you will get a blank
frame inside Discord.

### 1.6 Map the URL

Still under **Activities → URL Mappings**:

| Prefix | Target |
| --- | --- |
| `/` | `https://YOUR-HOST/activity/` |

- **The trailing slash matters.** `…/activity` without it fails.
- Replace `YOUR-HOST` with the address you will get in Part 2. Doing this before
  you know the address is fine — come back and edit it.

### 1.7 Install the app in your server

Build the invite URL by hand, or use the one the dashboard shows on **Bot & 24/7**:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=0
```

- `applications.commands` is the scope that puts the app in Discord's **App
  Launcher** — the entry point for the Activity. Without it, the Activity can
  never be opened, so photos and buttons have no way to reach your profile.
- `permissions=0` is correct: the app needs no permissions at all.

Open the URL, choose a server you own, **Authorize**.

### 1.8 Register the redirect URL (for "Connect Discord" and Discord sign-in)

**OAuth2 → Redirects → Add Redirect**:

```
https://YOUR-HOST/auth/discord/callback
```

- Needed for **Connect Discord** on the Discord tab, which is how the app knows
  whose card to push.
- Also needed if you want **Continue with Discord** on the login page.
- The dashboard prints the exact URL to copy: **Discord** tab → *One-time setup*
  shows it, and so does the login page when Discord sign-in is unavailable.

### 1.9 Checklist before moving on

- [ ] Application ID copied
- [ ] Client secret copied
- [ ] Bot token copied (only if you want the 24/7 card)
- [ ] **Enable Activities** is on
- [ ] URL mapping `/` → `https://YOUR-HOST/activity/`
- [ ] App invited to your server with `bot applications.commands`
- [ ] Redirect `https://YOUR-HOST/auth/discord/callback` registered

---

## Part 2. Put the website online (free)

Pick **one** path. Render is the shortest; Oracle gives you a real disk for the
same money.

> **Why the disk matters.** Render's free disk is wiped on every restart,
> redeploy and spin-down. Environment variables survive; uploaded photos and the
> settings file do not. Oracle Always Free has a real volume, so nothing is lost.

### Path A — Render free (10 minutes, easiest)

1. **Fork this repository** to your own GitHub account (top-right **Fork**).
2. Open <https://dashboard.render.com> → **New +** → **Blueprint** → pick your
   fork → **Connect**.
   Render reads `render.yaml` and fills in: Node 22, `npm ci`, `npm start`,
   health check `/health`, plan `free`.
3. Render asks for the variables marked `sync: false`. You can fill them in now
   **or** leave them blank and use the browser wizard in Part 3. Either works.

   | Variable | Value |
   | --- | --- |
   | `DASHBOARD_KEY` | your owner login, 12+ characters (make one up) |
   | `CLIENT_ID` | Application ID from Part 1 |
   | `CLIENT_SECRET` | client secret from Part 1 |
   | `DISCORD_TOKEN` | bot token — optional |
   | `PUBLIC_URL` | leave blank for now |
   | `SETUP_TOKEN` | leave blank |
   | `ALLOWED_DISCORD_IDS`, `REDIRECT_URI` | leave blank |

   > Setting `DASHBOARD_KEY` in the environment means the wizard is **skipped**
   > and the site is configured immediately. That is the safer choice on Render,
   > because it survives a wiped disk. If you prefer the guided wizard, leave
   > `DASHBOARD_KEY` blank.

4. **Apply** → wait for the status **Live** → copy the URL
   (`https://something.onrender.com`).
5. **Environment** → set `PUBLIC_URL` to that exact URL, no trailing slash →
   **Save**. Render redeploys itself.
6. Go back to Part 1.6 and put that URL in the Discord URL mapping.

**Render free truths**

- 750 instance-hours per workspace per month; a 31-day month is 744, so exactly
  one always-on service fits. Do not add a second one.
- Sleeps after 15 minutes without traffic — the keep-alive in Part 6 prevents it.
- Cold start after a real sleep is about a minute.
- Free services cannot use a custom domain.

### Path B — Oracle Always Free (permanent, real disk)

1. Create an **Always Free** Ampere A1 or AMD micro instance, Ubuntu 24.04, with
   your SSH key. Open ports **22, 80, 443** in the security list *and* in
   `ufw`.
2. Point a free hostname at it: **DuckDNS** (`yourname.duckdns.org`) is free and
   gives you a name that Caddy can get a certificate for.
3. Install Node 20+ and Docker, clone your fork to `/opt/statusc0rd`.
4. Run it, mounted to a real directory:

   ```sh
   docker build -t statusc0rd .
   docker run -d --restart unless-stopped \
     -p 127.0.0.1:3000:3000 \
     -v /opt/statusc0rd/data:/app/data \
     -e PUBLIC_URL=https://yourname.duckdns.org \
     -e NODE_ENV=production \
     --name statusc0rd statusc0rd
   ```

5. Put **Caddy** in front for free HTTPS:

   ```
   yourname.duckdns.org {
     reverse_proxy 127.0.0.1:3000
   }
   ```

6. `docker logs statusc0rd | grep "Setup token"` → use it in Part 3.

**Oracle catches:** signup asks for a card (not charged); ARM capacity is
sometimes full and you may have to retry later; a completely idle instance can be
reclaimed.

### Path C — GCP free tier (e2-micro)

1. Create an **e2-micro** in `us-west1`, `us-central1` or `us-east1` — the only
   free regions. Reserve a static IP, allow 80/443.
2. Install Node 20+, clone the repo to `/opt/statusc0rd`, `npm ci`.
3. Run it under systemd as a service, with `PUBLIC_URL=https://YOUR-HOST` in the
   unit file or an env file.
4. Caddy in front for HTTPS, exactly as in Path B.
5. Turn the **keep-alive off** (default 10-minute pings are fine, but egress is
   capped at 1 GB/month — a 10-minute ping to `/health` is tiny, a 5-minute one is
   also fine; just do not add more services).

**GCP catches:** a billing account is required, egress is capped, and only three
US regions are free.

### Path D — Your own computer (testing only)

```sh
npm ci
npm start          # http://localhost:3000
```

Works immediately, and the wizard needs no token on localhost. But Discord
**cannot** fetch photos from `localhost`, and the Activity needs a public HTTPS
URL, so this is for building cards, not for going live. When you want it live,
put a tunnel in front (Cloudflare Tunnel or `ssh -R`) and set `PUBLIC_URL` to the
public address.

Photos still work here: you can upload, and they preview exactly as they will
look. What the server will not do is hand Discord a `http://` address it cannot
fetch, so the image is left out of what it sends while the rest of the card goes
through. The editor says so under the preview. The moment `PUBLIC_URL` is an
`https://` address, the same card carries the photo.

### Whatever path you picked

Write down your public URL. It looks like `https://something.onrender.com` or
`https://yourname.duckdns.org`. It must:

- be **HTTPS** (photos and the Activity both require it),
- have **no trailing slash**,
- resolve from the internet, not just your machine.

---

## Part 3. First boot and the wizard

Open your URL. The first visit goes to `/setup`.

### 3.1 Unlocking setup (only when the instance is public)

If the address is not localhost, the wizard asks for a **setup token**. It is
printed at boot:

```
  Setup token: 3f9a1c77d2b84e50
  (also stored in data/setup-token.txt)
```

- On Render: **Logs** tab, first few lines.
- On a VM: `docker logs statusc0rd` or `journalctl -u statusc0rd`.
- Enter it, press **Unlock**. The grant lasts 30 minutes.

This exists so a stranger who finds your fresh deployment cannot claim it.

### 3.2 Step 1 — Account

- **Dashboard key** — 12+ characters. This is *your* way in and it opens the admin
  panel. Use **Generate a strong key** if you like; copy it somewhere safe.
- **Repeat key** → **Continue**.

> You are not creating a normal account here. Members register themselves later
> (Part 7); the key is the owner's door.

### 3.3 Step 2 — Discord application

- **Application (client) ID** — from Part 1.2.
- **OAuth2 client secret** — from Part 1.3.
- Optional, under *a bot card that stays online 24/7*: **bot token** from Part 1.4.
- Optional: **allowed Discord accounts** — comma-separated user IDs permitted to
  sign in with Discord. Leave empty unless you want that.

**Continue.**

### 3.4 Step 3 — First card

- **Name**, **type** (Playing / Streaming / Listening / Watching / Custom /
  Competing), **status** (online, idle, do not disturb, invisible).
- **Details** and **State** — the two lines under the name.
- **Large / small photo** — click a slot and pick a file. Images are cropped to a
  square and downscaled in your browser before upload.
- **Keep this server awake** — the keep-alive from Part 6. Leave it ticked.
- **Public URL of this dashboard** — pre-filled with the address you are using.
  It must be the real public `https://` origin.

Press **Finish setup**.

**What happens:** the key, the Discord values, the card and the keep-alive are
saved, you are signed in as the owner, and you land on **Discord** with the
*Open in Discord* button in front of you.

### 3.5 If you set `DASHBOARD_KEY` in the environment

The wizard never appears; the instance counts as configured from first boot.
Sign in at `/login` with that key instead, then finish the Discord values under
**Settings**.

---

## Part 4. Build your card in the dashboard

`/` with a session shows the dashboard: six tabs for the owner, three for a
member.

### 4.1 Tabs

| Tab | What it does |
| --- | --- |
| **Presence** | the editor and the live preview — everything that reaches Discord |
| **Photos** | your image library: reuse, inspect, delete |
| **Discord** | connect your Discord account, open the in-Discord app, one-time setup |
| **Bot & 24/7** | bot status, invite link, keep-alive *(owner)* |
| **Members** | accounts, passwords, sign-up switch *(owner)* |
| **Settings** | application ID, secret, bot token, key rotation *(owner)* |

### 4.2 The editor, field by field

| Field | What it is | Limit |
| --- | --- | --- |
| **Activity name** | the bold first line | required, 128 chars |
| **Type** | Playing, Streaming, Listening, Watching, Custom, Competing | — |
| **Status** | online, idle, do not disturb, invisible | — |
| **Details** | first line under the name | 128 chars |
| **State** | second line | 128 chars |
| **URL** | Streaming only, must be `twitch.tv` or `youtube.com` | 512 chars |
| **Large image / small image** | an uploaded photo, an `https://` URL, or a Discord asset key | 512 chars |
| **Large text / small text** | tooltips on the images | 128 chars each |
| **Buttons** | up to **2**, label + `https://` link | label 32 chars |
| **Elapsed timer** | shows `01:23:45` on your card | — |
| **Restart timer** | re-bases the start time on publish | — |
| **Where it shows** | *The bot* and/or *Your profile* — at least one | — |

**Custom status (type 4)** renders as text only: no images, no buttons.

### 4.3 Templates

Ten starting points (**Focus mode**, **Listening**, **Building**, and more) fill
in a complete, valid card in one click. They never overwrite your images or your
*Where it shows* choice. Edit whatever you like afterwards.

### 4.4 Drafts and publishing

- Editing autosaves a **draft** about a second after you stop typing. Nobody sees
  a draft: it is not on Discord.
- **Publish** is what makes it real, and it lands in about a second.
- **Discard** throws the draft away.
- **Clear** switches the card off everywhere.
- Closing the tab with a save in flight asks first.

### 4.5 Photos

- Drag and drop, paste, or click to pick a file.
- Accepted: **PNG, JPEG, WebP, GIF**, 16×16 to 4096×4096, **2 MB** max after
  decoding.
- Uploads are content-hashed, so the same image uploaded twice is stored once.
- Discord only fetches images over public **HTTPS**. On an `http://` install
  (localhost, a LAN address) the upload and the preview work, but the server
  drops the image from what it sends, and the editor says why. Publish from an
  `https://` address and it appears.
- Discord caches artwork for a few minutes; a brand-new image can take a moment
  to appear, and occasionally a client restart.

---

## Part 5. Put it on your own profile

Photos and buttons only land here. This is the step people skip, and then wonder
why their profile shows nothing.

### 5.1 Connect Discord, once

**Discord tab → Connect Discord** → approve in the Discord window.

- This tells the server which Discord user *you* are: the Activity only ever
  learns a Discord user id, so the link is how it finds the right card.
- The status line turns green: *Connected. The in-Discord app will push this card
  onto your Discord profile.*
- If it says **unconfigured**, the client ID or secret is missing — **Settings →
  Application & bot**.
- If it says **already linked**, another account claimed that Discord user.
  Unlink it under **Members → Unlink Discord** on the wrong row, then try again.

### 5.2 Open the app

**Discord tab → Open in Discord** (or copy the link and paste it into Discord).

In Discord: join any voice channel → open the **App Launcher** → pick your app.
Keep the window open — it shows exactly what your friends see.

### 5.3 What you should see

1. The panel opens inside Discord.
2. The dashboard's profile pill turns **Profile live (Discord)**.
3. Your own Discord profile shows the photo, both lines, the timer and the
   buttons.
4. Change a line in the dashboard and press **Publish** → your profile updates
   within about five seconds, no rejoin.

### 5.4 When you close the panel

The rich card disappears, because Discord only keeps a user's Activity presence
while the Activity is running. The bot card (Part 6) is the one that survives —
and it is text-only by Discord's design.

---

## Part 6. The bot card, online 24/7

Optional. Skip it if your profile card is enough.

### 6.1 Give it a token

**Settings → Application & bot → Bot token** → paste → **Save**.

The bot reconnects immediately. **Bot & 24/7** should show **Bot online** with the
bot's name.

> The field is write-only. It shows `Current token MTA…AbCd` (first six and last
> four characters) and accepts *blank* to keep what is stored. Never clear it to
> "start over" — paste the new token instead.

### 6.2 Invite the bot

**Bot & 24/7 → Invite link → Copy**, open it, pick your server, **Authorize**.

The link asks for `bot` and `applications.commands` with zero permissions. If the
activity never appears in the App Launcher, this invite is the reason — re-invite
with the full link.

### 6.3 Keep the free host awake

**Bot & 24/7 → 24/7 online**:

- **Keep this server awake** — ticked.
- **Interval** — anything **under 15 minutes** (default 10; minimum 5).

The server pings its own `PUBLIC_URL/health` on that schedule. That inbound
traffic is what stops Render from spinning the service down, and a spun-down
service is an offline bot.

- It needs `PUBLIC_URL` to be set and reachable **from the internet**. A loopback
  request does not count as activity for the platform.
- It says **Waiting** until the first successful ping.
- On a VPS with a real disk and no sleep, you can leave it on or turn it off; it
  costs nothing either way.

### 6.4 What the bot shows

Only **name**, **type** and **state**, and the elapsed timer. Photos and buttons
are impossible on a bot account. Tick or untick **The bot** under *Where it
shows* to choose whether your card goes to it.

The bot's card belongs to the **owner** account. Members' cards go to their own
profiles and can never touch the bot.

---

## Part 7. Accounts for your server

Optional. Skip it if this instance is just for you.

### 7.1 Let people sign up

**Members → Let anyone with the link create an account**.

- On by default. Anyone who knows your URL can register at `/register`.
- Turn it off and the form says *Sign-ups are closed* while existing accounts keep
  working.

### 7.2 Or create accounts by hand

**Members → Add someone by hand**: email, optional name, starting password (10+
characters) → **Create account**.

Send them the email and password yourself. **This build sends no email** — no
verification, no reset link, no invite. That is deliberate: no SMTP host, no API
key, no domain, nothing to pay for.

### 7.3 What each member gets

- Their own card, photos, and Discord link.
- Three tabs: Presence, Photos, Discord.
- No access to the bot, Settings, or anyone else's data — enforced on the server,
  not just hidden in the UI.

### 7.4 Managing people

| Button | Effect |
| --- | --- |
| **Reset password** | sets a new one; every session open on the old one is signed out within a second |
| **Unlink Discord** | forgets the Discord link so it can be claimed again |
| **Remove** | deletes the account, its card and its photos; the card leaves that profile at the app's next poll |

### 7.5 What each member must do

Tell them these three things, in this order:

1. Register at `/register`, or use the login you gave them.
2. **Discord → Connect Discord**, once.
3. **Discord → Open in Discord** and leave the panel open.

Skip step 2 and nothing appears — the app cannot know whose card to push.

---

## Part 8. Verify the whole thing

Run this once. It catches every common mistake.

| # | Check | Expected |
| --- | --- | --- |
| 1 | `https://YOUR-HOST/health` | `{"status":"ok","uptimeSeconds":…}` and nothing else |
| 2 | Sign in → `https://YOUR-HOST/api/health` | `status: ok`, `setup: complete`, `storage: ok` |
| 3 | **Bot & 24/7** | *Bot online*, a recent update (skip if no token) |
| 4 | **Bot & 24/7 → Keep-alive** | **Active**, pings counting up |
| 5 | Upload a photo → **Publish** → open the photo URL in a private window | the image loads, over `https://`, no login |
| 6 | Discord, in the server where the bot is | the bot's card shows your text |
| 7 | **Discord → Open in Discord** | the panel opens, pill says **Profile live (Discord)** |
| 8 | Your own Discord profile | photo, both lines, timer, buttons |
| 9 | Change the state text → **Publish** | the profile updates within ~5 s |
| 10 | Close the panel | the rich card goes; the bot card stays |
| 11 | `/register` in a private window | the form opens (or *Sign-ups are closed* if you shut it) |
| 12 | Sign in as a member in a private window | three tabs only; no Settings, no Members |
| 13 | Restart the host | with env values set, the dashboard comes back without the wizard |

If one fails, Part 14 has the symptom.

---

## Part 9. Keep your data

Everything lives in `DATA_DIR` (default `./data`):

```
data/
├── settings.json     accounts, cards, photos index, Discord links
├── assets/           the uploaded photos themselves
└── setup-token.txt   the wizard token (deleted once setup is done)
```

| Host | Risk | What to do |
| --- | --- | --- |
| **Render free** | the whole disk is wiped on restart, redeploy or spin-down | keep `DASHBOARD_KEY`, `CLIENT_ID`, `CLIENT_SECRET`, `DISCORD_TOKEN`, `PUBLIC_URL` in **Environment** so a wiped instance boots straight back into a working dashboard; expect to re-upload photos |
| **Oracle** | nothing, while the boot volume exists | `tar -czf backup.tgz /opt/statusc0rd/data` on a timer, or copy down with `scp` |
| **GCP** | nothing, the disk is persistent | same; watch the 30 GB cap |
| **Your own PC** | nothing | copy `data/` when you move machines |

To restore: stop the app, drop the folder back, start it. No format changes to
worry about — the store migrates itself forward on boot.

---

## Part 10. Updating

- **Render**: `git pull` on your fork, or merge the upstream repo into it. With
  `autoDeploy: true` Render redeploys on the push.
- **Docker / VM**: `git pull && docker build -t statusc0rd . && docker restart
  statusc0rd` (rebuild first, then restart the container).
- **Data** survives an update. The settings file is versioned and migrates
  forward automatically; it is never migrated backwards, so keep a copy before a
  big version jump.

---

## Part 11. Security

- **The dashboard key is the admin panel.** Twelve characters minimum, stored as a
  scrypt hash, compared in constant time. Five wrong attempts from one IP blocks
  sign-in for 15 minutes.
- **Member passwords** use the same scrypt with a per-user salt, 10 characters
  minimum.
- **Sessions** last 8 hours, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS.
  Deleting an account or resetting its password retires every session opened
  before it.
- **CSRF** tokens on every write; OAuth state is random, single-use, 10 minutes.
- **Each account is isolated on the server**: a member cannot write the bot's
  presence or read another account's photos, whether or not the UI offers it.
- **Uploads** are sniffed by magic bytes, capped at 2 MB, and served from
  content-hashed filenames.
- **Setup** cannot be claimed remotely without the one-time token.
- **Never share**: your client secret, your bot token, your dashboard key.
  Rotating any of them is instant — paste the new value into **Settings**.

**Lost your dashboard key?** Stop the app, edit `data/settings.json`, delete the
`admin` object (`"admin": {"keyHash": "", "keySalt": "", "updatedAt": null}`),
start it again, and `/setup` returns so you can set a new one. Everything else is
preserved.

---

## Part 12. Every setting and environment variable

Environment variables are **optional**. The wizard writes the same values to
`data/settings.json`, and the environment wins when both exist — which is why
managed hosts should use it.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `production` adds HSTS, blocks framing of the dashboard, marks cookies `Secure` behind TLS |
| `DATA_DIR` | `./data` | where `settings.json`, `assets/` and the setup token live |
| `PUBLIC_URL` | unset | public origin for photo URLs and the keep-alive; must be the real `https://` URL, no trailing slash |
| `CLIENT_ID` | unset | Discord application ID (public) |
| `CLIENT_SECRET` | unset | OAuth2 secret; enables the in-Discord app and Discord sign-in |
| `DISCORD_TOKEN` | unset | bot token for the 24/7 text card |
| `BOT_ENABLED` | on when a token exists | `false` runs the dashboard without a gateway |
| `DASHBOARD_KEY` | unset | the owner key; setting it also marks the instance configured and skips the wizard |
| `SESSION_SECRET` | generated | cookie signing key; 32+ characters (`openssl rand -hex 32`) |
| `SETUP_TOKEN` | generated | a fixed setup token instead of the one in `data/setup-token.txt` |
| `SETUP_REQUIRE_TOKEN` | unset | `1` demands the setup token even on localhost |
| `ALLOWED_DISCORD_IDS` | unset | comma/space separated IDs allowed to sign in with Discord and launch the app |
| `REDIRECT_URI` | `<PUBLIC_URL>/auth/discord/callback` | override the OAuth callback |
| `KEEP_ALIVE` | `true` | force the keep-alive on or off (still needs `PUBLIC_URL`) |
| `KEEP_ALIVE_INTERVAL_MINUTES` | `10` | ping interval, clamped to 5–60 |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | which hops may set `X-Forwarded-*`; `false` when exposed directly, or a hop count |
| `LOG_REQUESTS` | on | one `[http] METHOD /path status bytes ms` line per page and API request; `0` silences it |

A template lives in `.env.example`. You can also drop a `.env` next to `index.js`;
it is read at boot. Invalid values never stop the server — it prints `[config] …`
warnings and carries on.

---

## Part 13. Every limit

**Card**

- Name, details, state, image text: **128 characters** each.
- URL and image fields: **512**.
- Buttons: **2**, label **32**, URL must be `https://`.
- Custom status (type 4) is text only.
- Streaming requires a `https://twitch.tv/…`, `https://youtube.com/…` or
  `https://youtu.be/…` URL.

**Photos**

- 16×16 to 4096×4096 px, **2 MB** after decoding, PNG/JPEG/WebP/GIF.
- Upload request body up to **8 MB** (base64 overhead); ordinary forms 64 KB.

**Accounts and sessions**

- **500** member accounts per instance.
- **10 characters** minimum password; **12** minimum dashboard key.
- Sessions last **8 hours**; the setup grant lasts **30 minutes**.
- **50** allowlisted Discord IDs.

**Rate limits** — per IP, all reset on their own:

| Scope | Limit |
| --- | --- |
| Sign-in failures | 5, then a 15-minute block |
| Writes (publish, upload, settings, members) | 60 per minute |
| Setup endpoints | 20 per 5 minutes |
| In-Discord app | 180 per minute |
| Bot presence updates | serialised to ~1 per 4.5 s |

Being rate-limited returns `429` with `Retry-After`; ordinary use never comes
close.

---

## Part 14. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **Blank page, no `[http]` line in the host's log** | the request never reached Node — the platform's proxy answered (asleep, suspended, out of hours, still deploying) | open `/health` from outside; wake or redeploy; on Render confirm the service is **Live**, not *Suspended* |
| **Blank page, but the log shows `GET / 200`** | the HTML was served, so the browser dropped the CSS/JS | hard reload (`Ctrl/Cmd+Shift+R`), then a private window, then another browser |
| Log shows `GET / aborted by the client` | the browser hung up, usually a proxy timing out on a cold free instance | wait for the instance to be warm (`/health` 200) and reload |
| `/setup` reappears after a restart | ephemeral disk and no `DASHBOARD_KEY` in the environment | put the values in **Environment**, or use a host with a real disk |
| Photos show as a letter or silhouette | wrong `PUBLIC_URL`, not HTTPS, or the host is asleep | fix **Settings → public URL**, re-publish, open the photo URL directly |
| *Profile live* never turns green | the Activity is not open, or Discord is not connected | **Discord → Connect Discord**, then **Open in Discord** and keep it open |
| The profile card vanishes after a while | the panel was closed — Discord only shows it while the Activity runs | reopen the app; the bot card is the 24/7 part |
| A member's card never appears on their profile | they never pressed **Connect Discord** | send them to **Discord → Connect Discord** |
| The Activity is missing from the App Launcher | the app was invited without `applications.commands`, or Activities are disabled | re-invite with the full link; **Activities → Enable Activities** |
| Activity opens a blank frame | URL mapping missing or missing the trailing slash | **Activities → URL Mappings**: `/` → `https://YOUR-HOST/activity/` |
| *not_configured* inside the Activity | no client secret on the server | **Settings → Application & bot** |
| Bot says **offline** | wrong or reset token, or the host is asleep | paste the new token; check the keep-alive |
| Bot goes offline every ~15 min | free host spinning down; keep-alive off or the URL is wrong | correct `PUBLIC_URL`, keep-alive on, interval under 15 min |
| Bot is **online** but the card is empty | *The bot* is unticked, or the card was never published | tick **The bot** under *Where it shows*, press **Publish** |
| Bot card shows "StatusC0rd" after a restart | an old build read a retired settings key (fixed in 3.2.0) | update; otherwise publish once |
| *That dashboard key is not correct* | typo or rotated key | try again; recovery is in Part 11 |
| *Too many failed attempts* | five failures from one IP | wait 15 minutes |
| *That email and password do not match an account* | no such member, wrong password, or a disabled account | reset it under **Members** |
| *Sign-ups are closed* | the switch is off | turn it on, or create the account by hand |
| A member is signed out on its own | you reset their password or removed the account | expected: old sessions die by design |
| *That upload is too large* | over 2 MB after decoding, or over 8 MB in the request | shrink the image |
| *Images must be at least 16×16* | the file is tiny | use a bigger image |
| `/api/health` says `degraded` | `DATA_DIR` is not writable | fix permissions or the mount |
| `EADDRINUSE` at start | another process owns `PORT` | set a different `PORT` |
| `[config] …` warnings at boot | a malformed environment variable | fix it; the server keeps running |
| Every `/api/…` answers `401` | the session expired (8 h) or cookies are blocked | sign in again |
| *Please slow down* | a rate limit | wait for `Retry-After` |

---

## Part 15. Appendix: every route

| Method | Route | Who | What |
| --- | --- | --- | --- |
| `GET` | `/` | anyone | the front page signed out; the dashboard signed in; `/setup` before setup |
| `GET` | `/setup` | first run | the three-step wizard |
| `GET`/`POST` | `/login` | anyone | member email + password, the owner key, or Discord |
| `GET`/`POST` | `/register` | anyone, while open | self-serve sign-up |
| `POST` | `/logout` | signed in | ends the session |
| `GET` | `/auth/discord` | anyone | Discord sign-in |
| `GET` | `/auth/discord/link` | signed in | claims a Discord account for this user |
| `GET` | `/auth/discord/callback` | — | both flows return here |
| `GET` | `/activity/` | Discord | the in-Discord app |
| `GET` | `/assets/:hash.:ext` | anyone | a photo, cached for a year, `ACAO: *` |
| `GET` | `/health` | anyone | `{"status":"ok"}` and nothing else |
| `GET` | `/api/health` | signed in | version, storage, bot, keep-alive, Activity |
| `GET` | `/api/state` | signed in | the dashboard's whole picture |
| `GET` | `/api/events` | signed in | SSE stream of every change |
| `GET`/`POST` | `/api/presence` | signed in | read / save and apply the card |
| `POST` | `/api/presence/draft` | signed in | stage without publishing |
| `POST` | `/api/presence/publish` | signed in | publish the draft or the posted body |
| `DELETE` | `/api/presence/draft` | signed in | discard the draft |
| `POST` | `/api/presence/clear` | signed in | switch the card off |
| `POST` | `/api/templates/:id` | signed in | merge a template |
| `GET`/`POST` | `/api/assets` | signed in | list / upload photos |
| `DELETE` | `/api/assets/:id` | signed in | delete a photo |
| `GET`/`POST` | `/api/settings` | **owner** | instance configuration, key rotation, sign-up switch |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/admin/users…` | **owner** | accounts, passwords, unlinking, removal |
| `POST` | `/activity/api/token` | Discord SDK | code → access token |
| `GET` | `/activity/api/presence` | Activity | the card to push |
| `GET` | `/activity/api/status` | anyone | whether the Activity is configured |

Everything except the public routes needs a session; every write also needs the
CSRF token from `/api/state`. Errors under `/api/` are JSON:
`{"ok": false, "error": "…"}`.

---

## Part 16. Frequently asked

**Do I need a bot at all?**
No. Without a token you still get photos, buttons and the timer on your profile.
The bot only adds the text card that stays up when you are away.

**Why can't the bot show photos?**
Discord strips images and buttons for bot accounts. Only an Activity can set a
user's rich presence. This is a Discord restriction, not a limitation of this
app.

**Will my card show when Discord is closed?**
The bot card will. The rich card needs the in-Discord panel open, because it is
literally a web page inside Discord writing your presence.

**Can several people share one instance?**
Yes — that is what accounts are for. One owner, up to 500 accounts, one card each.
Each person connects their own Discord account and publishes their own card.

**Does it need a database?**
No. One JSON file plus a folder of images.

**Does it need email?**
No. Email is a login identifier only; the owner resets passwords by hand.

**Can I use my own domain?**
Yes on Oracle, GCP or any VPS. On Render's free plan you get the `onrender.com`
address; a custom domain is a paid plan feature.

**What happens if I stop paying $0?**
There is nothing to pay. The only recurring cost of this setup is the optional
domain.

**How do I delete everything?**
Stop the app and delete `DATA_DIR`. Rotate the Discord bot token and client
secret in the portal afterwards, since the copies on disk are gone with it.
