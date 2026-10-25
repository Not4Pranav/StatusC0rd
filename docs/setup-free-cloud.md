# Run it on free cloud hosting

> **This is the free-cloud path.** Three genuinely $0 options, each with its own
> catch stated up front. The parts that never change — the Discord application,
> the wizard, the dashboard, the profile, the bot card — are in
> [the setup guide](setup.md); every link you need is below.
>
> Already have a server? [Cloud server](setup-cloud.md). Already have a machine
> at home? [Your own computer](setup-local.md).

## 1. Which free host

| | **[Render free](#2-path-a-render-free)** | **[Oracle Always Free](#3-path-b-oracle-always-free)** | **[GCP Always Free](#4-path-c-gcp-always-free-e2-micro)** |
| --- | --- | --- | --- |
| Time | ~10 min | ~45–60 min | ~30 min |
| Card required | no | yes (identity check, never charged) | yes (billing account, never charged while in the free tier) |
| Machine | managed | 2 OCPU / 12 GB ARM, 200 GB disk | 1 shared vCPU / 1 GB, 30 GB disk |
| Sleeps? | **yes, after 15 min idle** — the keep-alive prevents it | never | never |
| Disk | **ephemeral: wiped on restart** | persistent | persistent |
| Egress | included | 10 TB/month | **1 GB/month from North America** |
| HTTPS | included | Caddy + Let's Encrypt | Caddy + Let's Encrypt |
| Verdict | fastest way to see it working | **best free option: set it once, forget it** | fine for one user, watch the egress |

**Recommendation:** start on **Render** if you just want to see a card on your
profile today; move to **Oracle** when you want the photos and settings to stop
disappearing. Oracle is the only free option that behaves like a real server.

Whatever you choose, the finish line is the same three things: an `https://` URL,
`PUBLIC_URL` set to it, and a process that comes back after a reboot.

**Before any path: the four Discord values** (2 minutes — the full walkthrough,
with every click and every pitfall, is [the Discord application](setup.md#4-step-1-the-discord-application)):

1. <https://discord.com/developers/applications> → **New Application**.
2. **General Information** → copy the **Application ID** (public).
3. **OAuth2 → General** → **Reset Secret** → copy the **Client Secret** (private).
4. **Bot → Reset Token** → copy the **Bot token** (private, optional — it only
   adds the text card that stays online 24/7).

Then, once your instance has a public URL, come back to the portal and do the two
clicks that make photos and buttons possible:

5. **Activities → Settings** → tick **Enable Activities**.
6. **Activities → URL Mappings** → prefix **`/`** → target
   **`https://YOUR-HOST/activity/`** (trailing slash kept).

---

## 2. Path A: Render free

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
   | `CLIENT_ID` | the Application ID from [the Discord application](setup.md#4-step-1-the-discord-application) |
   | `CLIENT_SECRET` | the OAuth2 client secret |
   | `DISCORD_TOKEN` | the bot token (optional) |
   | `PUBLIC_URL` | leave blank for now — set it after the first deploy |
   | `SETUP_TOKEN` | leave blank unless you want a fixed wizard token |
   | `ALLOWED_DISCORD_IDS`, `REDIRECT_URI` | leave blank — both are optional |

4. **Apply** → wait for **Live** → copy the URL
   (`https://something.onrender.com`).
5. **Environment** → set `PUBLIC_URL` to exactly that URL (no trailing slash) →
   save; Render redeploys automatically.

   > Setting `DASHBOARD_KEY` in the environment means the wizard is skipped and
   > the site is configured as-is. Without it, the first visit lands on `/setup`.

6. Open the URL and finish the wizard (or skip it if you set the variables).
   What you land on is mapped in
   [the dashboard, tab by tab](setup.md#7-the-dashboard-tab-by-tab).
7. **Bot & 24/7 → 24/7 online** → keep **Keep this server awake** ticked with an
   interval **under 15 minutes**. This is what stops Render from spinning the
   service down — and a spun-down service is an offline bot.
8. Discord side: the two portal clicks are in the box at the top of this page —
   **Enable Activities** and the `/` → `https://YOUR-APP.onrender.com/activity/`
   mapping — then **Publish** and **Open in Discord**
   ([details](setup.md#9-step-5-on-your-own-profile-no-install)).

**Render free-tier truths**

- 512 MB RAM, 0.1 CPU, 750 instance-hours per workspace per month. A 31-day month
  is 744 hours, so one always-awake service fits — do not add a second.
- **The disk is ephemeral.** Files are lost on restart, redeploy or spin-down.
  Environment variables survive, and the keep-alive prevents *idle* spin-downs,
  but a Render restart means re-entering the presence and re-uploading photos.
- Cold start after a real spin-down is about a minute, and the bot reconnects by
  itself.
- Free services get no custom domain of their own — use the `onrender.com` one.

**If losing the data bothers you** — and it should, once you have photos you
like — either keep `DASHBOARD_KEY`, `CLIENT_ID`, `CLIENT_SECRET`, `DISCORD_TOKEN`
and `PUBLIC_URL` in the environment (so a wiped instance boots straight back into
a working dashboard) or move to [Path B](#3-path-b-oracle-always-free), which has
a real disk for the same $0.

---

## 3. Path B: Oracle Always Free

New Oracle accounts get **2 OCPU / 12 GB RAM** of Ampere A1 (ARM) plus **200 GB**
of block storage and 10 TB/month egress, free forever. A card is required for
identity verification; Always Free resources are never charged. Availability of
the A1 shape varies by region — if it is out of capacity, try 1 OCPU / 6 GB, a
different availability domain, or a different home region at signup.

**1. Create the instance**

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

**2. Install and run it**

```sh
ssh ubuntu@YOUR_PUBLIC_IP
sudo apt update && sudo apt install -y docker.io git
sudo usermod -aG docker "$USER" && newgrp docker
git clone https://github.com/YOUR-NAME/StatusC0rd.git && cd StatusC0rd
```

Build and run it with a persistent volume, bound to localhost only. The image
runs as the unprivileged `node` user (uid 1000), so the mounted folder has to
belong to it — otherwise the first save fails with `EACCES`:

```sh
mkdir -p data && sudo chown -R 1000:1000 data
docker build -t statusc0rd .
docker run -d --name statusc0rd --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e PUBLIC_URL=https://statusc0rd-yourname.duckdns.org \
  -v "$PWD/data:/app/data" \
  statusc0rd
```

`--restart unless-stopped` is what brings it back after a reboot.

**3. HTTPS with Caddy**

```sh
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
statusc0rd-yourname.duckdns.org {
  reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl restart caddy
curl -I https://statusc0rd-yourname.duckdns.org/health     # expect 200
```

**4. Finish**

1. Open `https://statusc0rd-yourname.duckdns.org/setup`.
2. It asks for the setup token: `docker logs statusc0rd | grep -i token`, or
   `cat data/setup-token.txt`.
3. Choose the dashboard key, paste the Application ID and Client Secret, press
   **Finish setup** ([the wizard](setup.md#6-step-3-first-boot-and-the-wizard)).
4. Discord: **Enable Activities**, URL mapping **`/`** →
   `https://statusc0rd-yourname.duckdns.org/activity/` ([details](setup.md#9-step-5-on-your-own-profile-no-install)).
5. Publish the card, then **My profile → Open in Discord**.

The keep-alive is harmless here and doubles as a liveness check, but a VM never
sleeps, so it is optional.

**Updates and backups**

```sh
cd ~/StatusC0rd && git pull
docker build -t statusc0rd . && docker restart statusc0rd

tar -czf statusc0rd-backup-$(date +%F).tgz data/     # backup
```

`data/` survives every rebuild. Restore by unpacking it back into place before
starting the container. A nightly cron job like the one in
[cloud server §10](setup-cloud.md#10-update-and-back-up) works unchanged.

Oracle occasionally reclaims Always Free instances that look completely idle. A
running bot with a live gateway connection is enough activity in practice, and the
keep-alive ping adds more.

---

## 4. Path C: GCP Always Free (e2-micro)

**The deal:** one `e2-micro` instance per month in `us-west1`, `us-central1` or
`us-east1`, 30 GB of standard persistent disk, and **1 GB of egress per month**
from North America. A billing account is required; staying inside the free tier
costs nothing.

**1. Create the instance**

1. <https://console.cloud.google.com> → **Compute Engine → VM instances → Create
   instance**.
2. Region: `us-central1` (or `us-west1` / `us-east1`) — the free ones only.
3. Machine type: **e2-micro**; boot disk **Ubuntu 24.04 LTS**, 30 GB standard
   persistent disk.
4. **Firewall**: allow HTTP and HTTPS traffic.
5. Create, then reserve a **static external IP** (Networking → IP addresses →
   promote the ephemeral IP) so the address survives a reboot.
6. Point a DuckDNS subdomain at that IP.

**2. Install and run it**

```sh
ssh YOUR_USER@YOUR_STATIC_IP
sudo apt update && sudo apt install -y nodejs npm git caddy
node -v        # v20+ required; use https://github.com/nodesource/distributions if it is older

sudo git clone https://github.com/YOUR-NAME/StatusC0rd.git /opt/statusc0rd
cd /opt/statusc0rd && sudo npm ci --omit=dev
sudo chown -R statusc0rd:statusc0rd /opt/statusc0rd
```

Run it as a service exactly as in
[cloud server §5](setup-cloud.md#5-install-the-app-and-run-it-as-a-service) —
same unit file, same `/etc/statusc0rd.env` with `PUBLIC_URL=https://your.duckdns.org`
— then Caddy as in [§6](setup-cloud.md#6-put-https-in-front-with-caddy).

```sh
sudo systemctl enable --now statusc0rd
curl -I https://your.duckdns.org/health
```

**3. Finish**

Same as every other path: open `/setup`, use the token from
`journalctl -u statusc0rd` or `/opt/statusc0rd/data/setup-token.txt`, paste the
Discord values, then set the URL mapping to
`https://your.duckdns.org/activity/` and publish.

**The catch: 1 GB of egress per month.** Photo fetches, the dashboard and the bot
gateway all count. A 512 px WebP is 30–60 KB, so a single user is comfortably
inside the limit; a busy shared instance is not. Turn the keep-alive **off** here
(on a VM it does nothing useful and the pings consume a little egress), and check
**Billing → Reports** after a week.

Add swap so 1 GB of RAM goes further:

```sh
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 5. What "free" actually costs you

- **Render free** — a spin-down after 15 idle minutes (the keep-alive prevents
  it), an ephemeral disk, and shared CPU. Nothing is charged; nothing is
  guaranteed.
- **Oracle Always Free** — free forever, but signup needs a card and occasionally
  refuses applicants; the ARM shape can be out of capacity; a completely idle
  instance may be reclaimed.
- **GCP free tier** — free while it stays inside the quota; the 1 GB egress cap
  is the one to watch, and it only applies to the three US regions listed.

None of them is suitable for many users on one instance. StatusC0rd is
single-tenant by design (one dashboard key, one presence); if several people
should each have their own card on their own profile, that is one instance per
person, or the paid [cloud server](setup-cloud.md) path.

---

## 6. Backups on a free host

| Host | What is at risk | What to do |
| --- | --- | --- |
| Render free | everything except env vars, on every restart | `tar -czf backup.tgz data/` from your own machine is not possible — the disk is remote and ephemeral, so keep the **Discord values in environment variables** and re-upload photos after a wipe |
| Oracle | nothing, as long as the boot volume exists | nightly `tar` into `/var/backups`, or copy `data/` down with `scp` |
| GCP | nothing, the disk is persistent | same as Oracle, watch that you do not fill 30 GB |

For Oracle and GCP the backup one-liner from
[cloud server §10](setup-cloud.md#10-update-and-back-up) applies as-is.

---

## 7. When something breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| Render: `/setup` again after a while | the service restarted and the disk is ephemeral | set the Discord values **and** `DASHBOARD_KEY` in Render's environment |
| Render: bot offline every ~15 min | keep-alive off, or `PUBLIC_URL` is wrong | **Bot & 24/7** → correct URL, keep-alive on, interval under 15 min |
| Render: first request takes 50 seconds | asleep after a real spin-down | expected; the keep-alive prevents it |
| Oracle: cannot create the A1 instance | regional capacity | try 1 OCPU/6 GB, another availability domain, or another region at signup |
| Oracle: Caddy certificate fails | DuckDNS not updated yet | `dig +short your.duckdns.org`, wait, `systemctl restart caddy` |
| Oracle: "permission denied" on Docker | group not refreshed | `newgrp docker` or log out and back in |
| Oracle: instance reclaimed after weeks of idling | Always Free reclamation | recreate it, restore `data/`, keep the bot running |
| GCP: site unreachable | firewall rule missing | VPC → Firewall → allow `tcp:80,443` for the `http-server`/`https-server` tags |
| GCP: IP changed after reboot | ephemeral IP | reserve a static external IP |
| GCP: billing alert about egress | over 1 GB/month | disable the keep-alive, shrink photos, or move to Oracle |
| Any: photos show as a letter | `PUBLIC_URL` wrong or not `https://` | fix it in **Bot & 24/7**, re-publish |
| Any: Activity opens blank | URL mapping missing | prefix `/` → `https://YOUR-HOST/activity/` |

Everything host-independent — Discord errors, buttons, key recovery — is in the
[troubleshooting section](setup.md#19-troubleshooting) of the guide.

---

## 8. Checklist

**Render**

- [ ] Blueprint deployed, service **Live**, URL copied
- [ ] `PUBLIC_URL` set to that exact URL, redeploy finished
- [ ] Wizard completed, or all Discord values in environment variables
- [ ] Keep-alive on, interval under 15 min
- [ ] **Enable Activities** ticked, URL mapping `/` → `…/activity/`
- [ ] Card published; **Open in Discord** shows **On your profile**

**Oracle**

- [ ] A1 instance running, ports 80/443 open in the security list
- [ ] DuckDNS hostname resolves to the public IP
- [ ] Container running with `--restart unless-stopped` and `-v ./data:/app/data`
- [ ] Caddy serving `https://…` with a valid certificate
- [ ] Wizard finished with the token from `docker logs`
- [ ] URL mapping `/` → `https://…/activity/`; card published
- [ ] A `data/` backup exists somewhere other than the instance

**GCP**

- [ ] e2-micro in a free region, static IP reserved, 80/443 allowed
- [ ] `systemctl status statusc0rd` active and enabled
- [ ] HTTPS via Caddy, `/health` returns `200`
- [ ] Keep-alive **off** (egress), wizard finished, URL mapping set
- [ ] Billing report checked after a week
