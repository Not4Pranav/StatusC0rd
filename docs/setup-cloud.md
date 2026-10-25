# Run it on a cloud server

> **This is the paid cloud path: a VPS you rent, or a managed platform.** It takes
> you from an empty provider account to an instance with your own domain, HTTPS
> and a 24/7 bot. The parts that are identical on every host — the Discord
> application, the wizard, the dashboard, the profile, the bot card — live in
> [the setup guide](setup.md); every link you need is below.
>
> Want free instead? [Free cloud](setup-free-cloud.md) — Render, Oracle, GCP.
> Running it on a machine you already own? [Your own computer](setup-local.md).

**Start to finish, in order**

| # | Step | Where |
| --- | --- | --- |
| 1 | Choose a provider and a size | §1 |
| 2 | Create the server and log in | §2 |
| 3 | Point a hostname at it | §3 |
| 4 | Harden it (user, firewall, no password SSH) | §4 |
| 5 | Install the app and run it as a service | §5 |
| 6 | Put HTTPS in front with Caddy | §6 |
| 7 | Finish the wizard | §7 |
| 8 | Enable the in-Discord app and publish | §8 |
| 9 | Watch it, update it, back it up | §9–§10 |
| 10 | Prefer Docker, or a managed platform? | §11–§12 |

Budget **$4–7 per month**, or **$0** on the free paths. One small server holds
this comfortably: StatusC0rd idles at roughly 60–90 MB of RAM.

---

## 1. What you need

- A **small Linux VPS**: 1 vCPU and 1 GB of RAM is enough for one instance and a
  handful of users; 2 GB is comfortable. Ubuntu 24.04 LTS is the assumed OS.
- A **domain** (or a free DuckDNS subdomain) for HTTPS.
- **SSH access** — every provider gives you a key pair or a root password.

| Provider | Cheapest usable plan | Notes |
| --- | --- | --- |
| **Hetzner** | CX22 / CAX11, ≈ €3.80/month | Best price/performance; EU and US regions |
| **DigitalOcean** | Basic Droplet, $6/month | Simple UI, good docs |
| **Linode / Akamai** | Nanode 1 GB, $5/month | Long-running, predictable |
| **Vultr** | 1 GB Cloud Compute, ≈ $6/month | Many regions |
| **Scaleway / OVH / AWS Lightsail** | similar entry plans | Fine too |

Also covered here: managed platforms (§12) if you would rather not touch a
server at all.

---

## 2. Create the server

The clicks differ per provider; the result must be:

1. **Image**: Ubuntu 24.04 LTS (x86_64 — the `Dockerfile` works on ARM too, but
   stick to x86 unless you know why).
2. **SSH key** uploaded, not a root password.
3. **Public IPv4** noted.
4. **Firewall**: allow **22** (SSH), **80** and **443** (HTTP/HTTPS). Nothing
   else — port 3000 stays internal.
5. **Backups**: optional, ~20% extra. `data/` is small; §10 covers cheaper
   backups.

```sh
ssh root@YOUR_SERVER_IP
```

If the provider only gave you a password, you will be asked to change it on first
login.

---

## 3. Point a hostname at it

Create a DNS record at your registrar:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| `A` | `rpc` (or `@` for the root domain) | `YOUR_SERVER_IP` | 300 |

That gives you `https://rpc.example.com`. Check it resolves before continuing:

```sh
dig +short rpc.example.com        # must print the server IP
```

No domain? Create a free `statusc0rd-yourname.duckdns.org` at
<https://www.duckdns.org>, point it at the IP, and use that hostname everywhere
below. Let's Encrypt issues certificates for DuckDNS hostnames.

> HTTPS needs DNS to be live first. If Caddy fails with a certificate error, wait
> a few minutes and `sudo systemctl restart caddy`.

---

## 4. Harden it

Five minutes now saves a lot later.

```sh
# a non-root user with a key
adduser --disabled-password --gecos "" statusc0rd
usermod -aG sudo statusc0rd
rsync --archive --chown=statusc0rd:statusc0rd ~/.ssh /home/statusc0rd

# key-only SSH, no root login
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

# firewall: 22, 80, 443 only
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable
```

Open a **second** terminal and confirm `ssh statusc0rd@YOUR_SERVER_IP` works
before closing the first one.

---

## 5. Install the app and run it as a service

```sh
sudo apt update
sudo apt install -y nodejs npm git
node -v        # must be v20 or newer; if not, use https://github.com/nodesource/distributions

sudo git clone https://github.com/Not4Pranav/StatusC0rd.git /opt/statusc0rd
cd /opt/statusc0rd
sudo npm ci
sudo chown -R statusc0rd:statusc0rd /opt/statusc0rd
```

Configuration lives in one env file, so a redeploy never loses it:

```sh
sudo tee /etc/statusc0rd.env >/dev/null <<'EOF'
NODE_ENV=production
PUBLIC_URL=https://rpc.example.com
# Optional - set these and the wizard is skipped entirely:
# DASHBOARD_KEY=a-long-dashboard-key
# CLIENT_ID=123456789012345678
# CLIENT_SECRET=...
# DISCORD_TOKEN=...
EOF
sudo chmod 600 /etc/statusc0rd.env
```

The systemd unit restarts it on crash and on boot:

```sh
sudo tee /etc/systemd/system/statusc0rd.service >/dev/null <<'EOF'
[Unit]
Description=StatusC0rd
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=statusc0rd
WorkingDirectory=/opt/statusc0rd
EnvironmentFile=/etc/statusc0rd.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now statusc0rd
systemctl status statusc0rd --no-pager
curl -s localhost:3000/health          # {"status":"ok",...}
```

Logs: `journalctl -u statusc0rd -f`.

---

## 6. Put HTTPS in front with Caddy

Caddy fetches and renews a Let's Encrypt certificate on its own.

```sh
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
rpc.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl restart caddy
```

Check it end to end:

```sh
curl -I https://rpc.example.com/health     # 200, and a valid certificate
```

If port 3000 is only used by Caddy, keep it bound to loopback — the app already
defaults to `0.0.0.0:3000`, so make sure the firewall (§4) blocks it from the
outside. `TRUST_PROXY` can stay at its default because Caddy is on the same host;
set `TRUST_PROXY=false` only if you expose Node directly with no proxy.

---

## 7. Finish the wizard

1. Open `https://rpc.example.com`. A fresh instance redirects to **`/setup`**.
2. Because the request arrives from the internet, it asks for the **setup token**:

   ```sh
   journalctl -u statusc0rd | grep -i "setup token"
   sudo cat /opt/statusc0rd/data/setup-token.txt
   ```

   Either value works. Or set `SETUP_TOKEN` in `/etc/statusc0rd.env` and restart,
   and use your own.
3. Choose a dashboard key, paste the Application ID and Client Secret (§8), and
   optionally the bot token.
4. Press **Finish setup**.

If you filled `DASHBOARD_KEY`, `CLIENT_ID` and `CLIENT_SECRET` in the env file
already, the wizard never appears and `https://rpc.example.com/` asks for the key
directly.

The token is deleted when setup completes; if you ever lose the dashboard key,
[the recovery steps](setup.md#14-1-the-dashboard-key) bring the wizard back.

---

## 8. Enable the in-Discord app and publish

The Discord side is the same on every host, and it is the only part that makes
photos and buttons possible:

1. <https://discord.com/developers/applications> → your app →
   **Activities → Settings** → tick **Enable Activities**.
2. **Activities → URL Mappings** → prefix **`/`** → target
   **`https://rpc.example.com/activity/`** (trailing slash).
3. **Bot & 24/7 → Public URL** → `https://rpc.example.com` → **Save** (the
   keep-alive is optional here; the machine never sleeps).
4. **Presence** → design the card → **Publish**.
5. **My profile** → **Open in Discord**.

Full detail: [the Discord application](setup.md#4-step-1-the-discord-application),
[design and publish](setup.md#7-step-4-design-and-publish-the-card),
[on your own profile](setup.md#8-step-5-on-your-own-profile-no-install).

---

## 9. Watch it

- `systemctl status statusc0rd` — running since, restart count.
- `journalctl -u statusc0rd -n 100` — the app's own log.
- `curl -s https://rpc.example.com/health` — cheap, unauthenticated liveness.
  Point an uptime monitor (UptimeRobot, BetterStack, Healthchecks.io — all free)
  at it if you want an email when it stops.
- **Bot & 24/7** in the dashboard shows the gateway state and the last presence
  update.

Log rotation is handled by journald; cap it if the disk is small:

```sh
sudo sed -i 's/^#\?SystemMaxUse=.*/SystemMaxUse=200M/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald
```

---

## 10. Update and back up

```sh
sudo -u statusc0rd git -C /opt/statusc0rd pull
sudo -u statusc0rd npm --prefix /opt/statusc0rd ci     # only if package-lock.json changed
sudo systemctl restart statusc0rd
```

Nightly backup of the only stateful directory, kept for 14 days:

```sh
sudo tee /usr/local/bin/statusc0rd-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
mkdir -p /var/backups/statusc0rd
tar -czf "/var/backups/statusc0rd/data-$(date +%F).tgz" -C /opt/statusc0rd data
find /var/backups/statusc0rd -name 'data-*.tgz' -mtime +14 -delete
EOF
sudo chmod +x /usr/local/bin/statusc0rd-backup
echo '17 3 * * * root /usr/local/bin/statusc0rd-backup' | sudo tee /etc/cron.d/statusc0rd-backup
```

Restore: stop the service, unpack the archive over `/opt/statusc0rd/data`, start
it again. The dashboard key, presence, photos, share slug and paired devices all
return.

To move to another server: back up `data/`, copy it to the new machine's
`/opt/statusc0rd/data`, keep `PUBLIC_URL` identical, start the service, repoint
DNS.

---

## 11. Prefer Docker?

Everything above, but the app runs in a container. Caddy still lives on the host
(§6).

```sh
sudo apt install -y docker.io docker-compose-v2 git
sudo git clone https://github.com/Not4Pranav/StatusC0rd.git /opt/statusc0rd
cd /opt/statusc0rd
```

`docker-compose.yml`:

```yaml
services:
  statusc0rd:
    build: .
    image: statusc0rd:local
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - ./data:/app/data
```

```sh
cp /etc/statusc0rd.env .env            # or write a fresh .env
sudo docker compose up -d --build
sudo docker compose logs -f
```

Updating is `git pull && sudo docker compose up -d --build`. The `./data` volume
is what survives; without it the container forgets everything on restart.

---

## 12. Managed platforms instead of a server

If you would rather push and let the platform run it, **Railway** and **Fly.io**
both work well — but neither has a free tier for new accounts any more, so treat
them as paid hosts.

**Railway** (~$5/month of usage)

1. New project → **Deploy from GitHub repo** → pick your fork.
2. It detects Node, runs `npm ci` and `npm start`. Set the start command to
   `npm start` and the health check to `/health` if asked.
3. **Variables**: `NODE_ENV=production`, `PUBLIC_URL=https://<your-app>.up.railway.app`
   (or your custom domain), plus the Discord values if you want to skip the wizard.
4. **Settings → Networking → Generate domain**, then set `PUBLIC_URL` to it.
5. **Add a volume** mounted at `/app/data` — without it, photos and settings are
   lost on every deploy.

**Fly.io** (~$3–5/month)

```sh
fly launch --no-deploy          # generates fly.toml, keep the Dockerfile
fly volumes create statusc0rd_data --size 1
# in fly.toml: [[mounts]] source = "statusc0rd_data" destination = "/app/data"
fly secrets set PUBLIC_URL=https://your-app.fly.dev
fly deploy
```

Both platforms give HTTPS for free and keep the process running, so the
keep-alive is unnecessary. Everything else — URL mapping, wizard, publish — is
identical to §7–§8.

---

## 13. Security notes for a public server

- **Never open port 3000 to the internet.** Only 22, 80 and 443.
- Keep `data/` at mode `0600` (the app does this) and out of any git repository.
- `SESSION_SECRET` of 32+ characters, or let the app generate one.
- Rotate the bot token and client secret if they ever appear in a log or a
  screenshot — [security and rotation](setup.md#14-step-11-security-and-rotation).
- `ALLOWED_DISCORD_IDS` is the only thing that stops a stranger who can install
  your app from using it. Set it if the instance is public.
- Update the OS monthly: `sudo apt update && sudo apt upgrade -y`. Use
  `unattended-upgrades` if you want it automatic.

---

## 14. When something breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| `502` from Caddy | the Node service is down | `systemctl status statusc0rd`, `journalctl -u statusc0rd -n 50` |
| Caddy cannot get a certificate | DNS not pointing at the server yet, or port 80 blocked | `dig +short rpc.example.com`, open 80/443, `systemctl restart caddy` |
| `curl localhost:3000/health` fails | the unit crashed on start | check the log; usually a bad env value or a missing `npm ci` |
| `/setup` asks for a token and the log is empty | the token was printed on an earlier boot | `sudo cat /opt/statusc0rd/data/setup-token.txt`, or set `SETUP_TOKEN` |
| Photos show as a letter | `PUBLIC_URL` is not the `https://` origin | fix `/etc/statusc0rd.env`, restart, re-publish |
| Dashboard loads over `http://` and the session drops | HSTS/`Secure` cookie plus a proxy mismatch | always use the `https://` hostname |
| Everything resets after a redeploy | `data/` is not on a volume | mount `/app/data` (§11, §12) |
| `EADDRINUSE` | another copy is running | `systemctl stop statusc0rd`, `ps aux \| grep node` |
| Out of memory on a 512 MB server | too small for Node plus a build | use 1 GB or add swap |
| Activity opens blank | URL mapping wrong | `https://rpc.example.com/activity/` with the trailing slash |

Host-independent problems — Discord, buttons, the Activity, key recovery — are in
the [troubleshooting section](setup.md#18-troubleshooting) of the guide.

---

## 15. Checklist

- [ ] Server created, Ubuntu 24.04, SSH key, ports 22/80/443 only (§2, §4)
- [ ] DNS record points at the server and resolves (§3)
- [ ] Node 20+, code in `/opt/statusc0rd`, `npm ci` done (§5)
- [ ] `/etc/statusc0rd.env` contains `PUBLIC_URL=https://…` and is `0600` (§5)
- [ ] `systemctl status statusc0rd` is **active (running)** and enabled at boot (§5)
- [ ] `https://YOUR-HOST/health` returns `200` with a valid certificate (§6)
- [ ] Wizard finished (or env values set) (§7)
- [ ] **Enable Activities** ticked, URL mapping `/` → `https://YOUR-HOST/activity/` (§8)
- [ ] Card published; **Open in Discord** shows **On your profile** (§8)
- [ ] Nightly backup cron job installed and one archive exists (§10)
- [ ] Uptime monitor pointed at `/health` (§9)
