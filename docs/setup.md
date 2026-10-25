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
[troubleshooting](#19-troubleshooting)

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

- `index.js` boots the settings store, the bot, the keep-alive and the HTTP server.
- `app.js` is the whole HTTP surface: views, auth, presence CRUD, photo upload,
  pairings, launcher downloads, the generated companion script.
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
  **Settings**.

If a value is supplied by the environment (`CLIENT_ID`, `DISCORD_TOKEN`, …) the
matching field is disabled and shows the managed value — the environment always
wins.

### 6.4 Step 3 — Presence

- **Activity name** (128 chars) — what Discord prints after "Playing".
- **Type** — Playing, Listening, Watching, Competing. (Streaming needs a Twitch or
  YouTube link and lives in the dashboard's full editor; Custom status is
  text-only.)
- **Status** — Online, Idle, Do not disturb, Invisible.
- **Details (line 1)** and **State (line 2)** — 128 chars each.
- **Large / small photo** — click the slot, pick a file, or drag one onto it.
  Photos are cropped to a square and downscaled in your browser before upload.
- **Keep this server awake** — the 24/7 keep-alive (§10). Leave it ticked.
- **Public URL of this dashboard** — pre-filled with the address you are using.
  It must be the public `https://` origin; it is the base for photo URLs and the
  keep-alive target.

Press **Finish setup**. StatusC0rd saves the admin key, the Discord values, the
presence and the keep-alive settings, signs you in, and drops you on
**My profile** with the **Open in Discord** button in front of you.

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

Before setup, every path redirects to `/setup`. After it, `/` needs a session and
sends you to `/login`; a session lasts 8 hours and then you sign in with the key
again. Dashboard pages are sent `no-store`, so a shared browser never keeps a
stale copy of your card.

### 7.2 The top bar

- **Brand and version** — the version this instance is running, the same number
  `/api/health` reports.
- **Bot pill** — *Bot online*, *Connecting…*, *Reconnecting…* (automatic backoff
  after a network blip), *Bot offline* (a bad token or a sleeping host) or *No
  bot*. Hover it for the reason.
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
| **Photos** | the image library — reuse, inspect or delete what you uploaded | §8.6 |
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

Ten starting points: **Focus mode, Listening, Building, Watching, Gaming,
Studying, Reading, On a break, In the studio, Ranked**. Clicking one fills the
form; the photo you already picked and your target choices survive. Nothing is
published by clicking a template — you still press **Publish**.

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
| Timer | on/off plus "restart from now" | counts up from the moment you publish |

### 8.3 Photos

- Use **drag and drop**, **paste** (`Ctrl`/`Cmd` + `V`), the file picker, or
  **Reuse** to pull one out of your library.
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

### 8.4 Draft, publish, discard

- Every edit is staged and autosaved as a **draft** — on any device — and nothing
  reaches Discord until you press **Publish**.
- **Publish** validates, saves and applies: the bot card updates immediately and
  the in-Discord app picks the new card up within about 5 seconds.
- **Discard draft** throws the staged edits away and puts the live card back in
  the form.
- Closing the tab with a save in flight asks for confirmation; everything else is
  already saved.

### 8.5 Where it shows

Two checkboxes under **Show this presence on**:

- **The bot** — the text card, 24/7, on your server.
- **My own profile** — photos, buttons, timer, in the Discord app.

Pick one or both; at least one is required. Un-ticking *My own profile* is why an
Activity can legitimately show "no presence" while the dashboard looks fine — the
Activity names that reason explicitly.

### 8.6 The Photos tab

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

If the tab shows a yellow **"This dashboard is not on HTTPS"** warning, Discord
will refuse to load your images — fix `PUBLIC_URL` first (§16), then publish
again.

---

## 9. Step 5: on your own profile, no install

1. **My profile** tab → **Open in Discord**. That link is
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

- **Keep this server awake** (ticked by default).
- **Interval** — 5 to 60 minutes, default 10. Keep it under the host's idle
  timeout (Render: 15 minutes).

The card shows **Active** with "Last ping … · N pings" once a ping succeeds. If it
says **Waiting**, the URL is unreachable from the server. If it says **Paused**,
the URL is missing.

Environment equivalents: `KEEP_ALIVE=true|false`,
`KEEP_ALIVE_INTERVAL_MINUTES=10`. Keep-alive only starts when `PUBLIC_URL` is set.

**The bot status panel** shows connection state, the bot account, the last
presence update and uptime. The expected states are *Bot online*, *Connecting…*,
*Reconnecting…* (network blip, automatic exponential backoff), *Bot offline*
(bad token or a sleeping host) and *No bot*.

> A bot card can only carry **name, type and state**. Discord strips images and
> buttons for bot accounts; that is a platform limit, not a bug here.

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
  anything else is a 404.
- The card is regenerated from the live presence, so it updates when you publish.

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

---

## 13. Step 9: verify the whole install

Run through this once, on whatever host you chose. It catches every typical
mistake.

| # | Check | Expected |
| --- | --- | --- |
| 1 | `https://YOUR-HOST/health` | `{"status":"ok","uptimeSeconds":…}` (nothing else — that is deliberate) |
| 2 | Sign in, then `https://YOUR-HOST/api/health` | `status: ok`, `storage: ok`, `setup: complete`, `version` |
| 3 | **Bot & 24/7** | *Bot online*, account name, a recent presence update |
| 4 | **Bot & 24/7 → Keep-alive** | **Active**, "Last ping …", pings counting up |
| 5 | Upload a photo, **Publish**, open the photo URL from the asset list | the image loads, `https://` and no login |
| 6 | Discord, in a server where the bot is a member | the bot's card shows your activity text |
| 7 | **My profile → Open in Discord** | panel opens, pill says **On your profile** |
| 8 | Look at your own Discord profile | photo, both lines, timer, buttons |
| 9 | Change the state text in the dashboard | panel and profile update within ~5 s |
| 10 | Close the panel | the card disappears; the bot card is still there |
| 11 | **Share card → Create**, open `/c/<slug>` in a private window | the card renders; no dashboard |
| 12 | Restart the host | with env values set, the dashboard comes back without the wizard; on an ephemeral disk, photos are gone — that is the host, not a bug |

If a check fails, §19 has the symptom-to-cause table.

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

### 15.5 Deployment hygiene

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
- **Sessions last 8 hours.** Re-sign-in after that; the dashboard key still works.

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
