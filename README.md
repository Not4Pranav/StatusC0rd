# StatusC0rd

Multi-user Discord rich presence, the reference workflow in one repo: a
member types <code>;rpc</code>, presses **Open Dashboard**, creates an
account with **email + password** on your site, and builds a rich-presence
card — title, details, photos, buttons and a live timer. An in-Discord
Activity app puts photos and buttons on **each user's own profile**; a
gateway bot keeps a text card online **24/7** and answers <code>;rpc</code>.

**Free to host** — deploy on Render's free plan; no credit card, no
terminal, about 15 minutes. The full walkthrough lives in [SETUP.md](SETUP.md).

[![Deploy to Render](https://render.com/images/deploy-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FNot4Pranav%2FStatusC0rd)

## The approval pipeline

1. A member types **<code>;rpc</code>** in a server (or the bot's DMs).
2. The bot replies with the **Custom RPC Dashboard** card and an
   **Open Dashboard** button.
3. The member lands on the site with a green **Approving Discord account**
   banner and creates the account with **email + password** — registering
   through the link is the whole approval; the Discord account is linked
   on the spot.
4. They build the card in the **RPC Dashboard**.
5. In Discord: join a voice channel → **App Launcher** → **StatusC0rd** —
   their card, with photos, buttons and a live timer, on their own profile.

## Features

- Multi-user: everyone gets their own card, photos and buttons — no codes, no allowlist.
- Public card pages at <code>/card/DISCORD-ID</code>, shareable, off by default.
- A 24/7 bot card for the admin, online the moment the service starts.
- Admin instance panel: application id, client secret, site name, keep-alive.
- Built-in keep-alive to survive the free plan's idle sleep.

## Quick start (free)

1. Render → **New +** → **Blueprint** → pick this repo → **Apply**
   (<code>render.yaml</code> configures Node 22 and a <code>/health</code> check).
2. Set the env vars — <code>CLIENT_ID</code>, <code>CLIENT_SECRET</code>,
   <code>DISCORD_TOKEN</code>, <code>SESSION_SECRET</code>, and optionally
   <code>ADMIN_DISCORD_IDS</code> / <code>SITE_NAME</code>.
3. In the Discord developer portal: enable **Message Content Intent**,
   enable **Activities** with the URL mapping <code>/</code> →
   <code>https://NAME.onrender.com/activity/</code> (keep the trailing
   slash), and set **User Install + Guild Install**.
4. Add the bot, type <code>;rpc</code>, register, go live.

Every step is in [SETUP.md](SETUP.md), with a tickable go-live checklist
(section 8) and a troubleshooting table (section 7).

## Running locally

<code>npm install</code>, copy <code>.env.example</code> to <code>.env</code>,
fill in the values, then <code>npm start</code> — one process serves the
website and the bot. Node 20 or newer.

## Free-plan realities

The Render free plan wipes the disk on restart: accounts, cards and photos
do not survive; env vars are the only thing that does. The keep-alive
(SETUP.md section 5) keeps the bot from dying with the service. For a
permanent setup, run the same repo on any always-on box (Oracle Always
Free, a Raspberry Pi at home) — nothing needs changing, the website and
the bot are one process.
