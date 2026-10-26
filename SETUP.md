# StatusC0rd — setup (free, multi-user)

One file, everything you need: a live web dashboard where **anyone can sign in
with Discord** and build their own rich presence (title, details, photos,
buttons, a live timer), an in-Discord app that puts photos and buttons on
**each user's own profile**, and a bot that keeps a text card online 24/7.
Everyone gets their own card, their own photos and their own public card page -
just like the reference site.

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
   | <code>CLIENT_ID</code> | Discord application ID | from section 2 below |
   | <code>CLIENT_SECRET</code> | OAuth2 secret | from section 2 below — **required** for sign-in |
   | <code>DISCORD_TOKEN</code> | bot token | the 24/7 bot card |
   | <code>ADMIN_DISCORD_IDS</code> | your Discord id | who owns the instance; blank = first sign-in |
   | <code>SESSION_SECRET</code> | any long random string | keeps everyone signed in across restarts |
   | <code>SITE_NAME</code> | e.g. <code>Star StatusC0rd</code> | the name in the header and titles; blank means <code>StatusC0rd</code> |

   Leave <code>PUBLIC_URL</code> blank — Render supplies the address automatically.

3. The build takes about two minutes. The service goes live at
   <code>https://NAME.onrender.com</code>.

## 2 · The Discord application (~5 min)

At <https://discord.com/developers/applications>:

1. **New Application** → name it. This is what Discord shows for the bot and
   the Activity.
2. **General Information** → copy the **Application ID** (→ <code>CLIENT_ID</code>).
3. **OAuth2** → copy the **Client Secret** (→ <code>CLIENT_SECRET</code>).
4. **OAuth2 → Redirects → Add Redirect** (this is now **required** — it is how
   everyone signs in):
   <code>https://NAME.onrender.com/auth/discord/callback</code> — exact string,
   no trailing slash.
5. **Activities → Settings** → tick **Enable Activities**.
6. **Activities → URL Mappings** → prefix <code>/</code>, target
   <code>https://NAME.onrender.com/activity/</code> — **with** the trailing slash.
7. **Bot → Reset Token** → copy it (→ <code>DISCORD_TOKEN</code>).
8. **Installation** (sidebar) → under **Installation Contexts** tick both
   **User Install** and **Guild Install** → **Save Changes**. User Install is
   what lets anyone add the app to their account - no server invite needed.
9. Still on **Installation** → **Install Link**: keep **Discord Provided
   Link**. Under **Default Install Settings**, add the
   <code>applications.commands</code> scope to **User Install**, and
   <code>applications.commands</code> + <code>bot</code> (any permissions) to
   **Guild Install** → **Save Changes**.
10. Invite: open the **Install Link** from that page - or press
    <strong>Add to Discord</strong> on your site (it serves <code>/invite</code>).
    One link, two choices: <strong>Add to my apps</strong> installs it to the
    user's account (this is what puts it in their App Launcher anywhere),
    <strong>Add to server</strong> invites the bot for the admin's 24/7 card.

## 3 · Sign in and configure

Open <code>https://NAME.onrender.com</code> → **Continue with Discord**.
Whoever signs in first (or whoever is in <code>ADMIN_DISCORD_IDS</code>) is the
admin and sees the **Instance** panel:

- paste the **Application ID** and **Client Secret** there if you skipped the
  environment (blank secret fields mean "unchanged"),
- set the **Site name** if you want your own brand,
- **Save instance**.

Everyone else just signs in and builds — no admin rights, no instance panel,
and their card is profile-only (the gateway bot is single-card: the admin's).

## 4 · Go live (any user)

- **Your card** → build it: name, type, details, state, photos, buttons,
  elapsed timer → **Save & publish**. The **Preview** shows exactly what your
  friends see.
- **Photos and buttons on your own profile**: in Discord, join a voice channel
  → open the **App Launcher** → your app → StatusC0rd. Keep that window open:
  your profile updates within five seconds of every publish. Each Discord user
  who opens the app gets **their own** card — no codes, no allowlist.
- **Public card page**: switch on *Publish my card page* and share
  <code>https://NAME.onrender.com/card/YOUR-DISCORD-ID</code> — your card,
  live timer and buttons, readable by anyone with the link. Off by default.
  The admin's card also answers at plain <code>/card</code>.
- The **bot card** (text-only — Discord drops images for bots) shows the
  admin's card and goes online the moment the service starts.
- **The bot drives the approval flow**: when it is added to a server it posts
  the dashboard link in the channel, and the <code>/dashboard</code>,
  <code>/card</code> and <code>/invite</code> slash commands work in servers
  and (after a user install) in DMs. A member presses **Open the dashboard**,
  signs in with Discord - and their account is approved on the spot. No
  manual accept-list to maintain.

## 5 · Keep it awake (24/7 bot)

A sleeping free service has no Discord connection, so the bot card dies with
it. Under **Instance** (admin), keep the **Keep-alive** on with a 10-minute
interval (under Render's 15-minute idle window). The keep-alive pings the
public <code>/health</code> route, which counts as inbound traffic.

Hours arithmetic: Render free gives **750 instance-hours per month**; one
service kept awake uses about 744. Run nothing else free there, or everything
suspends when the pool empties. For belt-and-braces, point a free
UptimeRobot monitor at the same <code>/health</code> URL.

## 6 · Free-plan realities

| What happens | Why | What to do |
| --- | --- | --- |
| Disk wiped on restart/redeploy | free plan has no persistent disk | the section-1 variables bring the instance back configured |
| Accounts, cards and photos vanish | they lived on that disk | users re-sign-in with Discord (one click) and rebuild; a VPS or Oracle Always Free box has a real disk |
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
| Sign-in bounces back to the landing page | <code>CLIENT_ID</code>/<code>CLIENT_SECRET</code> missing, or the redirect in section 2.4 is not exact |
| Invalid OAuth2 redirect_uri | must be exactly <code>https://NAME.onrender.com/auth/discord/callback</code> |
| Someone is not the admin | put their Discord id in <code>ADMIN_DISCORD_IDS</code> and redeploy |
| No welcome message when the bot joins | the channel blocks bot messages, or the bot token / <code>PUBLIC_URL</code> is missing |
| Slash commands do not answer | give it a minute after the bot comes online, or re-invite with <code>applications.commands</code> |
| Activity missing from the App Launcher | user-install the app ("Add to my apps" via <code>/invite</code>); Activities enabled (section 2.5) |
| Activity opens a blank frame | URL mapping needs the trailing slash: <code>/activity/</code> |
| The Activity says "No account here yet" | that user has not signed in on the website yet — one click, then reopen the app |
| Photos render as a letter | the URL Discord sees is not https or unreachable — check <code>PUBLIC_URL</code> |
| Bot offline after ~15 minutes | keep-alive is off — section 5 |
| Someone else's card on the bot | the bot carries the admin's card only — that is by design (one bot, one card) |

Render redeploys automatically when <code>main</code> changes. Environment
survives; the disk does not.
