# Deploy a free instance in about 15 minutes

The shortest, genuinely free path from this repository to a live site like
`https://rpc.fallinguilt.bond/` — your own name, your own dashboard, your own
members, your own cards.

**Cost: ₹0 / $0.** No credit card, no trial that expires, nothing to cancel.
Render's free web service needs no card [1](https://render.com/docs/free), and
anything it cannot do is listed under [What you give up](#what-you-give-up-the-honest-list)
before you start, not after.

> This page is the *fast* path: one deploy, one Discord application, one wizard.
> The exhaustive reference — alternative hosts, custom domains, HTTPS by hand,
> every environment variable and limit — is [SETUP.md](SETUP.md).

---

## What you need before you start

| Thing | Why | Cost |
| --- | --- | --- |
| A GitHub account | Render builds from a copy of this repo | free |
| A Discord account | the application, the Activity, the bot | free |
| A browser | Render's dashboard and the setup wizard | — |

No terminal, no server, no SSH. Nothing is edited on disk at any point.

---

## Step 1 — Put a copy of this repo on your GitHub

Render deploys from a repository, and a fork keeps your deployment stable even if
this repo changes.

1. Open <https://github.com/Not4Pranav/StatusC0rd>.
2. **Fork** → **Create fork**. Leave the name as it is.
3. You now have `https://github.com/YOUR-USERNAME/StatusC0rd`.

> **Optional but recommended.** In the fork: **Settings → General → Features →
> Issues** stays as you like it. That is all — you do not need to change any
> file. `render.yaml` in the repository root is the deployment recipe.

---

## Step 2 — Deploy it on Render (free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Not4Pranav/StatusC0rd)

Or by hand: <https://dashboard.render.com> → **New +** → **Blueprint** → pick your
fork → **Apply**.

Render reads `render.yaml` and creates **one free web service**. It asks you for
a few values; all of them are optional:

| Render asks | What to put | Why |
| --- | --- | --- |
| `DASHBOARD_KEY` | 12+ characters you will remember | the owner key — the admin panel. Leave blank to choose it in the wizard instead |
| `CLIENT_ID` | your Discord application ID, or blank | fill it after Step 3 if you like |
| `CLIENT_SECRET` | your OAuth2 secret, or blank | same |
| `DISCORD_TOKEN` | your bot token, or blank | only for the 24/7 text card |
| `SITE_NAME` | e.g. `Star StatusC0rd`, or blank | the name in the header and titles — blank means `StatusC0rd` |
| `PUBLIC_URL` | **leave blank** | Render supplies the address automatically |
| `SESSION_SECRET` | nothing — Render generates it | cookie signing key |
| `BOT_WORKER_TOKEN` | leave blank | only for split hosting (SETUP.md 6.5) |

**`PUBLIC_URL` really can stay blank.** Render publishes the service URL to the
app as `RENDER_EXTERNAL_URL`, and StatusC0rd uses it for photo links, the
keep-alive and card pages. If you later attach a custom domain, set `PUBLIC_URL`
to it in **Environment** so Discord fetches photos from the right place.

Wait for the build — about two minutes. When the log ends with

```
StatusC0rd vX.Y.Z  ·  http://localhost:10000  ·  production
FIRST RUN - open the setup wizard to finish configuring
  Setup token: <sixteen hex characters>
```

…the service is live at `https://NAME.onrender.com`. Copy that address and the
**setup token** from **Logs**.

> Free services spin down after 15 minutes without traffic and take about a
> minute to wake [1](https://render.com/docs/free). The first visit after a nap
> shows Render's loading page; that is expected, and Step 6 removes it.

---

## Step 3 — The Discord application (5 minutes)

Do this in <https://discord.com/developers/applications>. SETUP.md Part 1 has
screenshots-in-words for each field.

1. **New Application** → name it. This name is what Discord shows in the App
   Launcher, so pick the one your friends should see; it does not have to match
   your site name.
2. **General Information** → copy the **Application ID**; **OAuth2** → copy the
   **Client Secret**.
3. **OAuth2 → Redirects → Add Redirect**:
   `https://NAME.onrender.com/auth/discord/callback` — exact string, no trailing
   slash. This is what authorising and **Connect Discord** use.
4. **Installation → Installation Contexts** → tick **User Install** *and*
   **Guild Install** → **Save Changes**. User Install is what lets a person add
   the app to **their own account**, which is how it appears in the App Launcher
   everywhere; Guild Install is what lets the bot join a server.
   Also set **Install Link** to `Discord Provided Link`.
5. **Activities → Settings** → tick **Enable Activities** (a URL Mapping has to
   exist first, hence step 6).
6. **Activities → URL Mappings** → prefix `/`, target
   `https://NAME.onrender.com/activity/` — **with** the trailing slash.
7. **Bot** (only if you want the 24/7 card) → **Reset Token** → copy it.

> **These two settings are the ones that fail silently.** With User Install off, or
> with the Launch command only installable to servers, everything on the website
> looks fine and the app is simply never listed in anyone's App Launcher. Once
> your instance is running, the dashboard's **Discord → Check the Discord
> application** button asks Discord and names exactly what is missing.

---

## Step 4 — The wizard

Open `https://NAME.onrender.com`. You are redirected to `/setup` because the
instance is new, and it wants the setup token from the log.

1. **Account** — paste the setup token, choose your dashboard key (12+
   characters, twice; **Generate a strong key** does it for you). This key *is*
   the admin panel; members use emails and passwords.
2. **Discord app** — paste the Application ID and Client Secret, optionally the
   bot token. **Test bot connection** says exactly what Discord answered if
   something is wrong.
3. **Presence** — a name and a line is enough. You can change everything later.
   *The public-URL box is already filled in with your `onrender.com` address and
   greyed out — Render gave the app its own address, so there is nothing to type
   and nothing to get wrong. It only becomes editable if you later set
   `PUBLIC_URL` yourself for a custom domain.*

Press **Finish setup**. You are signed in as the owner.

> Setup runs **once**. Afterwards `/api/setup/complete` answers `409`, so nobody
> can replay the wizard to rewrite your Discord application.

---

## Step 5 — Make it look like your own site

1. **Settings → This instance → Site name** → e.g. `Star StatusC0rd`. The header,
   every page title, the error pages and the footers of your card pages follow.
   A `0` in the name keeps the branded zero.
   *(If you set `SITE_NAME` in Render's environment, the field is read-only and
   says so.)*
2. **Presence** tab → build a card: title, type, both lines, large/small photo,
   buttons. **Publish**.
3. **Discord** tab → **Add to Discord**: Discord's own screen asks you to allow
   the app for **your account** (this is User Install — no bot permissions, no
   server needed). Approve it and you land back on the dashboard with the account
   connected.
4. Open Discord → **App Launcher** — the shapes icon next to the chat bar, or the
   rocket inside a voice channel → your app → **Launch**. Leave the panel open:
   your profile updates within seconds of every publish, photos and buttons
   included.
   *Already inside Discord first? The panel shows an eight-character code; type it
   at `/link` on the site instead of authorising. Same result, fifteen minutes to
   use it, single use.*
5. **Discord** tab → **Your public card page** → choose a handle, switch it on.
   You now have `https://NAME.onrender.com/c/HANDLE` — a page with your photo,
   both lines, a live timer and working buttons. That is the "website" half, and
   it is what you paste when someone asks what you are doing.

**Sign-ups are open by default**, so anyone with the link can create an account
and build their own card. Close them in **Settings**, or add people by hand under
**Members**.

---

## Step 6 — Keep it awake (so the bot stays online)

A sleeping free service has no Discord connection, so the 24/7 card dies with it.
Two switches, both in **Bot & 24/7**:

| Setting | Value | What it does |
| --- | --- | --- |
| **Keep the service awake** | on | pings `PUBLIC_URL/health` on a schedule |
| **Ping every (minutes)** | `10` | under Render's 15-minute idle window |

Render reports the public URL itself on this deployment, so the field is filled
in and locked; the tab shows `Will ping https://NAME.onrender.com/health every
10m`. After the first ping, **Waiting** turns into a timestamp.

**The hours arithmetic** — worth knowing before you add anything else:

- Render's free plan gives **750 instance hours per workspace per month** [1](https://render.com/docs/free).
- Kept awake around the clock, one service uses roughly **720–744** of them.
- A second free *web* service kept awake as well would use the same again and run
  you out — and when the hours are gone, **all** free services are suspended until
  the next month, not just one.

So: one awake web service on Render, and nothing else there.

### The bot on a second host (optional)

Render's free plan has **no background workers** — if you want the gateway to sit
somewhere that never sleeps, use a host that offers an always-on free box:

```sh
# On that host, with this repo checked out:
BOT_WORKER=1 \
BOT_URL=https://NAME.onrender.com \
BOT_WORKER_TOKEN=<the same 32+ character secret on both sides> \
DISCORD_TOKEN=<bot token> \
npm start
```

Then set `BOT_WORKER_TOKEN` in Render's **Environment** too. The dashboard will
show **Bot online (hosted separately)** from the worker's own reports. Hosts and
their catches: SETUP.md § 6.5.

---

## Step 7 — Things that will surprise you later

| What | Why | What to do |
| --- | --- | --- |
| **The disk is wiped** on restart or redeploy | free plan has no persistent disk; only `/tmp`-style scratch | keep `DASHBOARD_KEY`, `CLIENT_ID`, `CLIENT_SECRET`, `DISCORD_TOKEN`, `SITE_NAME` in Render's **Environment**, not just in the wizard. Then a wiped instance comes back configured |
| **`/setup` reappears** | the disk was wiped and no `DASHBOARD_KEY` was in the environment | set it in **Environment**, redeploy |
| **Uploaded photos vanish** after a restart | same reason — photos live on that disk | free-plan reality; Oracle Always Free or your own machine has a real disk (SETUP.md Part 2) |
| **The first request after idle is slow** | ~1 minute cold start | the keep-alive in Step 6 prevents it |
| **`robots.txt` says `Disallow: /`** while asleep | Render answers that itself, without waking your app | harmless |
| **750 hours run out** | several free services kept awake | delete unused services; hours reset on the 1st |

---

## Updating your instance

Render redeploys automatically when your fork changes:

```sh
# In GitHub's web editor, or a sync of your fork:
#   Not4Pranav/StatusC0rd  → your fork → "Sync fork"
```

Your environment variables and settings survive a redeploy; the disk does not.
`main` is always deployable — every release is tested with `npm test` before it
is merged.

---

## What you give up (the honest list)

| Free plan reality | Effect here | Workaround |
| --- | --- | --- |
| Sleeps after 15 idle minutes | bot offline while asleep | keep-alive (Step 6), or host the worker elsewhere |
| 512 MB RAM, ~0.1 CPU | fine for a few dozen people; not 500 | Oracle Always Free VM |
| No persistent disk | photos and settings lost on restart | keep settings in env vars; real disk on a VPS |
| No background workers | cannot host the bot worker on Render free | Fly/Koyeb/Oracle/own machine |
| 750 instance hours / workspace / month | one awake service only | one service, or move to a VPS |
| Render may restart it at any time | a few seconds of downtime | nothing to do; the app recovers |
| Render's own terms: "not for production" | fine for you and your friends | paid plan or VPS if it grows |

**What this does not change:** Discord only accepts rich presence from a Discord
client. The website is where you build, publish and share your card; the
in-Discord app is what puts it on your profile. No host can change that, free or
paid.

---

## If something goes wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Build fails, `npm ci` error | a fork with a broken lockfile | re-fork; do not edit `package-lock.json` |
| Page loads, but "deploy failed" in Render | the app exited at boot | read **Logs**; a `[config]` line names the bad variable |
| `/setup` asks for a token you do not have | logs rotated | `SETUP_TOKEN` in **Environment** pins one you choose |
| "That setup token is not correct" | extra space, or a different deploy's token | copy it again from **Logs** of *this* service |
| Connect Discord: "Invalid OAuth2 redirect_uri" | mismatch in Step 3.3 | the string must be exactly `https://NAME.onrender.com/auth/discord/callback` |
| The Activity is missing from the App Launcher | app not added to **your account** (User Install off), or Activities off | press **Add to Discord** in the dashboard, then **Check the Discord application**; Step 3.4 |
| The panel says "Connect your account" and shows a code | this Discord account is not connected to the site yet | type the code at `/link` while signed in — the panel goes live in about five seconds |
| Activity opens a blank frame | URL mapping missing the trailing slash | `/` → `https://NAME.onrender.com/activity/` |
| Photos show as a letter | the URL Discord sees is not https, or it cannot reach the host | check `PUBLIC_URL` in **Environment**; open the photo URL directly |
| Bot offline after ~15 minutes | keep-alive off | Step 6 |

More rows, including every error message the app can produce: SETUP.md Part 14.

---

## Where to go next

- [SETUP.md](SETUP.md) — the full guide: every host, every setting, every limit.
- [SETUP.md § 6.5](SETUP.md#65-hosting-the-bot-on-a-different-machine) — the bot on its own machine.
- [SETUP.md Part 11](SETUP.md#part-11-security) — key rotation, what to never share, recovery.
- The dashboard's own **Bot & 24/7** tab shows live state; no guessing.
