# StatusC0rd — setup (free)

One file, everything you need: a live web dashboard to build your Discord rich
presence (title, details, photos, buttons, a live timer), an in-Discord app
that puts photos and buttons on **your own profile**, and a bot that keeps a
text card online 24/7. One owner, one card — the dashboard key is the whole
login.

**Cost: $0. No credit card, no terminal — about 15 minutes in a browser.**
Deployed free on Render; every free-plan catch is in section 6, before it bites.

---

## 1 · Deploy on Render (free)

1. Open <https://dashboard.render.com> → **New +** → **Blueprint** → pick
   <code>Not4Pranav/StatusC0rd</code> → **Apply**. <code>render.yaml</code> does
   the rest: Node 22, <code>npm ci</code>, <code>npm start</code>, a
   <code>/health</code> check.
2. Fill in what it asks (all optional, but these survive restarts — section 6):

   | Variable | Put | Why |
   | --- | --- | --- |
   | <code>DASHBOARD_KEY</code> | 12+ characters you will remember | your login — skip the generated key |
   | <code>CLIENT_ID</code> | Discord application ID | from section 2 below |
   | <code>CLIENT_SECRET</code> | OAuth2 secret | from section 2 below |
   | <code>DISCORD_TOKEN</code> | bot token | the 24/7 bot card |
   | <code>SITE_NAME</code> | e.g. <code>Star StatusC0rd</code> | the name in the header and titles; blank means <code>StatusC0rd</code> |

   Leave <code>PUBLIC_URL</code> blank — Render supplies the address automatically.

3. The build takes about two minutes. The service goes live at
   <code>https://NAME.onrender.com</code>. If you set no
   <code>DASHBOARD_KEY</code>, the first boot prints a generated key in
   **Logs** — copy it; it is shown once.

## 2 · The Discord application (~5 min)

At <https://discord.com/developers/applications>:

1. **New Application** → name it. This is what Discord shows for the bot and
   the Activity.
2. **General Information** → copy the **Application ID** (→ <code>CLIENT_ID</code>).
3. **OAuth2** → copy the **Client Secret** (→ <code>CLIENT_SECRET</code>).
4. **OAuth2 → Redirects → Add Redirect**:
   <code>https://NAME.onrender.com/auth/discord/callback</code> — exact string,
   no trailing slash. This is what **Connect Discord** uses.
5. **Activities → Settings** → tick **Enable Activities**.
6. **Activities → URL Mappings** → prefix <code>/</code>, target
   <code>https://NAME.onrender.com/activity/</code> — **with** the trailing slash.
7. **Bot → Reset Token** → copy it (→ <code>DISCORD_TOKEN</code>).
8. **OAuth2 → URL Generator** → scopes <code>bot</code> +
   <code>applications.commands</code> → open the generated URL → pick your
   server → **Authorize**.

## 3 · Sign in and configure

Open <code>https://NAME.onrender.com</code> and sign in with the dashboard key.
Under **Instance**:

- paste the **Application ID** and **Client Secret**,
- paste the **Bot token** (blank fields mean "unchanged"),
- set the **Site name** if you want your own brand,
- **Save instance**.

Then, in the **Discord** panel, press **Connect Discord** once — that links
your Discord account so the in-Discord app knows it is you.

## 4 · Go live

- **Your card** → build it: name, type, details, state, photos, buttons,
  elapsed timer → **Save & publish**. The **Preview** shows exactly what your
  friends see.
- The **bot card** (text-only — Discord drops images for bots) goes online the
  moment the service starts.
- **Photos and buttons on your own profile**: in Discord, join a voice channel
  → open the **App Launcher** → your app → StatusC0rd. Keep that window open:
  your profile updates within five seconds of every publish.
- **Public card page**: switch on *Publish the card at /card* and share
  <code>https://NAME.onrender.com/card</code> — your card, live timer and
  buttons, readable by anyone with the link. Off by default.

## 5 · Keep it awake

A sleeping free service has no Discord connection, so the bot card dies with
it. Under **Instance**, keep the **Keep-alive** on with a 10-minute interval
(under Render 15-minute idle window).

Hours arithmetic: Render free gives **750 instance-hours per month**; one
service kept awake uses about 744. Run nothing else free there, or everything
suspends when the pool empties.

## 6 · Free-plan realities

| What happens | Why | What to do |
| --- | --- | --- |
| Disk wiped on restart/redeploy | free plan has no persistent disk | the five section-1 variables bring the instance back configured |
| Uploaded photos vanish | they lived on that disk | re-upload; a VPS or Oracle Always Free box has a real disk |
| First request after idle is slow | ~1 minute cold start | section 5 prevents it |
| Everyone is signed out | the cookie secret lived on that disk | set <code>SESSION_SECRET</code> in the environment |

**Truly always-on:** run this same repository on any always-on box — a free
Oracle VM, a Raspberry Pi at home — with a real disk and the same
<code>npm start</code>; nothing needs splitting, the website and the bot are
one process.

## 7 · If something breaks

| Symptom | Fix |
| --- | --- |
| Page loads but Render says deploy failed | read Render **Logs** — the boot banner names the problem |
| The generated key is gone from the logs | logs rotated — set <code>DASHBOARD_KEY</code> in **Environment**, redeploy |
| That dashboard key is not right | five wrong attempts lock sign-in for 15 minutes per IP |
| Connect Discord: Invalid OAuth2 redirect_uri | must be exactly <code>https://NAME.onrender.com/auth/discord/callback</code> |
| Activity missing from the App Launcher | re-invite with <code>bot</code> + <code>applications.commands</code>; Activities enabled (section 2.5) |
| Activity opens a blank frame | URL mapping needs the trailing slash: <code>/activity/</code> |
| The Activity says "not the owner yet" | press **Connect Discord** in the dashboard once |
| Photos render as a letter | the URL Discord sees is not https or unreachable — check <code>PUBLIC_URL</code> |
| Bot offline after ~15 minutes | keep-alive is off — section 5 |

Render redeploys automatically when <code>main</code> changes. Environment
survives; the disk does not.
