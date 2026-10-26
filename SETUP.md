# StatusC0rd — setup (free, multi-user)

One file, everything you need: the **same approval pipeline as the reference
site** — type <code>;rpc</code> in Discord, press **Open Dashboard** in the bot's reply,
register with **email + password** on the website, and build your rich presence
(title, details, photos, buttons, a live timer). An in-Discord app puts photos
and buttons on **each user's own profile**, and a bot keeps a text card online
24/7. Everyone gets their own card, their own photos and their own public
card page.

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
   | <code>CLIENT_SECRET</code> | OAuth2 secret | from section 2 below — required for the in-Discord app |
   | <code>DISCORD_TOKEN</code> | bot token | the 24/7 bot — it also reads <code>;rpc</code> |
   | <code>ADMIN_DISCORD_IDS</code> | your Discord id | who owns the instance; blank = first registration |
   | <code>SESSION_SECRET</code> | any long random string | keeps everyone signed in across restarts and signs the <code>;rpc</code> links |
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
   No OAuth redirect is needed — sign-in is email + password on your own site.
4. **Bot → Reset Token** → copy it (→ <code>DISCORD_TOKEN</code>).
5. **Bot → Privileged Gateway Intents** → switch on **Message Content
   Intent** → **Save Changes**. Without it the bot cannot see <code>;rpc</code>
   (the dashboard keeps working; the bot reconnects without <code>;rpc</code>
   until the intent is on).
6. **Activities → Settings** → tick **Enable Activities**.
7. **Activities → URL Mappings** → prefix <code>/</code>, target
   <code>https://NAME.onrender.com/activity/</code> — **with** the trailing slash.
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

## 3 · The approval pipeline (how anyone gets in)

Exactly the reference workflow, top to bottom:

1. A member types **<code>;rpc</code>** in any channel where the bot is (or in
   its DMs).
2. The bot answers with the **Custom RPC Dashboard** card — *“Sign in, link
   your Discord and set your own status and images.”* — and an **Open
   Dashboard** button.
3. Discord shows its *Leaving Discord* screen → the member lands on your site
   with a green **Approving Discord account** banner.
4. They create the account with **email + password** (or log in) — and the
   moment they do, their Discord account is approved and linked. That is the
   whole approval: no manual accept-list, nothing to click in a queue.
5. They are in the **RPC Dashboard**.

Whoever registers first (or whoever is in <code>ADMIN_DISCORD_IDS</code>) is the
admin and sees the **Instance** panel: application id, client secret, site
name, support server, keep-alive. Everyone else just builds — no admin rights,
and their card is profile-only (the gateway bot is single-card: the admin's).

## 4 · Go live (any user)

- **Your card** → build it: name, type, details, state, photos, buttons,
  elapsed timer → **Save & Update**. The **Live Preview** shows exactly what
  your friends see.
- **Photos and buttons on your own profile**: in Discord, join a voice channel
  → open the **App Launcher** → your app → StatusC0rd. Keep that window open:
  your profile updates within five seconds of every save. Each Discord user
  who opens the app gets **their own** card — no codes, no allowlist.
- **Public card page**: switch on *Publish my card page* and share
  <code>https://NAME.onrender.com/card/YOUR-DISCORD-ID</code> — your card,
  live timer and buttons, readable by anyone with the link. Off by default.
  The admin's card also answers at plain <code>/card</code>.
- The **bot card** (text-only — Discord drops images for bots) shows the
  admin's card and goes online the moment the service starts.
- **The bot drives the approval flow**: when it is added to a server it posts
  the welcome card, <code>;rpc</code> (and the <code>/dashboard</code>,
  <code>/card</code>, <code>/invite</code> slash commands) work in servers and,
  after a user install, in DMs. A member presses **Open Dashboard**, registers
  with email + password - and their account is approved on the spot.

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
| Accounts, cards and photos vanish | they lived on that disk | users type <code>;rpc</code> and register again; a VPS or Oracle Always Free box has a real disk |
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
| <code>;rpc</code> does nothing | enable **Message Content Intent** (section 2.5), check the bot is online in Render **Logs** |
| “Access link invalid or expired” | links live 30 minutes — type <code>;rpc</code> again for a fresh one |
| “Wrong email or password” | the account was registered with a different email; no reset mail yet — after a redeploy the free disk wipes and you can register fresh |
| “That Discord account already has a card here” | one card per Discord account — log in with the email it was registered with |
| Someone is not the admin | put their Discord id in <code>ADMIN_DISCORD_IDS</code> and redeploy |
| No welcome message when the bot joins | the channel blocks bot messages, or the bot token / <code>PUBLIC_URL</code> is missing |
| Slash commands do not answer | give it a minute after the bot comes online, or re-invite with <code>applications.commands</code> |
| Activity missing from the App Launcher | user-install the app (“Add to my apps” via <code>/invite</code>); Activities enabled (section 2.6) |
| Activity opens a blank frame | URL mapping needs the trailing slash: <code>/activity/</code> |
| The Activity says “No account here yet” | that user has not registered on the website yet — <code>;rpc</code>, register, reopen the app |
| Photos render as a letter | the URL Discord sees is not https or unreachable — check <code>PUBLIC_URL</code> |
| Bot offline after ~15 minutes | keep-alive is off — section 5 |
| Someone else's card on the bot | the bot carries the admin's card only — that is by design (one bot, one card) |

Render redeploys automatically when <code>main</code> changes. Environment
survives; the disk does not.

## 8 · The go-live checklist

Work top to bottom; the section in brackets says where each step lives.

- [ ] Deploy on Render with the env vars from section 1 — done when the boot banner appears in Render **Logs**.
- [ ] Discord application created: Application ID, Client Secret and bot token copied into the env vars (sections 2.1-2.4).
- [ ] **Message Content Intent** on (section 2.5) — without it <code>;rpc</code> stays silent.
- [ ] **Activities** enabled, URL mapping <code>/</code> → <code>https://NAME.onrender.com/activity/</code>, trailing slash included (sections 2.6-2.7).
- [ ] **Installation**: User Install + Guild Install, Discord Provided Link, default install scopes (sections 2.8-2.9).
- [ ] Bot added to your server via the Install Link or <code>/invite</code> (section 2.10) — it posts the welcome card.
- [ ] Type <code>;rpc</code> → press **Open Dashboard** → create your account with email + password (section 3).
- [ ] Voice channel → **App Launcher** → StatusC0rd — your card live on your profile (section 4).
- [ ] Keep-alive on, 10-minute interval (section 5).
