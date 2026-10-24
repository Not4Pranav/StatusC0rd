# StatusC0rd — how it works, and a 100% free setup

> **You are reading this inside StatusC0rd.** Every deployment serves this same
> guide at `/guide` (linked from the sign-in page and the dashboard), and the
> welcome page at `/welcome` explains the project to anyone who lands on it.
> The file you are looking at, `docs/free-setup.md`, is the single source for
> both: edit it once, and the website renders the update.

Two audiences, two short answers:

- **If you are the person using someone's StatusC0rd instance:** open the URL, sign
  in, design your card in the browser, click *Pair this computer* once. That's it.
- **If you are the person running it:** one Discord app, one free host, one URL.
  Everything else is configured from the dashboard — never from a file.

---

## 1. What the user gets

Discord shows two different things, and StatusC0rd fills both:

| | **Bot card** (always on) | **Your own profile** (rich) |
| --- | --- | --- |
| Shows | name, activity type, state/status text | photo (large + small), details, state, hover text, **buttons**, timer |
| Runs on | the server, 24/7 | the paired computer (Discord desktop app open) |
| Setup | bot token in the wizard | download a launcher, double-click |
| Editable from | dashboard | dashboard, no restart, no re-pair |

Why the split: Discord's bot gateway only accepts `name`, `type` and `state` for
presence. Images and buttons exist only on *user* presence, and user presence can
only be set through the Discord client sitting on the same machine as your
account (local RPC). That is why StatusC0rd has a tiny companion app: it is the
only compliant way to get a photo + buttons on your own profile.

### The user's five minutes

1. Open the site → sign in with the dashboard key (or Discord, if enabled).
2. **Presence** tab: name, type, status, details, state, optional timer; drop in
   a photo for large and small art; add up to two buttons (label + https URL).
   The preview on the right is exactly what Discord will show.
3. **Apply presence** → the bot card updates within a second. This stays online
   24/7 as long as the server is up.
4. **My profile** tab → *Pair this computer* → download `StatusC0rd-mac.zip`
   (macOS) / `StatusC0rd.bat` (Windows) / `statusc0rd.sh` (Linux) → double-click.
   A small window opens and stays open; the badge flips to **Profile live**.
5. Now the same card, with photos and buttons, is on their own profile. Edits in
   the dashboard arrive in ~5 seconds. Closing the window clears the presence
   (it does not leave a stale card behind).

Photos: PNG/JPEG/WebP/GIF, at least 16×16, 2 MB max, cropped to a square in the
browser, stored under `data/assets/`, served over HTTPS from `/assets/<id>.png`
with `Access-Control-Allow-Origin: *` so Discord's image proxy can fetch them.

---

## 2. What the developer gets

```
Browser ──HTTPS──▶ your host (this repo, Node 20+)
                     ├─▶ Discord gateway        → bot card, 24/7, auto-reconnect
                     ├─▶ /assets/<id>.<ext>     → the photos Discord downloads
                     ├─▶ /health                → health check + keep-alive target
                     └─▶ companion on your PC   → your profile: photos + buttons
```

- `index.js` boots the store, the bot, the keep-alive and the HTTP server.
- `app.js` is the whole HTTP surface: views, auth, presence CRUD, photo upload,
  pairings, launcher downloads, the generated companion script.
- `src/companion/agent.js` is one file that both the CLI and `handle.start()` use;
  it speaks Discord's IPC protocol directly (no extra dependencies).
- `data/` holds `settings.json` (mode `0600`), `assets/`, `setup-token.txt`.
  `DATA_DIR` moves it. That directory **is** the deployment's state.
- `npm test` = 91 tests, including `test/companion-e2e.test.js`, which drives a
  real dashboard (upload → pair) and runs the real companion against a fake
  Discord socket, asserting the exact `SET_ACTIVITY` frame.
- `npm run check` = syntax/parse check across every source file.

Add a feature like this: change `src/presence.js` (validation) or the view, add a
case to the matching `test/*.test.js`, run `npm test`. Nothing needs a build step.

Environment variables are optional — the wizard writes the same values into
`settings.json`, and env wins when both exist. The full list is in
`.env.example` and in the README.

---

## 3. Which free stack to pick

Everything below is genuinely $0. "Best" depends on what you want to trade.

| | **Render free web service** | **Oracle Cloud Always Free VM** | **Your own PC** |
| --- | --- | --- | --- |
| Time to first URL | ~10 min | ~45–60 min | ~15 min |
| Credit card | not required | required for identity check, no charges | none |
| Always on | sleeps after 15 min idle → keep-alive ping prevents it | yes, permanently | only while the machine is on |
| Disk | ephemeral, **lost on restart/spin-down/redeploy** | 200 GB persistent | your disk |
| HTTPS | included | Caddy + Let's Encrypt (free) | Cloudflare quick tunnel |
| Stable URL | yes (`*.onrender.com`) | yes (DuckDNS subdomain or your domain) | no with quick tunnels |
| Best for | trying it today | "set it once, forget it" | testing / a Raspberry Pi |

**Recommendation**

- Just want to see it working, no card: **Path A (Render)**.
- Want free forever, photos and settings that never vanish: **Path B (Oracle)**.
- Already have an always-on box: **Path C**.

Not recommended in 2026: Fly.io and Koyeb (no free tier for new accounts),
Railway (no free tier), Vercel (cannot hold a Discord gateway connection, no
writable disk, no SSE — the bot would be offline).

Free pieces used by every path: Discord application (free), Let's Encrypt
certificates (free), GitHub repo (free), DuckDNS subdomain (free).

---

## 4. Step 0 — the Discord application (all paths, ~5 minutes)

1. <https://discord.com/developers/applications> → **New Application** → name it
   (this is also the default activity name) → accept the terms.
2. Left sidebar **Bot** → **Reset Token** → copy it. It is shown once; this is
   `DISCORD_TOKEN`. Keep it secret. Turn **Public Bot** off if you don't want
   strangers inviting it.
3. Left sidebar **OAuth2** (or *General Information*) → copy **Application ID**.
   This is `CLIENT_ID`. It is *not* secret.
4. Invite the bot to a server you own (only needed if you want the bot visible in
   a member list; presence works without it):

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot&permissions=0
   ```

   The dashboard's **Bot & 24/7** tab has this link ready to copy.
5. Optional — sign in to the dashboard *with Discord* instead of a key:
   **OAuth2 → Redirects** → add `https://YOUR-URL/auth/discord/callback`, then copy
   the **Client Secret**. You'll paste the secret + your Discord user ID into the
   dashboard's **Settings** tab. Anyone not on that allowlist can't sign in.

No privileged intents are needed. Leave them all off.

---

## 5. Path A — Render (fastest, no credit card)

**Deploy**

1. Fork/push this repo to your own GitHub account.
2. <https://dashboard.render.com> → **New +** → **Blueprint** → pick the repo.
   Render reads `render.yaml` (Node 22, `npm ci`, `npm start`, health check `/health`).
3. It asks for the `sync: false` variables. Fill them now if you want a
   restart-proof deployment:

   | Variable | Value |
   | --- | --- |
   | `DASHBOARD_KEY` | your login password, 12+ characters |
   | `CLIENT_ID` | the Application ID from step 0 |
   | `DISCORD_TOKEN` | the bot token from step 0 |
   | `PUBLIC_URL` | leave blank for now, set it after the first deploy |
   | `SETUP_TOKEN` | leave blank (only needed for the browser wizard) |

   You can also skip all of them and use the browser wizard instead — that is the
   "no terminal" experience StatusC0rd is built around.
4. **Apply** → wait for **Live** → copy the URL (`https://something.onrender.com`).
5. **Environment** → set `PUBLIC_URL` to that URL → save (it redeploys).

   > If you set `DASHBOARD_KEY` in the environment, the wizard is skipped and the
   > site is configured exactly as it is; without it you get `/setup` on first load.

**Finish in the browser**

6. Open the URL → log in with your dashboard key (or run the wizard if you left
   the env blank: key → bot token → first presence with a photo).
7. **Bot & 24/7** → confirm the public URL and *Keep the service awake* (every
   10 minutes; the minimum is 5). This is what stops the 15-minute spin-down that
   would disconnect the gateway.
8. **Presence** tab → design, **Apply presence**. **My profile** → pair your PC.

**Render free-tier truths**

- 512 MB RAM / 0.1 CPU, 750 instance-hours per workspace per month (a 31-day
  month has 744 — one always-awake service fits, don't add a second).
- **The disk is ephemeral.** Files are lost on restart, redeploy or spin-down.
  Env variables survive, and the keep-alive prevents spin-downs — but a Render
  restart means re-entering the presence and re-uploading photos. That is the one
  reason to prefer Path B if you care about permanence.
- Cold start after a real spin-down is ~1 minute.

---

## 6. Path B — Oracle Cloud Always Free (permanent, $0)

New Oracle accounts get **2 OCPU / 12 GB RAM** of Ampere A1 (ARM) plus **200 GB**
of block storage and 10 TB/month egress, free forever. A card is required for
identity verification; Always Free resources are not charged.

1. Sign up at <https://www.oracle.com/cloud/free/> (choose a home region close to
   you; it can't be changed later).
2. **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04** (aarch64)
   - Shape: **Ampere → VM.Standard.A1.Flex**, 2 OCPU / 12 GB (or 1/6 if capacity
     is tight; the app needs far less)
   - Add your SSH public key, create, note the **public IPv4**.
3. **Networking → VCN → Security list** → add ingress rules for TCP 80 and 443
   from `0.0.0.0/0` (leave 22 open).
4. DNS: create a free subdomain at <https://www.duckdns.org> (e.g.
   `statusc0rd-yourname.duckdns.org`) and point it at the public IP.
5. SSH in and install Docker:

   ```sh
   sudo apt update && sudo apt install -y docker.io git
   sudo usermod -aG docker "$USER" && newgrp docker
   git clone https://github.com/YOUR-NAME/StatusC0rd.git && cd StatusC0rd
   ```

6. Run it with a persistent volume, bound to localhost only:

   ```sh
   docker build -t statusc0rd .
   docker run -d --name statusc0rd --restart unless-stopped \
     -p 127.0.0.1:3000:3000 \
     -e PUBLIC_URL=https://statusc0rd-yourname.duckdns.org \
     -v "$PWD/data:/app/data" \
     statusc0rd
   ```

7. HTTPS in front, with automatic Let's Encrypt certs:

   ```sh
   sudo apt install -y caddy
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   statusc0rd-yourname.duckdns.org {
     reverse_proxy 127.0.0.1:3000
   }
   EOF
   sudo systemctl restart caddy
   ```

8. Open `https://statusc0rd-yourname.duckdns.org/setup` and finish the wizard.
   The setup token is printed in the container log
   (`docker logs statusc0rd`) and stored in `data/setup-token.txt` — paste it.
9. **Bot & 24/7** → the public URL is already correct; keep-alive can stay on
   (harmless here, and it doubles as a liveness check).

Maintenance is one command: `docker compose`-less updates are
`git pull && docker build -t statusc0rd . && docker restart statusc0rd`.
Your `data/` folder survives all of it — back it up by copying it.

Oracle sometimes reclaims Always Free instances that look completely idle; a
running bot with a live gateway connection is enough activity in practice, and
the keep-alive ping adds more.

---

## 7. Path C — your own PC or Raspberry Pi

For testing, or if you already leave a machine on:

```sh
git clone https://github.com/YOUR-NAME/StatusC0rd.git && cd StatusC0rd
npm ci
npm start          # http://localhost:3000
```

To expose it over HTTPS without touching your router:

```sh
cloudflared tunnel --url http://localhost:3000
```

It prints a `https://something.trycloudflare.com` URL. Put that in **Bot & 24/7 →
Public URL** (it is required for photo URLs and keep-alive), and pair your PC.
The URL changes each time you restart the tunnel, so update it then. A named
Cloudflare tunnel (needs your own domain) or DuckDNS + port forwarding gives a
stable URL; those depend on your ISP not using CGNAT.

Because this box is on the same machine as Discord, everything works — and the
dashboard is reachable at `http://localhost:3000` even with no tunnel at all
(only the photos need a public HTTPS URL for Discord to fetch them).

---

## 8. Where every secret and every byte lives

| Thing | Where | Survives a restart? |
| --- | --- | --- |
| Dashboard key | `DASHBOARD_KEY` env, or scrypt hash in `data/settings.json` | env: yes |
| Bot token | `DISCORD_TOKEN` env, or `data/settings.json` (`0600`) | env: yes |
| Session signing key | `SESSION_SECRET` env, else generated into `settings.json` | env: yes |
| Presence config | `data/settings.json` | only with a real disk |
| Photos | `data/assets/<hash>.<ext>` | only with a real disk |
| Pairing tokens | hashed inside `settings.json`, one per device | only with a real disk |
| Setup token | `data/setup-token.txt` (or `SETUP_TOKEN` env) | deleted when setup finishes |
| `PUBLIC_URL`, `CLIENT_ID` | env or dashboard **Bot & 24/7 / Settings** | env: yes |

Rotate anything by changing it in the dashboard (**Settings** tab for app/bot/SSO,
**My profile** → *Remove* for a device, **Settings → Change dashboard key**) or by
editing the env var and redeploying.

---

## 9. Limits worth knowing before you promise anything

- **Photos and buttons cannot go on a bot card.** Discord's bot presence accepts
  only name/type/state. They belong to the paired profile, which needs the Discord
  desktop client running on that computer.
- **RPC is local-only.** No server, paid or free, can push rich presence to your
  account without something running on your machine. That's why the companion
  exists and why pairing is the last step.
- **Stream and Custom activity types** are downgraded to *Playing* by the
  companion, because RPC doesn't accept them the same way.
- **Free hosts sleep.** Render spins down after 15 minutes of no traffic; the
  keep-alive ping (min 5 minutes) is what keeps the bot connected.

---

## 10. Troubleshooting, in order of likelihood

| Symptom | Cause | Fix |
| --- | --- | --- |
| Dashboard says *Bot offline* | wrong token, or token reset while running | Settings → paste the new token → Save |
| Photos show as a letter/silhouette on the profile | `PUBLIC_URL` is wrong or not HTTPS, so Discord can't fetch `/assets/…` | set the real public URL, re-apply presence |
| *Profile live* never turns green | companion not running, or Discord desktop not open | start the launcher, keep the window open |
| macOS: "cannot be opened because the developer cannot be verified" | downloaded `.command` quarantine | right-click → Open, once |
| Double-click does nothing on macOS | old plain `.command` download with no execute bit | download `StatusC0rd-mac.zip` instead |
| Bot card goes offline every ~15 min | free host spinning down; keep-alive off or URL wrong | **Bot & 24/7** → set URL, enable keep-alive |
| `/setup` reappears after a restart | ephemeral disk (Render) or env key removed | set `DASHBOARD_KEY` in env, or move to Path B |
| "Too many requests" on sign-in | rate limit / lockout after failed keys | wait 15 minutes, or restart the service |

---

### The short version

1. Create the Discord app, copy **Application ID** + **bot token** (5 min).
2. Pick a host: Render (10 min, ephemeral disk) or Oracle Always Free (permanent).
3. Open `/setup` (or set `DASHBOARD_KEY` + `CLIENT_ID` + `DISCORD_TOKEN` +
   `PUBLIC_URL` in the env to skip it), design the card, upload a photo.
4. **My profile → Pair this computer** → double-click the launcher.
5. Leave the keep-alive on. Total cost: $0.
