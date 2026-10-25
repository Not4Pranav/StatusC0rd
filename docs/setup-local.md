# Run it on your own computer

> **This is the local path: a PC, a Mac or a Raspberry Pi.** It takes you from an
> empty folder to a card on your profile and a bot that is online while the
> machine is on. The parts that are the same on every host — the Discord
> application, the wizard, the dashboard, the profile, the bot card — are in
> [the setup guide](setup.md); every link you need is below.
>
> Renting a server instead? [Cloud server](setup-cloud.md). Want free hosting that
> stays up on its own? [Free cloud](setup-free-cloud.md).

**Start to finish, in order**

| # | Step | Where |
| --- | --- | --- |
| 1 | Install Node 20+ and git | §1 |
| 2 | Get the code and its dependencies | §2 |
| 3 | Start it and finish the wizard | §3 |
| 4 | Give it a public HTTPS URL (tunnels) | §4 |
| 5 | Create the Discord application | §5 |
| 6 | Point Discord at your URL, drop a card | §6 |
| 7 | Keep it running after logout and reboot | §7 |
| 8 | Update and back up | §8 |
| 9 | When something breaks | §9 |

Everything here is free except your electricity. Nothing needs a credit card.

---

## 1. What you need

- **Node.js 20 or newer** (22 LTS recommended) and **git**. Check:
  `node -v` and `git --version`.
- **A machine that is on when you want the card.** A desktop, a spare laptop, a
  Mac mini or a Raspberry Pi 4/5. A laptop that sleeps whenever you close the lid
  will drop the bot — see §7.4.
- **No public IP, no router access, no domain** — a Cloudflare quick tunnel
  (§4.1) is enough to start.
- Optional, for a stable URL: a free Cloudflare account and a domain you own, or
  a free DuckDNS subdomain.

Install Node:

```sh
# macOS (Homebrew)
brew install node git

# Debian / Ubuntu / Raspberry Pi OS
sudo apt update && sudo apt install -y nodejs npm git

# Windows: install from https://nodejs.org (LTS) and use "Git Bash" for the commands
```

> Raspberry Pi: use the 64-bit OS. `node -v` must print `v20` or higher — the
> version in the Pi's default repositories is often too old, so use
> <https://github.com/nodesource/distributions> if needed.

---

## 2. Get the code

```sh
git clone https://github.com/Not4Pranav/StatusC0rd.git
cd StatusC0rd
npm ci
```

`npm ci` installs the exact dependency versions from `package-lock.json`. It takes
a minute; nothing is compiled and there is no build step.

No git? Download the ZIP from the repository page, unzip it, `cd` into the folder
and run `npm ci`.

---

## 3. Start it and finish the wizard

```sh
npm start
```

It prints a banner with the URL, the version and — on a first run — the setup
link:

```
  StatusC0rd v2.3.0  ·  http://localhost:3000  ·  development
  FIRST RUN - open the setup wizard to finish configuring:
    http://localhost:3000/setup
```

1. Open <http://localhost:3000/setup>. On localhost **no setup token is asked
   for** — the app trusts loopback connections.
2. Choose a dashboard key (12+ characters), then fill in the Discord values you
   will collect in §5. You can skip them and add them later under **Settings**.
3. Press **Finish setup**. You land on **My profile**, signed in — the whole
   dashboard is mapped in [the dashboard, tab by tab](setup.md#7-the-dashboard-tab-by-tab).

Leave the terminal running. Closing it stops the server — §7 fixes that.

> Prefer an env file? Copy `.env.example` to `.env`, set the values you want, and
> `npm start` picks it up. If you set `DASHBOARD_KEY`, the wizard is skipped
> entirely — the instance counts as configured.

---

## 4. A public HTTPS URL

This is the part people get wrong. Discord's image proxy fetches your photos from
the internet, so **photos need a public `https://` URL**. The dashboard, the bot and the text card work fine on
`http://localhost:3000`, but a photo there shows as a letter.

Three options, best first.

### 4.1 Cloudflare quick tunnel (fastest, free, no account)

```sh
# macOS
brew install cloudflared
# Debian / Ubuntu / Pi - pick the arch your machine is: amd64 for a PC,
# arm64 for a 64-bit Pi. `uname -m` tells you.
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
# Windows
winget install --id Cloudflare.cloudflared
```

```sh
cloudflared tunnel --url http://localhost:3000
```

It prints something like `https://dusky-otter-cv3.trycloudflare.com`. That is your
public URL.

- **The hostname changes every time the tunnel restarts.** When it does, update
  `PUBLIC_URL` in **Bot & 24/7** and re-publish, or your photos break again.
- Keep the tunnel command running in its own terminal (or install it as a
  service, §7.3).

### 4.2 Named tunnel (stable URL, needs a domain on Cloudflare)

```sh
cloudflared tunnel login
cloudflared tunnel create statusc0rd
cloudflared tunnel route dns statusc0rd rpc.example.com
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<'EOF'
tunnel: statusc0rd
credentials-file: /home/YOU/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: rpc.example.com
    service: http://localhost:3000
  - service: http_status:404
EOF
cloudflared tunnel run statusc0rd
```

Now `https://rpc.example.com` is permanent, and `PUBLIC_URL` never has to change
again.

### 4.3 DuckDNS plus port forwarding (stable, no Cloudflare)

1. Create `statusc0rd-yourname.duckdns.org` at <https://www.duckdns.org> and point
   it at your public IP.
2. Forward TCP **80** and **443** on your router to this machine.
3. Put a TLS proxy in front — Caddy is one line:

   ```sh
   sudo apt install -y caddy
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   statusc0rd-yourname.duckdns.org {
     reverse_proxy 127.0.0.1:3000
   }
   EOF
   sudo systemctl restart caddy
   ```

This fails behind CGNAT (many mobile and shared connections), in which case use
§4.1 or §4.2.

> Whichever you pick, the URL must be **exactly** what you paste into
> **Bot & 24/7 → Public URL**, with no trailing slash. Check it with
> `curl -I https://YOUR-URL/health` — it must answer `200`.

---

## 5. Create the Discord application

Four values, five minutes. The full walkthrough with screenshots-in-words is
[the Discord application](setup.md#4-step-1-the-discord-application) in the guide;
the short version:

1. <https://discord.com/developers/applications> → **New Application**.
2. **General Information** → copy the **Application ID**.
3. **OAuth2 → General** → **Reset Secret** → copy the **Client Secret**.
4. **Bot → Reset Token** → copy the **Bot token** (optional, for the 24/7 card).

Then enable the in-Discord app — this is what puts photos and buttons on your
profile with nothing installed:

5. **Activities → Settings** → tick **Enable Activities**.
6. **Activities → URL Mappings** → prefix **`/`** → target
   **`https://YOUR-URL/activity/`** (your tunnel or DuckDNS URL from §4, trailing
   slash kept).
7. Open the invite URL and add the app to a server of yours:

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=0
   ```

---

## 6. Point StatusC0rd at that URL and go live

1. Dashboard → **Settings → Application & bot** → paste the Application ID and
   the Client Secret (and the bot token if you copied one) → **Save**.
2. **Bot & 24/7** → **Public URL** → paste `https://YOUR-URL` → **Save**. The
   keep-alive can stay ticked; it pings that URL so the presence stays warm.
3. **Presence** tab → name, type, details, state, a photo, up to two buttons →
   **Publish**.
4. **My profile** → **Open in Discord** → accept the prompt.

That is the whole loop. Editing and publishing again updates the card within
seconds, with no restart and no rejoin. Details for every field are in
[design and publish](setup.md#8-step-4-design-and-publish-the-card) and
[on your own profile](setup.md#9-step-5-on-your-own-profile-no-install).

---

## 7. Keep it running after logout and reboot

`npm start` in a terminal dies with the terminal. Pick one.

### 7.1 pm2 (any OS, easiest)

```sh
sudo npm i -g pm2
pm2 start index.js --name statusc0rd
pm2 save
pm2 startup            # prints one sudo command; run it
```

`pm2 logs statusc0rd` shows the output, `pm2 restart statusc0rd` restarts it, and
it comes back after a reboot. On Windows, run the same commands in PowerShell as
administrator.

### 7.2 systemd (Linux, including a Pi)

```sh
sudo useradd -r -m -d /opt/statusc0rd statusc0rd
sudo git clone https://github.com/Not4Pranav/StatusC0rd.git /opt/statusc0rd
sudo chown -R statusc0rd:statusc0rd /opt/statusc0rd
sudo -u statusc0rd npm --prefix /opt/statusc0rd ci

sudo tee /etc/statusc0rd.env >/dev/null <<'EOF'
NODE_ENV=production
PUBLIC_URL=https://YOUR-URL
EOF

sudo tee /etc/systemd/system/statusc0rd.service >/dev/null <<'EOF'
[Unit]
Description=StatusC0rd
After=network-online.target

[Service]
Type=simple
User=statusc0rd
WorkingDirectory=/opt/statusc0rd
EnvironmentFile=/etc/statusc0rd.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now statusc0rd
journalctl -u statusc0rd -f
```

The setup token, if the instance is ever unconfigured again, appears in
`journalctl -u statusc0rd` and in `/opt/statusc0rd/data/setup-token.txt`.

### 7.3 launchd (macOS)

```sh
sudo tee /Library/LaunchDaemons/dev.statusc0rd.plist >/dev/null <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.statusc0rd</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/node</string><string>index.js</string></array>
  <key>WorkingDirectory</key><string>/Users/YOU/StatusC0rd</string>
  <key>EnvironmentVariables</key>
  <dict><key>NODE_ENV</key><string>production</string>
        <key>PUBLIC_URL</key><string>https://YOUR-URL</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/statusc0rd.log</string>
  <key>StandardErrorPath</key><string>/tmp/statusc0rd.err</string>
</dict></plist>
EOF
sudo launchctl load -w /Library/LaunchDaemons/dev.statusc0rd.plist
```

`which node` must match the path in `ProgramArguments`. For a tunnel as a service
too, `brew services start cloudflared` after putting `~/.cloudflared/config.yml`
in place (§4.2).

### 7.4 Take the machine's sleep seriously

A sleeping machine is an offline bot, and no keep-alive can fix that.

- **macOS**: System Settings → Battery → *Prevent automatic sleeping when the
  display is off*; on a laptop also run `caffeinate -s` (or keep it plugged in).
- **Windows**: Settings → Power → *Never* sleep when plugged in; on a laptop set
  *Lid close* to *Do nothing*.
- **Linux**: `sudo systemctl mask sleep.target suspend.target hibernate.target`.
- A **Raspberry Pi** has no lid and sips power — it is the best home host.

---

## 8. Update and back up

```sh
cd StatusC0rd
git pull
npm ci                       # only when package-lock.json changed
# pm2: pm2 restart statusc0rd   ·   systemd: sudo systemctl restart statusc0rd
```

Back up — `data/` is the entire state:

```sh
tar -czf ~/statusc0rd-backup-$(date +%F).tgz data/
```

Restore by unpacking it back into the project folder before starting the app, or
copy it to a new machine and set the same `PUBLIC_URL`.

Moving to a proper server later? The `data/` folder is portable: see
[cloud server](setup-cloud.md) §5.

---

## 9. When something breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| `EADDRINUSE` on start | something else owns port 3000 | `PORT=3100 npm start`, or stop the other process |
| Photos show as a letter | no tunnel, or `PUBLIC_URL` is `http://` / `localhost` | finish §4, paste the HTTPS URL in **Bot & 24/7** |
| Photos broke after a reboot | the quick tunnel gave you a new hostname | update `PUBLIC_URL`, re-publish; or move to §4.2 |
| The card disappears when the lid closes | the machine slept | §7.4 |
| Browser opens `http://localhost:3000` but Discord cannot reach it | that URL only exists on your machine | use the public URL everywhere in Discord |
| `cloudflared: command not found` | not installed, or not on `PATH` | reinstall per §4.1 |
| `Cannot find module` after `git pull` | dependencies changed | `npm ci` |
| `node -v` prints v18 or lower | too old | install Node 20+ (§1) |
| Pi gets killed by the OOM killer | 1 GB board with a big upload | `npm ci --omit=dev`, close other services, or use a Pi 4/5 with 2 GB+ |
| Tunnel works, Activity opens blank | URL mapping missing | re-check §5 step 6 — prefix `/`, trailing slash on the target |
| `[config] …` warnings at boot | malformed env file | fix the value; the server keeps running |

Everything that is not host-specific — Discord errors, wizard locks, key
recovery, buttons, the Activity — is in the
[troubleshooting section](setup.md#19-troubleshooting) of the guide, and any
status code you hit is explained in its
[appendix](setup.md#21-appendix-every-url-and-every-response).

---

## 10. Checklist

- [ ] Node 20+ and git installed (§1)
- [ ] `npm ci` finished with no errors (§2)
- [ ] `/setup` completed, dashboard reachable at `http://localhost:3000` (§3)
- [ ] Public HTTPS URL that answers `200` on `/health` (§4)
- [ ] Application ID, Client Secret and (optional) bot token copied (§5)
- [ ] **Enable Activities** ticked, URL mapping `/` → `https://YOUR-URL/activity/` (§5)
- [ ] `PUBLIC_URL` set in **Bot & 24/7** (§6)
- [ ] Card published; **Open in Discord** shows the pill **On your profile** (§6)
- [ ] Process survives logout and reboot (§7)
- [ ] Sleep disabled, or the machine is a Pi (§7.4)
- [ ] Backup taken at least once (§8)
