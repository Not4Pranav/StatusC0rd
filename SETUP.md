# StatusC0rd — setup (free)

One file, everything you need: a live web dashboard to build your Discord rich
presence (title, details, photos, buttons, a live timer), an in-Discord app that
puts photos and buttons on **your own profile**, and a bot that keeps a text card
online 24/7.

**Cost: $0. No credit card, no terminal — about 15 minutes in a browser.**
Deployed free on Render; every free-plan catch is in section 6, before it bites.

---

## 1 · Deploy on Render (free)

1. Open <https://dashboard.render.com> → **New +** → **Blueprint** → pick
   <code>Not4Pranav/StatusC0rd</code> → **Apply**. <code>render.yaml</code> does the
   rest: Node 22, <code>npm ci</code>, <code>npm start</code>, a <code>/health</code> check.
2. Fill in what it asks (all optional, but these survive restarts — section 6):

   | Variable | Put | Why |
   | --- | --- | --- |
   | <code>DASHBOARD_KEY</code> | 12+ characters you will remember | your owner key; skips the wizard key step |
   | <code>CLIENT_ID</code> | Discord application ID | from section 2 below |
   | <code>CLIENT_SECRET</code> | OAuth2 secret | from section 2 below |
   | <code>DISCORD_TOKEN</code> | bot token | the 24/7 bot card |
   | <code>SITE_NAME</code> | e.g. <code>Star StatusC0rd</code> | the name in the header and titles; blank means <code>StatusC0rd</code> |

   Leave <code>PUBLIC_URL</code> blank — Render supplies the address automatically.

3. The build takes about two minutes. The service goes live at
   <code>https://NAME.onrender.com</code>, and the first boot prints a **setup
   token** in **Logs** — copy both.

## 2 · The Discord application (~5 min)

At <https://discord.com/developers/applications>:

1. **New Application** → name it. This is what Discord shows for the bot and
   the Activity.
2. **General Information** → copy the **Application ID** (→ <code>CLIENT_ID</code>).
3. **OAuth2** → copy the **Client Secret** (→ <code>CLIENT_SECRET</code>).
4. **OAuth2 → Redirects → Add Redirect**:
   <code>https://NAME.onrender.com/auth/discord/callback</code> — exact string, no
   trailing slash.
5. **Activities → Settings** → tick **Enable Activities**.
6. **Activities → URL Mappings** → prefix <code>/</code>, target
   <code>https://NAME.onrender.com/activity/</code> — **with** the trailing slash.
7. **Bot → Reset Token** → copy it (→ <code>DISCORD_TOKEN</code>).
8. **OAuth2 → URL Generator** → scopes <code>bot</code> +
   <code>applications.commands</code> → open the generated URL → pick your
   server → **Authorize**.

Paste <code>CLIENT_ID</code>, <code>CLIENT_SECRET</code> and <code>DISCORD_TOKEN</code>
into Render **Environment** if you left them blank in section 1, then redeploy.

## 3 · The wizard (once)

Open <code>https://NAME.onrender.com</code> — a new instance redirects to
<code>/setup</code>:

1. **Account** — paste the setup token from the Logs, set your dashboard key.
2. **Discord app** — Application ID, Client Secret, optionally the bot token.
   **Test bot connection** tells you exactly what Discord answered.
3. **Presence** — a name and one line is enough; everything changes later. The
   public URL is already filled in and locked — Render gave the app its own
   address.

**Finish setup** signs you in as the owner. The wizard runs **once**; it cannot be
replayed to rewrite your Discord application.

## 4 · Go live

- **Presence** tab → build the card: title, type, both lines, large/small photo,
  buttons → **Publish**.
- **Discord** tab → **Connect Discord** → link your account.
- **Discord** tab → **Open in Discord** → join a voice channel → open the
  **App Launcher** → your app. Keep that panel open: the card with photos and
  buttons sits on your profile and updates within seconds of every publish.
- The **bot card** (text-only — Discord drops images for bots) is online
  whenever the service is.
- **Discord** tab → **Your public card page** → pick a handle, switch it on →
  <code>https://NAME.onrender.com/c/HANDLE</code> is the shareable page.
- Sign-ups are open by default; close them in **Settings** if it is just you.

## 5 · Keep it awake

A sleeping free service has no Discord connection, so the bot card dies with it.
In **Bot &amp; 24/7**: keep **Keep the service awake** on and the interval at
<code>10</code> minutes (under Render 15-minute idle window). On this deploy the
URL is already filled in and locked — nothing to type.

Hours arithmetic: Render free gives **750 instance-hours per month**; one
service kept awake uses about 744. Run nothing else free there, or everything
suspends when the pool empties.

## 6 · Free-plan realities

| What happens | Why | What to do |
| --- | --- | --- |
| Disk wiped on restart/redeploy | free plan has no persistent disk | the five section-1 variables bring the instance back configured |
| Uploaded photos vanish | they lived on that disk | re-upload; a VPS or Oracle Always Free box has a real disk |
| First request after idle is slow | ~1 minute cold start | section 5 prevents it |
| <code>robots.txt</code> shows <code>Disallow: /</code> while asleep | Render answers without waking the app | harmless |

**True 24/7 bot (optional).** Render free has no background workers. On any
always-on box with this repo checked out:

<pre>BOT_WORKER=1 \
BOT_URL=https://NAME.onrender.com \
BOT_WORKER_TOKEN=&lt;32+ character secret, same on both sides&gt; \
DISCORD_TOKEN=&lt;bot token&gt; \
npm start</pre>

…then set the same <code>BOT_WORKER_TOKEN</code> in Render **Environment**. The
dashboard will show *Bot online (hosted separately)*.

## 7 · If something breaks

| Symptom | Fix |
| --- | --- |
| Page loads but Render says deploy failed | the app exited at boot — read **Logs**; a <code>[config]</code> line names the bad variable |
| <code>/setup</code> asks for a token you do not have | logs rotated — set <code>SETUP_TOKEN</code> in **Environment** to pin one |
| That setup token is not correct | copy it again from **Logs** of *this* service |
| Connect Discord: Invalid OAuth2 redirect_uri | must be exactly <code>https://NAME.onrender.com/auth/discord/callback</code> |
| Activity missing from the App Launcher | re-invite with <code>bot</code> + <code>applications.commands</code>; Activities enabled (section 2.5) |
| Activity opens a blank frame | URL mapping needs the trailing slash: <code>/activity/</code> |
| Photos render as a letter | the URL Discord sees is not https or unreachable — check <code>PUBLIC_URL</code> |
| Bot offline after ~15 minutes | keep-alive is off — section 5 |
| <code>/setup</code> reappears out of nowhere | disk was wiped — put <code>DASHBOARD_KEY</code> in **Environment** |

Render redeploys automatically when <code>main</code> changes. Environment
survives; the disk does not.