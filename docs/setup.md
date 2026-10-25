# StatusC0rd — the complete setup guide, start to finish

> **This is the only setup document.** Everything you need to go from an empty
> Discord account to a rich presence on your own profile lives in this one file.
> Any running StatusC0rd instance serves this same file at **`/guide`**, and the
> public overview lives at `/welcome`. Edit `docs/setup.md` once and both the
> repository and the website show the update.

There are two readers here. Find yourself and skip ahead:

| Who you are | Where to start | What you will do |
| --- | --- | --- |
| **You run the server** (you own the Discord app and the host) | §1, then §4 onward, in order | 13 numbered steps, 15–90 minutes, $0 |
| **Somebody gave you a URL** to their instance | §1 then §9 and §10 | design a card, publish, open the in-Discord app — 5 minutes |
| **You just want to read what the thing is** | §1 and §2 | two minutes |

Everything is configured from the website. There is no config file to edit, no
SQL, no build step, and no restart after the first launch.

**Before you start:** [what this is](#1-what-the-user-gets) ·
[the developer view](#2-what-the-developer-gets) ·
[your free host](#3-which-free-stack-to-pick) ·
[the Discord application](#4-step-1-the-discord-application)

**Deploy it:** [Render](#5-step-2-path-a-render) ·
[Oracle Always Free](#6-step-3-path-b-oracle-always-free) ·
[your own PC or Pi](#7-step-4-path-c-your-own-pc-or-pi)

**Go live:** [first boot](#8-step-5-first-boot-and-the-wizard) ·
[design and publish](#9-step-6-design-and-publish-the-card) ·
[your own profile](#10-step-7-on-your-own-profile-no-install) ·
[24/7 bot card](#11-step-8-the-bot-card-always-online) ·
[share card](#12-step-9-the-share-card-optional) ·
[companion](#13-step-10-the-optional-companion)

**Look after it:** [verify](#14-step-11-verify-the-whole-install) ·
[update and back up](#15-step-12-updates-and-backups) ·
[security](#16-step-13-security-and-rotation) ·
[environment variables](#17-environment-variables) ·
[troubleshooting](#20-troubleshooting)

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
  panel — see §13.

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
- `src/companion/agent.js` is one file used by both the CLI and the in-process
  API; it speaks Discord's IPC protocol directly, with no extra dependencies.
- `data/` holds `settings.json` (mode `0600`), `assets/` and `setup-token.txt`.
  `DATA_DIR` moves it. **That directory is the deployment's state.**
- `npm test` = 135 tests, including `test/companion-e2e.test.js`, which drives a
  real dashboard (upload → pair) and runs the real companion against a fake
  Discord socket, asserting the exact `SET_ACTIVITY` frame.
- `npm run check` = syntax check across every source file.

To add a feature: change `src/presence.js` (validation) or a view, add a case to
the matching `test/*.test.js`, run `npm test`. There is no build step.

---

## 3. Which free stack to pick

Everything below is genuinely $0. "Best" depends on what you want to trade.

| | **Render free web service** | **Oracle Cloud Always Free VM** | **Your own PC** |
| --- | --- | --- | --- |
| Time to first URL | ~10 min | ~45–60 min | ~15 min |
| Credit card | not required | required for identity check, never charged | none |
| Always on | sleeps after 15 min idle — the keep-alive ping prevents it | yes, permanently | only while the machine is on |
| Disk | ephemeral, **lost on restart / spin-down / redeploy** | 200 GB persistent | your disk |
| HTTPS | included | Caddy + Let's Encrypt (free) | Cloudflare quick tunnel (free) |
| Stable URL | yes, `*.onrender.com` | yes, DuckDNS subdomain or your domain | no with quick tunnels |
| Best for | trying it today | "set it once, forget it" | testing, a Raspberry Pi |

**Recommendation**

- Just want to see it working, no card: **Path A (Render)** → §5.
- Want free forever, with photos and settings that never vanish: **Path B
  (Oracle)** → §6.
- Already have an always-on box: **Path C** → §7.

Free pieces used by every path: the Discord application (free), Let's Encrypt
certificates (free), a GitHub account (free), a DuckDNS subdomain (free), and one
of the three hosts above.

Not recommended in 2026: Fly.io and Koyeb (no free tier for new accounts),
Railway (no free tier), Vercel (no persistent process, no writable disk, no SSE —
the bot would simply be offline).

---

## 4. Step 1: the Discord application

You are collecting **four values**. Three are required-ish, one is optional.

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
new value into the dashboard again (§16.3).

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
installed. It needs your public URL, so do it after §5–§7 — or do it now and fix
the URL afterwards.

1. **Activities → Settings** → tick **Enable Activities**. Discord registers the
   `Launch` entry-point command for you.
2. **Activities → URL Mappings** → add mapping with prefix **`/`** and target
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
2. In the dashboard: **Settings → Discord sign-in** → paste the client secret and your
   Discord **user ID** (Discord → Settings → Advanced → Developer Mode → right
   click your name → *Copy User ID*). Separate several IDs with commas.
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

## 5. Step 2: Path A, Render

> **The two values that matter.** The wizard asks for an Application ID and an
> OAuth2 client secret; that pair alone is enough to put photos, text and buttons
> on your own profile through the in-Discord app. A bot token only adds the text
> card that stays online while you are away.

**Deploy**

1. Fork or push this repository to your own GitHub account.
2. <https://dashboard.render.com> → **New +** → **Blueprint** → pick the repo.
   Render reads `render.yaml`: Node 22, `npm ci`, `npm start`, health check
   `/health`, plan `free`.
3. Render asks for the `sync: false` variables. You can fill them now, or leave
   every one blank and finish in the browser wizard — both are supported:

   | Variable | Value |
   | --- | --- |
   | `DASHBOARD_KEY` | your login password, 12+ characters |
   | `CLIENT_ID` | the Application ID from §4.2 |
   | `CLIENT_SECRET` | the client secret from §4.3 |
   | `DISCORD_TOKEN` | the bot token from §4.4 (optional) |
   | `PUBLIC_URL` | leave blank for now — set it after the first deploy |
   | `SETUP_TOKEN` | leave blank unless you want a fixed wizard token |

4. **Apply** → wait for **Live** → copy the URL (`https://something.onrender.com`).
5. **Environment** → set `PUBLIC_URL` to exactly that URL (no trailing slash) →
   save; Render redeploys automatically.

   > Setting `DASHBOARD_KEY` in the environment means the wizard is skipped and
   > the site is configured as-is. Without it, the first visit lands on `/setup`.

**Finish in the browser** — continue with §8 (wizard), §9 (card), §10 (profile).

**Render free-tier truths**

- 512 MB RAM, 0.1 CPU, 750 instance-hours per workspace per month. A 31-day month
  is 744 hours, so one always-awake service fits — do not add a second.
- **The disk is ephemeral.** Files are lost on restart, redeploy or spin-down.
  Environment variables survive, and the keep-alive prevents *idle* spin-downs,
  but a Render restart means re-entering the presence and re-uploading photos. If
  that bothers you, take Path B.
- Cold start after a real spin-down is about a minute, and the bot reconnects by
  itself.

---

## 6. Step 3: Path B, Oracle Always Free

New Oracle accounts get **2 OCPU / 12 GB RAM** of Ampere A1 (ARM) plus **200 GB**
of block storage and 10 TB/month egress, free forever. A card is required for
identity verification; Always Free resources are never charged.

1. Sign up at <https://www.oracle.com/cloud/free/>. Pick a home region close to
   you — it cannot be changed later.
2. **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04** (aarch64)
   - Shape: **Ampere → VM.Standard.A1.Flex**, 2 OCPU / 12 GB (1/6 is plenty if
     capacity is tight)
   - Add your SSH public key, create the instance, note the **public IPv4**.
3. **Networking → VCN → Security list** → add ingress rules for TCP **80** and
   **443** from `0.0.0.0/0`. Leave 22 open for SSH.
4. DNS: create a free subdomain at <https://www.duckdns.org> (for example
   `statusc0rd-yourname.duckdns.org`) and point it at the public IP.
5. SSH in and install Docker:

   ```sh
   sudo apt update && sudo apt install -y docker.io git
   sudo usermod -aG docker "$USER" && newgrp docker
   git clone https://github.com/YOUR-NAME/StatusC0rd.git && cd StatusC0rd
   ```

6. Build and run it with a persistent volume, bound to localhost only:

   ```sh
   docker build -t statusc0rd .
   docker run -d --name statusc0rd --restart unless-stopped \
     -p 127.0.0.1:3000:3000 \
     -e PUBLIC_URL=https://statusc0rd-yourname.duckdns.org \
     -v "$PWD/data:/app/data" \
     statusc0rd
   ```

7. Put HTTPS in front, with automatic Let's Encrypt certificates:

   ```sh
   sudo apt install -y caddy
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   statusc0rd-yourname.duckdns.org {
     reverse_proxy 127.0.0.1:3000
   }
   EOF
   sudo systemctl restart caddy
   ```

8. Open `https://statusc0rd-yourname.duckdns.org/setup` and finish the wizard. The
   setup token is printed in `docker logs statusc0rd` and stored in
   `data/setup-token.txt` — paste it when asked.
9. **Bot & 24/7** → the public URL is already correct; the keep-alive can stay on
   (harmless here, and it doubles as a liveness check).

**Updates and backups**

```sh
cd StatusC0rd && git pull
docker build -t statusc0rd . && docker restart statusc0rd
tar -czf statusc0rd-backup-$(date +%F).tgz data/     # backup
```

`data/` survives every rebuild. Restore by unpacking it back into place before
starting the container.

Oracle occasionally reclaims Always Free instances that look completely idle. A
running bot with a live gateway connection is enough activity in practice, and the
keep-alive ping adds more.

---

## 7. Step 4: Path C, your own PC or Pi

For testing, or if you already leave a machine on:

```sh
git clone https://github.com/YOUR-NAME/StatusC0rd.git && cd StatusC0rd
npm ci
npm start          # http://localhost:3000
```

Optional but recommended on macOS/Linux, to keep it running after logout:

```sh
nohup npm start > statusc0rd.log 2>&1 &     # or a systemd unit / pm2
```

To expose it over HTTPS without touching your router:

```sh
cloudflared tunnel --url http://localhost:3000
```

It prints a `https://something.trycloudflare.com` URL. Put exactly that in
**Bot & 24/7 → Public URL** and in the wizard — it is required for photo URLs and
for keep-alive. Quick-tunnel URLs change on every restart, so update it when you
restart. A named Cloudflare tunnel (needs a domain) or DuckDNS plus port
forwarding gives a stable URL; both depend on your ISP not using CGNAT.

The dashboard itself works at `http://localhost:3000` with no tunnel at all — only
the *photos* need a public HTTPS URL, because Discord's image proxy has to fetch
them from the internet.

---

## 8. Step 5: first boot and the wizard

Open your URL. A fresh instance redirects everything to **`/setup`**, a three-step
wizard. Nothing is written to disk until you press **Finish setup**, and nothing
needs a restart afterwards.

### 8.1 Unlocking setup (only when it is reachable from the internet)

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
generated on the next boot — see §16.1.

### 8.2 Step 1 — Account

- **Dashboard key** — 12 characters minimum. This is the only password that
  protects the operator side. Use **Generate a strong key** (it produces a long
  random key and reveals it once) or type your own; the field is `type=password`
  and the browser will offer to save it.
- **Repeat key** — must match.

The key is stored as a scrypt hash with a random salt. If you lose it you cannot
recover it; see §16.1.

### 8.3 Step 2 — Discord app

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

### 8.4 Step 3 — Presence

- **Activity name** (128 chars) — what Discord prints after "Playing".
- **Type** — Playing, Listening, Watching, Competing. (Streaming needs a Twitch or
  YouTube link and lives in the dashboard's full editor; Custom status is
  text-only.)
- **Status** — Online, Idle, Do not disturb, Invisible.
- **Details (line 1)** and **State (line 2)** — 128 chars each.
- **Large / small photo** — click the slot, pick a file, or drag one onto it.
  Photos are cropped to a square and downscaled in your browser before upload.
- **Keep this server awake** — the 24/7 keep-alive (§11). Leave it ticked.
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

## 9. Step 6: design and publish the card

Everything that reaches Discord is edited on one screen: the **Presence** tab.

### 9.1 Start from a template (optional)

Ten starting points: **Focus mode, Listening, Building, Watching, Gaming,
Studying, Reading, On a break, In the studio, Ranked**. Clicking one fills the
form; the photo you already picked and your target choices survive. Nothing is
published by clicking a template — you still press **Publish**.

### 9.2 The fields, with their real limits

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

### 9.3 Photos

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

### 9.4 Draft, publish, discard

- Every edit is staged and autosaved as a **draft** — on any device — and nothing
  reaches Discord until you press **Publish**.
- **Publish** validates, saves and applies: the bot card updates immediately and
  the in-Discord app picks the new card up within about 5 seconds.
- **Discard draft** throws the staged edits away and puts the live card back in
  the form.
- Closing the tab with a save in flight asks for confirmation; everything else is
  already saved.

### 9.5 Where it shows

Two checkboxes under **Show this presence on**:

- **The bot** — the text card, 24/7, on your server.
- **My own profile** — photos, buttons, timer, in the Discord app.

Pick one or both; at least one is required. Un-ticking *My own profile* is why an
Activity can legitimately show "no presence" while the dashboard looks fine — the
Activity names that reason explicitly.

### 9.6 The Photos tab

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
will refuse to load your images — fix `PUBLIC_URL` first (§17), then publish
again.

---

## 10. Step 7: on your own profile, no install

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

The bot card (§11) is the part that stays after you close the panel.

---

## 11. Step 8: the bot card, always online

The bot runs on the server, so its card is online as long as the server is. Two
things make that true on free hosts:

1. **A bot token** in the wizard or **Settings** (or `DISCORD_TOKEN`). Without
   one the dashboard still works — the **Bot & 24/7** tab just says *No bot*.
2. **The keep-alive.** Free web services sleep after a period without inbound
   traffic, which drops the gateway connection. StatusC0rd pings its own public
   `/health` on a timer to generate that traffic.

Configure it under **Bot & 24/7**:

| Field | Meaning |
| --- | --- |
| Public URL of this dashboard | the `https://` origin; without it the keep-alive cannot run |
| Keep the service awake | on/off |
| Ping every (minutes) | 5–60, default 10 — must be shorter than the host's idle timeout (Render: 15 min) |

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

## 12. Step 9: the share card (optional)

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

## 13. Step 10: the optional companion

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

## 14. Step 11: verify the whole install

Run through this once. It catches every typical mistake.

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
| 12 | Restart the host (Path A: redeploy) | with env values set, the dashboard comes back without the wizard; with an ephemeral disk, photos are gone — that is Render, not a bug |

If a check fails, §20 has the symptom-to-cause table.

---

## 15. Step 12: updates and backups

**Update** (any git-based host):

```sh
git pull
npm ci            # only when package-lock.json changed
# restart the process (Render does it for you; Docker: rebuild + restart)
```

Check the new version at `/api/health` (`version`) or in the welcome page footer.

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

**If the disk is ephemeral** (Render free): either move to Path B, or keep
`DASHBOARD_KEY`, `CLIENT_ID`, `CLIENT_SECRET`, `DISCORD_TOKEN` and `PUBLIC_URL` in
the environment so a wiped instance boots straight into a working dashboard (the
wizard is skipped) and only the photos and the presence text need re-entering.

---

## 16. Step 13: security and rotation

### 16.1 The dashboard key

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

### 16.2 The bot token

Reset it in the portal (**Bot → Reset Token**), then paste the new value in
**Settings → Application & bot → Bot token**. The bot reconnects immediately; no
restart. A wrong token is visible as *Bot offline* with the reason in the log.

### 16.3 The client secret

Reset it in the portal (**OAuth2 → General**), paste the new one in **Settings**.
Until you do, the in-Discord app answers `not_configured` and Discord sign-in
stops working.

### 16.4 Who can use the instance

- **Dashboard sign-in** — the key, plus (optionally) allowlisted Discord accounts.
- **The in-Discord app** — anyone who can launch the app *and* is on
  `ALLOWED_DISCORD_IDS`, if that list is set. With no list, a single-tenant
  install trusts anyone who can install the app; that is fine for your own app,
  not for a shared one.
- **Companion devices** — one hashed token per device, revocable individually.
- **The share card** — public by design, opt-in, rotatable, switchable off.
- **`/health`** — public and minimal; version, storage, bot and Activity state are
  behind the session at `/api/health`.

### 16.5 Deployment hygiene

- Serve over HTTPS. Photos need it anyway, and the session cookie is marked
  `Secure` when the request arrives over TLS.
- `SESSION_SECRET` should be 32+ characters (`openssl rand -hex 32`); a random one
  is generated and stored if you do not set it.
- If the app is exposed **directly** to the internet with no proxy in front, set
  `TRUST_PROXY=false`. Behind Render/Cloudflare/Caddy the default
  (`loopback, linklocal, uniquelocal`) is correct.
- Delete `data/users.json` if you ever see a warning about it at boot: it is the
  old v1 token store and is no longer used.

---

## 17. Environment variables

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

---

## 18. Where every secret lives

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

## 19. Limits worth knowing

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

## 20. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/setup` reappears after a restart | ephemeral disk (Render) and no `DASHBOARD_KEY` in the environment | set `DASHBOARD_KEY` (+ the other values) in the host's env, or move to Path B |
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
| "That dashboard key is not correct" | typo, or the key was rotated | try again; if truly lost see §16.1 |
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

---

## 21. All-in-one checklist

**One-time, operator**

1. Discord app created; **Application ID** and **Client Secret** copied (§4.2–4.3).
2. Bot token copied, *Public Bot* off, privileged intents all off (§4.4).
3. **Activities → Enable Activities**; URL mapping `/` → `https://YOUR-HOST/activity/` (§4.5).
4. App installed with `bot applications.commands` (§4.6).
5. Host deployed — Render (§5), Oracle (§6) or your own box (§7) — with HTTPS.
6. `PUBLIC_URL` set to the real public origin.
7. `/setup` finished, or `DASHBOARD_KEY` + `CLIENT_ID` + `CLIENT_SECRET` +
   `DISCORD_TOKEN` + `PUBLIC_URL` in the environment (§8).
8. Keep-alive on, interval under the host's idle timeout (§11).
9. §14 verification table green.

**Per user**

1. Sign in.
2. Design the card, add photos and up to two buttons.
3. **Publish**.
4. **Open in Discord** and leave the panel open while you want the card.
5. Optional: create the share link.

Total cost: **$0**. Total downloads: **none**.
