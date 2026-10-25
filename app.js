"use strict";

const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cookieSession = require("cookie-session");

const { createRenderer, escapeHtml } = require("./src/views");
const { sanitizePresence, buildActivity, ACTIVITY_TYPES, DEFAULT_CONFIG } = require("./src/presence");
const {
  safeEqual,
  randomToken,
  RateLimiter,
  LoginLimiter,
  clientKey,
  ensureCsrf,
  requireCsrf,
  publicUser
} = require("./src/auth");
const oauth = require("./src/oauth");
const { createZip } = require("./src/zip");
const { loadGuide, guideNav, findDoc } = require("./src/guide");
const { createActivityService, ActivityError, FRAME_ANCESTORS } = require("./src/activity");
const { templateList, applyTemplate } = require("./src/templates");


/** Personalized double-click launchers for people who never open a terminal. */
function launcherScript({ platform, server, token, label }) {
  const scriptUrl = `${server}/companion.js?pair=${token}`;
  const safeLabel = String(label || "this computer").replace(/["&<>|^]/g, "");
  if (platform === "windows") {
    return [
      "@echo off",
      `title StatusC0rd companion - ${safeLabel}`,
      "setlocal",
      "where node >nul 2>nul",
      "if errorlevel 1 (",
      "  echo Node.js is required. Install the LTS version from https://nodejs.org and run this file again.",
      "  pause",
      "  exit /b 1",
      ")",
      "set \"TARGET=%TEMP%\\statusc0rd-companion.js\"",
      `powershell -NoProfile -Command "iwr -UseBasicParsing '${scriptUrl}' -OutFile '%TARGET%'"`,
      "if errorlevel 1 (",
      "  echo Could not download the companion. Check your connection and that the dashboard URL is reachable.",
      "  pause",
      "  exit /b 1",
      ")",
      "node \"%TARGET%\"",
      "echo.",
      "echo The companion stopped. Closing in 10 seconds...",
      "timeout /t 10 >nul",
      "endlocal",
      ""
    ].join("\r\n");
  }
  return [
    "#!/bin/bash",
    `# StatusC0rd companion launcher for ${safeLabel}`,
    `# Keep this file private - it contains this computer's pairing token.`,
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "Node.js is required. Install the LTS version from https://nodejs.org"',
    '  echo "then run this file again."',
    '  read -r -p "Press Enter to close..." _',
    "  exit 1",
    "fi",
    'TARGET="${TMPDIR:-/tmp}/statusc0rd-companion.js"',
    `if ! curl -fsSL "${scriptUrl}" -o "$TARGET"; then`,
    '  echo "Could not download the companion. Check your connection and the dashboard URL."',
    '  read -r -p "Press Enter to close..." _',
    "  exit 1",
    "fi",
    'exec node "$TARGET"',
    ""
  ].join("\n");
}

const MAC_ZIP_README = [
  "StatusC0rd companion for macOS",
  "",
  "1. Unzip this archive if it did not unzip itself (double-click it).",
  '2. Double-click "StatusC0rd.command". A Terminal window opens and stays open;',
  "   that window keeps your profile updated while it runs.",
  "3. If macOS blocks the first launch, right-click the file and choose Open.",
  "",
  "Node.js 20 or newer is required (https://nodejs.org).",
  "",
  "Keep this folder private: StatusC0rd.command contains a pairing token for",
  "this computer. If it leaks, remove the device in the StatusC0rd dashboard and",
  "download a new launcher.",
  "",
  "Prefer a terminal? curl -fsSL \"<your dashboard>/companion.js?pair=<token>\" | node",
  ""
].join("\r\n");

const VIEWS_DIR = path.join(__dirname, "views");
const PUBLIC_DIR = path.join(__dirname, "public");
const AGENT_PATH = path.join(__dirname, "src", "companion", "agent.js");
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SETUP_GRANT_TTL_MS = 30 * 60 * 1000;
const MIN_KEY_LENGTH = 12;

function isLoopback(req) {
  const address = req.socket?.remoteAddress || "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "::ffff:::1"
  );
}

/** Absolute origin of the current request, used for asset URLs. */
/**
 * Proxy handling. Trusting every hop (Express' `true`) lets any direct client
 * forge `X-Forwarded-For` to dodge the login rate limiter and `X-Forwarded-Proto`
 * to downgrade the URLs we hand to Discord. Instead we trust only private and
 * loopback hops, which is what Render/Fly/nginx-on-localhost look like.
 *
 * Override with TRUST_PROXY: `false`, a hop count (`1`), or a proxy-addr list.
 */
function trustProxySetting() {
  const raw = (process.env.TRUST_PROXY || "").trim();
  if (!raw) return "loopback, linklocal, uniquelocal";
  if (/^(false|no|off|0)$/i.test(raw)) return false;
  if (/^(true|yes|on)$/i.test(raw)) return "loopback, linklocal, uniquelocal";
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

function originOf(req) {
  return `${req.protocol}://${req.get("host")}`;
}

/**
 * Build the Express application.
 *
 * @param {object} options
 * @param {import('./src/settings').SettingsStore} options.settings
 * @param {import('./src/assets').AssetStore} options.assets
 * @param {import('./src/bot').DiscordBot} options.bot
 * @param {import('./src/keepalive').KeepAlive} [options.keepAlive]
 * @param {Console} [options.logger]
 * @param {() => number} [options.now]
 */
function createApp({
  settings,
  assets,
  bot,
  keepAlive = null,
  logger = console,
  now = Date.now,
  version = require("./package.json").version,
  isProduction = process.env.NODE_ENV === "production"
}) {
  if (!settings) throw new Error("createApp requires a settings store");
  if (!assets) throw new Error("createApp requires an asset store");
  if (!bot) throw new Error("createApp requires a bot instance");

  const render = createRenderer(VIEWS_DIR, { cache: false });
  const app = express();
  const startedAt = now();

  const loginLimiter = new LoginLimiter();
  const writeLimiter = new RateLimiter({ windowMs: 60_000, max: 60 });
  const setupLimiter = new RateLimiter({ windowMs: 5 * 60_000, max: 20 });
  const companionLimiter = new RateLimiter({ windowMs: 60_000, max: 120, now });
  const activityLimiter = new RateLimiter({ windowMs: 60_000, max: 180, now });
  const activityService = createActivityService({ settings, assets, logger, now });

  const streams = new Set();

  app.disable("x-powered-by");
  app.set("trust proxy", trustProxySetting());

  // ------------------------------------------------------------ middleware

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    if (isProduction && req.secure) {
      // Only meaningful (and only harmless) on a real HTTPS deployment.
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    // An Activity is embedded by the Discord client, so that page alone has to
    // allow Discord as its frame ancestor; COOP would also fight the iframe.
    const isActivity = req.path === "/activity" || req.path.startsWith("/activity/");
    if (!isActivity) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    }
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self'",
        "connect-src 'self'",
        "form-action 'self'",
        // Production blocks framing (clickjacking); development allows it so the
        // dashboard can be embedded in a hosted live-preview iframe.
        `frame-ancestors ${isActivity ? FRAME_ANCESTORS : isProduction ? "'self'" : "*"}`
      ].join("; ")
    );
    next();
  });

  // `/activity` is a directory on disk, so serve the canonical slash form here:
  // express.static would answer with its own redirect, and the Activity's
  // relative URLs (and Discord's proxy mapping) need the trailing slash.
  // Express 5's non-strict routing matches `/activity/` here as well, so hand
  // the slash form on instead of redirecting it to itself.
  app.get("/activity", (req, res, next) => {
    if (req.path === "/activity/") return next();
    return res.redirect(302, "/activity/");
  });

  // These file names are not content-hashed, so a long max-age would pair new
  // HTML with a stale `/app.js` after a redeploy. Revalidate instead: the ETag
  // makes it a 304, and only the hashed `/assets/<id>` files are immutable.
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      etag: true,
      maxAge: 0,
      setHeaders(res) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    })
  );

  app.get("/favicon.ico", (req, res) => res.redirect(302, "/favicon.svg"));

  // Uploaded artwork is intentionally public: Discord's image proxy fetches it.
  app.get("/assets/:file", (req, res) => {
    const match = /^([a-f0-9]{6,32})\.(png|jpg|jpeg|webp|gif)$/.exec(req.params.file);
    if (!match) return res.status(404).type("text").send("Not found");
    const asset = settings.findAsset(match[1]);
    if (!asset || asset.ext !== match[2].replace("jpeg", "jpg")) {
      return res.status(404).type("text").send("Not found");
    }
    const file = assets.filePath(asset);
    if (!fs.existsSync(file)) return res.status(404).type("text").send("Not found");
    res.setHeader("Content-Type", asset.mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // Discord fetches these from another origin, so CORP must allow it.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.sendFile(file);
  });

  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));

  app.use(
    cookieSession({
      name: "statusc0rd.sid",
      keys: [settings.sessionSecret()],
      maxAge: SESSION_MAX_AGE_MS,
      httpOnly: true,
      sameSite: "lax",
      overwrite: true
    })
  );

  // Mark the session cookie Secure as soon as the request arrived over HTTPS,
  // while keeping plain http://localhost (the default install) working.
  app.use((req, res, next) => {
    if (req.session && req.secure) req.sessionOptions.secure = true;
    next();
  });

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/login" || req.path === "/setup" || req.path === "/") {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  // --------------------------------------------------------------- helpers

  /** Public origin used for image URLs: configured URL first, request origin otherwise. */
  function publicOrigin(req) {
    return settings.effective().publicUrl || originOf(req);
  }

  /** Public card details, or null when sharing is off. */
  function shareInfo(req) {
    const share = settings.get().share;
    if (!share?.slug) return null;
    return {
      slug: share.slug,
      url: `${publicOrigin(req)}/c/${share.slug}`,
      createdAt: share.createdAt || null
    };
  }

  function snapshotFor(req) {
    const presence = settings.get().presence || DEFAULT_CONFIG;
    const origin = publicOrigin(req);
    const resolveAsset = (id) => {
      const asset = settings.findAsset(id);
      return asset ? assets.url(asset, origin) : "";
    };
    return {
      presence,
      activity: buildActivity(presence, { target: "companion", publicUrl: origin, resolveAsset }),
      botActivity: buildActivity(presence, { target: "bot", publicUrl: origin, resolveAsset }),
      bot: bot.getState(),
      assets: settings.listAssets().map((asset) => ({
        ...asset,
        url: assets.url(asset, origin)
      })),
      draft: settings.get().draft || null,
      share: shareInfo(req),
      templates: templateList(),
      pairings: settings.listPairings(),
      keepAlive: keepAlive ? keepAlive.getState() : null,
      activitySession: activityService.snapshot(),
      meta: {
        version,
        setupComplete: !settings.needsSetup(),
        clientId: settings.effective().clientId,
        hasClientSecret: Boolean(settings.effective().clientSecret),
        activityReady: activityService.ready(),
        botEnabled: settings.effective().botEnabled,
        discordLoginEnabled: settings.effective().discordLoginEnabled,
        publicUrl: settings.effective().publicUrl || origin,
        publicUrlIsHttps: (settings.effective().publicUrl || origin).startsWith("https://"),
        startedAt: new Date(startedAt).toISOString(),
        needsSetupToken: Boolean(settings.setupToken)
      }
    };
  }

  function broadcastState() {
    if (streams.size === 0) return;
    for (const res of streams) {
      try {
        const payload = `event: state\ndata: ${JSON.stringify({ type: "state", data: snapshotFor(res.req) })}\n\n`;
        res.write(payload);
      } catch {
        streams.delete(res);
      }
    }
  }

  const onBotState = () => broadcastState();
  bot.on("state", onBotState);

  function resetSession(req, data) {
    for (const key of Object.keys(req.session)) delete req.session[key];
    Object.assign(req.session, data);
  }

  function requireAuth(req, res, next) {
    if (req.session?.user) return next();
    if (settings.needsSetup()) return res.redirect(302, "/setup");
    return res.redirect(302, "/login");
  }

  function requireAuthApi(req, res, next) {
    if (req.session?.user) return next();
    return res.status(401).json({ ok: false, error: "Not signed in." });
  }

  /**
   * Setup endpoints are reachable while the instance is not configured.
   * A signed-in admin, a valid setup token, or a loopback connection may use
   * them - so a public deployment cannot be hijacked by a stranger.
   */
  function requireSetupAccess(req, res, next) {
    if (req.session?.user?.role === "admin") return next();
    if (!settings.needsSetup()) {
      return res.status(403).json({ ok: false, error: "Setup is already complete. Sign in to the dashboard." });
    }
    const token = req.get("x-setup-token") || req.body?.setupToken || req.query?.setupToken;
    if (token && settings.verifySetupToken(token)) {
      req.session.setupGrantedAt = now();
      return next();
    }
    if (req.session?.setupGrantedAt && now() - Number(req.session.setupGrantedAt) < SETUP_GRANT_TTL_MS) {
      return next();
    }
    if (isLoopback(req) && !process.env.SETUP_REQUIRE_TOKEN) return next();
    return res.status(403).json({
      ok: false,
      error: "Setup is locked. Enter the setup token from the server logs (data/setup-token.txt).",
      needsToken: true
    });
  }

  function sendErrorPage(res, status, title, detail) {
    res.status(status).type("html").send(render("error.html", { TITLE: title, STATUS: status, DETAIL: detail }));
  }

  function applyPresenceToBot() {
    const presence = settings.get().presence || DEFAULT_CONFIG;
    if (presence.enabled && presence.targets?.bot !== false) bot.setPresence(presence);
    else bot.clearPresence(presence.status || "online");
  }

  // ----------------------------------------------------------------- public

  /**
   * Health check. The public response says only whether the instance is up -
   * versions, storage paths, setup state and bot status are operational detail
   * and belong behind the session (`/api/health`).
   */
  app.get("/health", (req, res) => {
    const storageOk = settings.checkWritable();
    res.status(storageOk ? 200 : 503).json({
      status: storageOk ? "ok" : "degraded",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date(now()).toISOString()
    });
  });

  /** Full operational picture for the operator. */
  app.get("/api/health", requireAuthApi, (req, res) => {
    const storageOk = settings.checkWritable();
    res.setHeader("Cache-Control", "no-store");
    res.status(storageOk ? 200 : 503).json({
      status: storageOk ? "ok" : "degraded",
      version,
      uptimeSeconds: Math.floor(process.uptime()),
      storage: storageOk ? "ok" : "unwritable",
      setup: settings.needsSetup() ? "required" : "complete",
      bot: bot.getState().status,
      keepAlive: keepAlive ? keepAlive.getState() : null,
      activity: activityService.snapshot()
    });
  });

  // ------------------------------------------------------------- share card
  // An opt-in, read-only rendering of the presence for posting elsewhere. The
  // slug is random and can be rotated or switched off at any time.

  app.post("/api/share", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const presence = settings.get().presence;
    if (!presence?.enabled || !presence.name) {
      return res.status(400).json({ ok: false, error: "Apply a presence first - there is nothing to share." });
    }

    const requested = String(req.body?.slug || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const slug = requested || randomToken(5);
    if (!/^[a-z0-9]{6,32}$/.test(slug)) {
      return res.status(400).json({ ok: false, error: "A share link needs 6-32 letters and numbers." });
    }

    const existing = settings.get().share;
    settings.update({
      share: {
        slug,
        createdAt: existing?.createdAt && existing.slug === slug ? existing.createdAt : new Date(now()).toISOString()
      }
    });
    broadcastState();
    res.json({ ok: true, share: shareInfo(req) });
  });

  app.delete("/api/share", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    settings.update({ share: null });
    broadcastState();
    res.json({ ok: true, share: null });
  });

  /**
   * The public card. No session, no JS: a crawler or a phone camera gets the
   * whole thing from the HTML, including the Open Graph tags.
   */
  app.get("/c/:slug", (req, res) => {
    const share = settings.get().share;
    if (!share?.slug || share.slug !== req.params.slug) {
      return sendErrorPage(res, 404, "Card not found", "This card does not exist or its owner turned sharing off.");
    }

    const presence = settings.get().presence || DEFAULT_CONFIG;
    if (!presence.enabled || !presence.name) {
      return sendErrorPage(res, 404, "Card not found", "This card is not being shared right now.");
    }

    const origin = publicOrigin(req);
    const resolveAsset = (id) => {
      const asset = settings.findAsset(id);
      return asset ? assets.url(asset, origin) : "";
    };
    const activity = buildActivity(presence, { target: "companion", publicUrl: origin, resolveAsset });
    const large = activity?.assets?.large_image || "";
    const buttons = (activity?.buttons || [])
      .map((label, index) => {
        const url = activity?.metadata?.button_urls?.[index];
        if (!url) return "";
        return `<a class="card-btn" href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`;
      })
      .join("");
    const lines = [presence.details, presence.state].filter(Boolean).join(" · ");
    // Social tags are assembled here: an empty og:image would be worse than none.
    const imageTags = large
      ? `<meta property="og:image" content="${escapeHtml(large)}" />\n    ` +
        `<meta property="og:image:alt" content="${escapeHtml(presence.largeText || presence.name)}" />\n    ` +
        `<meta name="twitter:image" content="${escapeHtml(large)}" />`
      : "";
    const artHtml = large
      ? `<img src="${escapeHtml(large)}" alt="" />`
      : `<span class="discord-art-fallback" aria-hidden="true">S</span>`;

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "all");
    res.type("html").send(
      render("card.html", {
        VERSION: version,
        CARD_NAME: presence.name,
        CARD_TYPE: String(ACTIVITY_TYPES[Number(presence.type)] || "Playing").toUpperCase(),
        CARD_DETAILS: presence.details || "",
        CARD_STATE: presence.state || "",
        CARD_DESCRIPTION: lines || "A custom Discord rich presence, built in the browser.",
        CARD_URL: `${origin}/c/${share.slug}`,
        CARD_ART_HTML: artHtml,
        OG_IMAGE_TAGS: imageTags,
        TWITTER_CARD: large ? "summary_large_image" : "summary",
        BUTTONS_HTML: buttons
      })
    );
  });

  // -------------------------------------------------------------- public site

  /** Where the "main" call to action should take the visitor. */
  function primaryAction(req) {
    if (req.session?.user) return { href: "/", label: "Open dashboard" };
    if (settings.needsSetup()) return { href: "/setup", label: "Start setup" };
    return { href: "/login", label: "Sign in" };
  }

  app.get("/welcome", (req, res) => {
    const action = primaryAction(req);
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(
      render("welcome.html", {
        VERSION: version,
        PRIMARY_HREF: action.href,
        PRIMARY_LABEL: action.label
      })
    );
  });

  /**
   * The setup documentation, rendered from `docs/*.md` so the website and the
   * repository can never disagree. One page per deployment path:
   * `/guide` (shared steps), `/guide/local`, `/guide/cloud`, `/guide/free-cloud`.
   */
  function sendGuide(req, res, doc) {
    const guide = loadGuide(doc.slug);
    const action = primaryAction(req);
    const toc = guide.headings
      .filter((heading) => heading.level === 2)
      .map((heading) => `<a href="#${heading.id}">${escapeHtml(heading.text)}</a>`)
      .join("");
    const nav = guideNav(doc.slug)
      .map((item) =>
        item.active
          ? `<a class="guide-tab is-active" href="${item.href}" aria-current="page">${escapeHtml(item.label)}</a>`
          : `<a class="guide-tab" href="${item.href}">${escapeHtml(item.label)}</a>`
      )
      .join("");
    const updated = guide.updatedAt
      ? `Last updated ${new Date(guide.updatedAt).toISOString().slice(0, 10)}`
      : "";
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("html").send(
      render("guide.html", {
        VERSION: version,
        GUIDE_TITLE: guide.title,
        GUIDE_HTML: guide.html,
        GUIDE_NAV: nav,
        GUIDE_FILE: `docs/${guide.file}`,
        TOC_HTML: toc,
        GUIDE_UPDATED: updated,
        BACK_HREF: action.href,
        BACK_LABEL: action.label
      })
    );
  }

  app.get("/guide", (req, res) => sendGuide(req, res, findDoc("")));

  app.get("/guide/:slug", (req, res) => {
    const doc = findDoc(req.params.slug);
    if (!doc) {
      return sendErrorPage(
        res,
        404,
        "No such guide",
        "That setup document does not exist. Start at /guide to see every path."
      );
    }
    return sendGuide(req, res, doc);
  });

  // ------------------------------------------------------------------- setup

  app.get("/setup", (req, res) => {
    if (!settings.needsSetup()) {
      return req.session?.user ? res.redirect(302, "/") : res.redirect(302, "/login");
    }
    const effective = settings.effective();
    const needsToken = !isLoopback(req) || Boolean(process.env.SETUP_REQUIRE_TOKEN);
    res.type("html").send(
      render("setup.html", {
        CSRF: ensureCsrf(req),
        VERSION: version,
        CLIENT_ID: effective.clientId,
        NEEDS_TOKEN: needsToken ? "true" : "false",
        BOT_MANAGED: effective.managed.botToken ? "true" : "false"
      })
    );
  });

  app.get("/api/setup/status", (req, res) => {
    const effective = settings.effective();
    res.json({
      ok: true,
      needsSetup: settings.needsSetup(),
      authenticated: Boolean(req.session?.user),
      needsToken: !isLoopback(req) || Boolean(process.env.SETUP_REQUIRE_TOKEN),
      managed: effective.managed,
      defaults: { clientId: effective.clientId, publicUrl: effective.publicUrl || originOf(req) }
    });
  });

  app.post("/api/setup/verify", setupLimiter.middleware(), (req, res) => {
    if (!settings.needsSetup()) return res.status(409).json({ ok: false, error: "Setup is already complete." });
    if (!settings.verifySetupToken(req.body?.token)) {
      logger.warn?.(`[setup] invalid setup token from ${clientKey(req)}`);
      return res.status(403).json({ ok: false, error: "That setup token is not correct." });
    }
    req.session.setupGrantedAt = now();
    res.json({ ok: true });
  });

  app.post("/api/setup/asset", requireSetupAccess, setupLimiter.middleware(), (req, res) => {
    const result = assets.save({ dataUrl: req.body?.dataUrl, name: req.body?.name });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, asset: { ...result.asset, url: assets.url(result.asset, publicOrigin(req)) } });
  });

  app.post("/api/setup/test-bot", requireSetupAccess, setupLimiter.middleware(), async (req, res) => {
    const token = String(req.body?.botToken || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "Enter the bot token first." });
    try {
      const { Client, GatewayIntentBits } = require("discord.js");
      const client = new Client({ intents: [GatewayIntentBits.Guilds] });
      const result = await Promise.race([
        client.login(token).then(() => ({
          tag: client.user?.tag,
          id: client.user?.id,
          username: client.user?.username
        })),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Discord did not answer in time.")), 15_000))
      ]);
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
      return res.json({ ok: true, bot: result });
    } catch (error) {
      const message = /token/i.test(error.message)
        ? "Discord rejected that bot token. Copy it again from Developer Portal → Bot → Reset Token."
        : error.message;
      return res.status(400).json({ ok: false, error: message });
    }
  });

  app.post("/api/setup/complete", requireSetupAccess, setupLimiter.middleware(), async (req, res) => {
    if (!settings.needsSetup() && req.session?.user?.role !== "admin") {
      return res.status(409).json({ ok: false, error: "Setup is already complete." });
    }

    const body = req.body || {};
    const adminKey = String(body.adminKey || "");
    const discord = body.discord && typeof body.discord === "object" ? body.discord : {};

    const publicUrl = String(body.publicUrl || originOf(req)).trim().replace(/\/+$/, "");
    if (publicUrl && !/^https?:\/\/[^\s]+$/i.test(publicUrl)) {
      return res.status(400).json({ ok: false, error: "The public URL must start with https:// or http://." });
    }
    const patch = { publicUrl };
    if (!settings.data.admin.keyHash && !settings.keyFromEnv) {
      if (adminKey.length < MIN_KEY_LENGTH) {
        return res.status(400).json({
          ok: false,
          error: `Choose a dashboard key with at least ${MIN_KEY_LENGTH} characters.`
        });
      }
      settings.setAdminKey(adminKey);
    } else if (adminKey) {
      if (adminKey.length < MIN_KEY_LENGTH) {
        return res.status(400).json({ ok: false, error: `The dashboard key needs at least ${MIN_KEY_LENGTH} characters.` });
      }
      settings.setAdminKey(adminKey);
    }

    const discordPatch = {};
    if (discord.clientId !== undefined && !settings.effective().managed.clientId) {
      const clientId = String(discord.clientId).replace(/[^0-9]/g, "");
      if (clientId && !/^\d{5,25}$/.test(clientId)) {
        return res.status(400).json({ ok: false, error: "The application ID must be a number." });
      }
      if (clientId) discordPatch.clientId = clientId;
    }
    if (discord.botToken !== undefined && !settings.effective().managed.botToken) {
      discordPatch.botToken = String(discord.botToken || "").trim().slice(0, 200);
    }
    if (discord.clientSecret !== undefined && !settings.effective().managed.clientSecret) {
      discordPatch.clientSecret = String(discord.clientSecret || "").trim().slice(0, 200);
    }
    if (Array.isArray(discord.allowedIds) && !settings.effective().managed.allowedDiscordIds) {
      discordPatch.allowedIds = discord.allowedIds
        .map((id) => String(id).replace(/[^0-9]/g, ""))
        .filter((id) => /^\d{5,25}$/.test(id))
        .slice(0, 50);
    }
    if (body.keepAlive !== undefined) {
      patch.keepAlive = {
        enabled: Boolean(body.keepAlive),
        intervalMinutes: Number(body.keepAliveIntervalMinutes) || 10
      };
    }

    settings.update({ ...patch, discord: { ...settings.get().discord, ...discordPatch } });

    if (body.presence && typeof body.presence === "object") {
      const result = sanitizePresence(body.presence, { current: settings.get().presence || DEFAULT_CONFIG, now: now() });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });
      }
      settings.update({ presence: result.value });
    }

    settings.completeSetup();

    const effective = settings.effective();
    await bot.reconfigure({ token: effective.botToken, enabled: effective.botEnabled });
    applyPresenceToBot();
    if (keepAlive) keepAlive.configure(effective.keepAlive.enabled ? { ...effective.keepAlive, publicUrl: effective.publicUrl } : { enabled: false });

    resetSession(req, {
      user: { id: "dashboard", name: "Dashboard", role: "admin", via: "key" },
      csrf: randomToken(24)
    });
    logger.log?.(`[setup] completed (bot: ${effective.hasBotToken ? "configured" : "not configured"})`);
    broadcastState();
    res.json({ ok: true, redirect: "/" });
  });

  // -------------------------------------------------------------------- auth

  app.get("/login", (req, res) => {
    if (settings.needsSetup()) return res.redirect(302, "/setup");
    if (req.session?.user) return res.redirect(302, "/");
    res.type("html").send(
      render("login.html", {
        CSRF: ensureCsrf(req),
        DISCORD_ENABLED: settings.effective().discordLoginEnabled ? "true" : "false",
        KEY_ENABLED: settings.hasAdminKey ? "true" : "false",
        VERSION: version
      })
    );
  });

  app.post("/login", requireCsrf, (req, res) => {
    const key = clientKey(req);
    const limited = loginLimiter.status(key);
    if (limited.blocked) {
      res.setHeader("Retry-After", String(Math.ceil(limited.retryAfterMs / 1000)));
      return res.redirect(303, "/login?error=locked");
    }
    if (!settings.hasAdminKey) return res.redirect(303, "/login?error=key_disabled");
    if (!settings.verifyAdminKey(req.body?.key)) {
      const after = loginLimiter.fail(key);
      logger.warn?.(`[auth] failed dashboard login from ${key}`);
      return res.redirect(303, after.blocked ? "/login?error=locked" : "/login?error=invalid");
    }
    loginLimiter.reset(key);
    resetSession(req, {
      user: { id: "dashboard", name: "Dashboard", role: "admin", via: "key" },
      csrf: randomToken(24)
    });
    logger.log?.(`[auth] dashboard key sign-in from ${key}`);
    res.redirect(303, "/");
  });

  app.post("/logout", requireCsrf, (req, res) => {
    req.session = null;
    res.redirect(303, "/login");
  });

  // ------------------------------------------------------------- discord sso

  function callbackUri(req) {
    const effective = settings.effective();
    if (effective.redirectUri) return effective.redirectUri;
    return `${originOf(req)}/auth/discord/callback`;
  }

  app.get("/auth/discord", (req, res) => {
    const effective = settings.effective();
    if (!effective.discordLoginEnabled) return res.redirect(302, "/login?error=discord_disabled");
    const state = randomToken(24);
    req.session.oauth = { state, at: now() };
    res.redirect(
      302,
      oauth.buildAuthorizeUrl({ clientId: effective.clientId, redirectUri: callbackUri(req), state })
    );
  });

  app.get("/auth/discord/callback", async (req, res) => {
    const pending = req.session?.oauth;
    req.session.oauth = null;
    if (req.query.error) return res.redirect(302, "/login?error=cancelled");
    if (!pending || !req.query.state || !safeEqual(req.query.state, pending.state)) {
      return res.redirect(302, "/login?error=state");
    }
    if (now() - Number(pending.at) > OAUTH_STATE_TTL_MS) return res.redirect(302, "/login?error=expired");
    if (!req.query.code) return res.redirect(302, "/login?error=state");

    const effective = settings.effective();
    let me;
    try {
      const token = await oauth.exchangeCode({
        code: String(req.query.code),
        clientId: effective.clientId,
        clientSecret: effective.clientSecret,
        redirectUri: callbackUri(req)
      });
      me = await oauth.fetchMe(token.access_token);
    } catch (error) {
      logger.error?.(`[auth] Discord sign-in failed: ${error.message}`);
      return res.redirect(302, "/login?error=discord_failed");
    }

    if (!effective.allowedDiscordIds.includes(me.id)) {
      logger.warn?.(`[auth] Discord account ${me.id} is not on the allowlist`);
      return res.redirect(302, "/login?error=not_allowed");
    }

    resetSession(req, {
      user: {
        id: me.id,
        name: me.global_name || me.username || `user ${me.id}`,
        role: "admin",
        via: "discord",
        avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null
      },
      csrf: randomToken(24)
    });
    res.redirect(302, "/");
  });

  // --------------------------------------------------------------- dashboard

  app.get("/", requireAuth, (req, res) => {
    const effective = settings.effective();
    res.type("html").send(
      render("dashboard.html", {
        CSRF: ensureCsrf(req),
        VERSION: version,
        CLIENT_ID: effective.clientId,
        // No application id means no invite link: a `client_id=` with an empty
        // value is a dead page on discord.com, worse than no button at all.
        INVITE_URL: effective.clientId
          ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(effective.clientId)}&scope=bot&permissions=0`
          : ""
      })
    );
  });

  // --------------------------------------------------------------------- api

  app.get("/api/state", requireAuthApi, (req, res) => {
    res.json({ ok: true, user: publicUser(req), csrf: ensureCsrf(req), ...snapshotFor(req) });
  });

  app.get("/api/presence", requireAuthApi, (req, res) => {
    const presence = settings.get().presence || DEFAULT_CONFIG;
    const origin = publicOrigin(req);
    const resolveAsset = (id) => {
      const asset = settings.findAsset(id);
      return asset ? assets.url(asset, origin) : "";
    };
    res.json({
      ok: true,
      presence,
      activity: buildActivity(presence, { target: "companion", publicUrl: origin, resolveAsset }),
      botActivity: buildActivity(presence, { target: "bot", publicUrl: origin, resolveAsset })
    });
  });

  app.post("/api/presence", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const result = sanitizePresence(req.body, { current: settings.get().presence || DEFAULT_CONFIG, now: now() });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });

    settings.update({ presence: result.value, draft: null });
    applyPresenceToBot();
    broadcastState();
    logger.log?.(`[presence] "${result.value.name}" -> ${result.value.targets.bot ? "bot" : ""}${result.value.targets.bot && result.value.targets.companion ? "+" : ""}${result.value.targets.companion ? "profile" : ""}`);
    res.json({ ok: true, presence: result.value, bot: bot.getState() });
  });

  /**
   * Draft endpoints: the editor stages changes here without touching what
   * Discord is showing. `POST /api/presence` still means "save and apply now",
   * so anything scripted against the old API keeps working.
   */
  app.post("/api/presence/draft", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const current = settings.get().presence || DEFAULT_CONFIG;
    const result = sanitizePresence(req.body, { current, now: now() });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });

    const draft = { ...result.value, savedAt: new Date(now()).toISOString() };
    settings.update({ draft });
    res.json({ ok: true, draft });
  });

  app.post("/api/presence/publish", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const stored = settings.get();
    const source = req.body && Object.keys(req.body).length > 0 ? req.body : stored.draft;
    if (!source) return res.status(400).json({ ok: false, error: "There is nothing staged to publish." });

    const result = sanitizePresence(source, { current: stored.presence || DEFAULT_CONFIG, now: now() });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });

    settings.update({ presence: result.value, draft: null });
    applyPresenceToBot();
    broadcastState();
    logger.log?.(`[presence] published "${result.value.name}"`);
    res.json({ ok: true, presence: result.value, bot: bot.getState() });
  });

  app.delete("/api/presence/draft", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    settings.update({ draft: null });
    broadcastState();
    res.json({ ok: true, draft: null });
  });

  /** A template, merged into the current config and validated the same way. */
  app.post("/api/templates/:id", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const current = settings.get().draft || settings.get().presence || DEFAULT_CONFIG;
    const merged = applyTemplate(req.params.id, current);
    if (!merged) return res.status(404).json({ ok: false, error: "Unknown template." });

    const result = sanitizePresence(merged, { current, now: now() });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });
    res.json({ ok: true, presence: result.value });
  });

  app.post("/api/presence/clear", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const current = settings.get().presence || DEFAULT_CONFIG;
    const next = { ...current, enabled: false, updatedAt: new Date(now()).toISOString() };
    settings.update({ presence: next, draft: null });
    applyPresenceToBot();
    broadcastState();
    res.json({ ok: true, presence: next, bot: bot.getState() });
  });

  app.get("/api/events", requireAuthApi, (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(": connected\n\n");
    res.write(`event: state\ndata: ${JSON.stringify({ type: "state", data: snapshotFor(req) })}\n\n`);
    streams.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        streams.delete(res);
      }
    }, 25_000);
    heartbeat.unref?.();
    req.on("close", () => {
      clearInterval(heartbeat);
      streams.delete(res);
    });
  });

  // ------------------------------------------------------------------ assets

  app.get("/api/assets", requireAuthApi, (req, res) => {
    const origin = publicOrigin(req);
    res.json({
      ok: true,
      assets: settings.listAssets().map((asset) => ({ ...asset, url: assets.url(asset, origin) }))
    });
  });

  app.post("/api/assets", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const result = assets.save({ dataUrl: req.body?.dataUrl, name: req.body?.name });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    broadcastState();
    res.json({ ok: true, asset: { ...result.asset, url: assets.url(result.asset, publicOrigin(req)) } });
  });

  app.delete("/api/assets/:id", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const id = String(req.params.id || "");
    if (!settings.findAsset(id)) return res.status(404).json({ ok: false, error: "Image not found." });
    assets.remove(id);
    broadcastState();
    res.json({ ok: true });
  });

  // --------------------------------------------------------------- settings

  app.get("/api/settings", requireAuthApi, (req, res) => {
    const effective = settings.effective();
    const stored = settings.get();
    res.json({
      ok: true,
      settings: {
        publicUrl: effective.publicUrl || originOf(req),
        keepAlive: effective.keepAlive,
        discord: {
          clientId: effective.clientId,
          hasBotToken: Boolean(effective.botToken),
          botTokenPreview: effective.botToken ? `${effective.botToken.slice(0, 6)}…${effective.botToken.slice(-4)}` : "",
          hasClientSecret: effective.hasClientSecret,
          allowedIds: effective.allowedDiscordIds,
          redirectUri: effective.redirectUri
        },
        managed: effective.managed,
        keyFromEnv: settings.keyFromEnv,
        pairings: settings.listPairings(),
        updatedAt: stored.updatedAt
      }
    });
  });

  app.post("/api/settings", requireAuthApi, requireCsrf, writeLimiter.middleware(), async (req, res) => {
    const body = req.body || {};
    const effective = settings.effective();
    const patch = {};
    const discord = {};

    if (body.publicUrl !== undefined && !effective.managed.publicUrl) {
      const value = String(body.publicUrl || "").trim().replace(/\/+$/, "");
      if (value && !/^https?:\/\/[^\s]+$/.test(value)) {
        return res.status(400).json({ ok: false, error: "The public URL must start with https:// or http://." });
      }
      patch.publicUrl = value;
    }

    if (body.keepAlive !== undefined) {
      patch.keepAlive = {
        enabled: Boolean(body.keepAlive.enabled),
        intervalMinutes: Math.max(5, Math.min(60, Number(body.keepAlive.intervalMinutes) || 10))
      };
    }

    if (body.botToken !== undefined && !effective.managed.botToken) {
      discord.botToken = String(body.botToken || "").trim();
    }
    if (body.clientId !== undefined && !effective.managed.clientId) {
      const clientId = String(body.clientId).replace(/[^0-9]/g, "");
      if (clientId && !/^\d{5,25}$/.test(clientId)) {
        return res.status(400).json({ ok: false, error: "The application ID must be a number." });
      }
      if (clientId) discord.clientId = clientId;
    }
    if (body.clientSecret !== undefined && !effective.managed.clientSecret) {
      discord.clientSecret = String(body.clientSecret || "").trim();
    }
    if (Array.isArray(body.allowedIds) && !effective.managed.allowedDiscordIds) {
      discord.allowedIds = body.allowedIds
        .map((id) => String(id).replace(/[^0-9]/g, ""))
        .filter((id) => /^\d{5,25}$/.test(id))
        .slice(0, 50);
    }

    if (body.newAdminKey) {
      if (String(body.newAdminKey).length < MIN_KEY_LENGTH) {
        return res.status(400).json({ ok: false, error: `The dashboard key needs at least ${MIN_KEY_LENGTH} characters.` });
      }
      if (!settings.verifyAdminKey(body.currentAdminKey)) {
        return res.status(403).json({ ok: false, error: "Your current dashboard key is not correct." });
      }
      settings.setAdminKey(body.newAdminKey);
      logger.log?.("[settings] dashboard key rotated");
    }

    if (Object.keys(discord).length > 0) {
      settings.update({ discord: { ...settings.get().discord, ...discord } });
    }
    if (Object.keys(patch).length > 0) settings.update(patch);

    const next = settings.effective();
    if (body.botToken !== undefined) {
      await bot.reconfigure({ token: next.botToken, enabled: next.botEnabled });
      applyPresenceToBot();
    }
    if (keepAlive) {
      keepAlive.configure({ ...next.keepAlive, publicUrl: next.publicUrl });
    }

    broadcastState();
    res.json({ ok: true });
  });

  // -------------------------------------------------------------- companion

  app.get("/api/companion/pairings", requireAuthApi, (req, res) => {
    res.json({ ok: true, pairings: settings.listPairings() });
  });

  app.post("/api/companion/pairings", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const existing = settings.listPairings().filter((pairing) => !pairing.revokedAt);
    if (existing.length >= 10) {
      return res.status(400).json({ ok: false, error: "You already have 10 paired devices. Remove one first." });
    }
    const { pairing, token } = settings.createPairing(req.body?.label);
    const origin = settings.effective().publicUrl || originOf(req);
    const command = `curl -fsSL "${origin}/companion.js?pair=${token}" | node`;
    broadcastState();
    res.json({
      ok: true,
      pairing,
      token,
      command,
      scriptUrl: `${origin}/companion.js?pair=${token}`,
      launchers: {
        mac: `${origin}/companion/start-mac.zip?pair=${token}`,
        linux: `${origin}/companion/start.sh?pair=${token}`,
        windows: `${origin}/companion/start.bat?pair=${token}`
      }
    });
  });

  app.delete("/api/companion/pairings/:id", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    settings.revokePairing(String(req.params.id || ""));
    broadcastState();
    res.json({ ok: true });
  });

  /** Personalized companion script: `curl ... | node`, no install step. */
  app.get("/companion.js", companionLimiter.middleware(), (req, res) => {
    const pairing = settings.findPairingByToken(String(req.query.pair || ""));
    if (!pairing) {
      return res
        .status(404)
        .type("text/plain")
        .send("This pairing link is invalid or was revoked. Create a new one in the StatusC0rd dashboard.");
    }
    const effective = settings.effective();
    const config = {
      server: effective.publicUrl || originOf(req),
      token: String(req.query.pair),
      appId: effective.clientId,
      label: pairing.label
    };
    const prelude = `#!/usr/bin/env node\n// StatusC0rd companion - generated for "${pairing.label}". Keep this file private: it contains a pairing token.\nglobalThis.__STATUSC0RD__ = Object.freeze(${JSON.stringify(config)});\n`;
    const source = fs
      .readFileSync(AGENT_PATH, "utf8")
      .replace(/^#!.*\n/, "")
      .replace(/^"use strict";\n\n?/, "");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="statusc0rd-companion.js"`);
    res.type("text/plain").send(prelude + source);
  });

  /**
   * macOS download: a zip so Archive Utility restores the 0755 mode. A bare
   * `.command` download loses its execute bit and cannot be double-clicked.
   */
  app.get("/companion/start-mac.zip", companionLimiter.middleware(), (req, res) => {
    const pairing = settings.findPairingByToken(String(req.query.pair || ""));
    if (!pairing) {
      return res
        .status(404)
        .type("text")
        .send("This pairing link is invalid or was revoked. Create a new one in the StatusC0rd dashboard.");
    }
    const origin = settings.effective().publicUrl || originOf(req);
    const script = launcherScript({ platform: "mac", server: origin, token: String(req.query.pair), label: pairing.label });
    const zip = createZip([
      { name: "StatusC0rd.command", data: script, mode: 0o755 },
      { name: "READ ME FIRST.txt", data: MAC_ZIP_README, mode: 0o644 }
    ]);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="StatusC0rd-mac.zip"');
    res.setHeader("Cache-Control", "no-store");
    res.send(zip);
  });

  /** Double-click launchers (.command / .sh / .bat) built per pairing. */
  app.get("/companion/start.:ext", companionLimiter.middleware(), (req, res) => {
    const pairing = settings.findPairingByToken(String(req.query.pair || ""));
    if (!pairing) {
      return res
        .status(404)
        .type("text")
        .send("This pairing link is invalid or was revoked. Create a new one in the StatusC0rd dashboard.");
    }
    const platform = req.params.ext === "bat" ? "windows" : req.params.ext === "command" ? "mac" : "linux";
    const origin = settings.effective().publicUrl || originOf(req);
    const body = launcherScript({ platform, server: origin, token: String(req.query.pair), label: pairing.label });
    const filename = platform === "windows" ? "StatusC0rd.bat" : platform === "mac" ? "StatusC0rd.command" : "statusc0rd.sh";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  });

  app.get("/api/companion/config", companionLimiter.middleware(), (req, res) => {
    const pairing = settings.findPairingByToken(req.get("authorization")?.replace(/^Bearer\s+/i, "") || req.query.token);
    if (!pairing) return res.status(401).json({ ok: false, error: "Not paired." });

    const presence = settings.get().presence || DEFAULT_CONFIG;
    const origin = settings.effective().publicUrl || originOf(req);
    const resolveAsset = (id) => {
      const asset = settings.findAsset(id);
      return asset ? assets.url(asset, origin) : "";
    };
    const activity = buildActivity(presence, { target: "companion", publicUrl: origin, resolveAsset });
    const body = {
      ok: true,
      label: pairing.label,
      appId: settings.effective().clientId,
      activity,
      updatedAt: presence.updatedAt,
      status: presence.enabled && activity ? "active" : "cleared"
    };
    // Cheap conditional requests keep the 5s poll light.
    const etag = `"${Buffer.from(`${presence.updatedAt || ""}:${body.status}:${origin}`).toString("base64url")}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-store");
    if (req.get("if-none-match") === etag) return res.status(304).end();
    res.json(body);
  });

  app.post("/api/companion/heartbeat", companionLimiter.middleware(), (req, res) => {
    const pairing = settings.findPairingByToken(req.get("authorization")?.replace(/^Bearer\s+/i, "") || req.body?.token);
    if (!pairing) return res.status(401).json({ ok: false, error: "Not paired." });
    settings.touchPairing(pairing.id, req.body?.discordConnected ? "connected" : req.body?.error || "offline");
    broadcastState();
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- discord app
  // The zero-install path: Discord embeds `/activity/` in an iframe and this
  // page pushes the saved presence to the user's own profile. Nothing is
  // downloaded - the browser is already inside Discord.
  //
  // When the Activity is proxied, Discord rewrites `https://<app>.discordsays.com`
  // to the URL mapping target, so the page only ever uses relative URLs. The
  // same endpoints are also mounted at `/api/activity/*` for direct use.

  const activityApi = ["/activity/api", "/api/activity"];

  function activityError(res, error) {
    const status = error instanceof ActivityError ? error.status : error.status || 502;
    if (status >= 500 && !(error instanceof ActivityError)) logger.warn?.("[activity]", error.message);
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).json({ ok: false, error: error.message, code: error.code || null });
  }

  function bearer(req) {
    return String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  }

  app.get("/activity/", activityLimiter.middleware(), (req, res) => {
    const effective = settings.effective();
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(
      render("activity.html", {
        VERSION: version,
        CLIENT_ID: effective.clientId,
        DASHBOARD_URL: effective.publicUrl || originOf(req)
      })
    );
  });

  app.post(activityApi.map((base) => `${base}/token`), activityLimiter.middleware(), async (req, res) => {
    try {
      const { accessToken, expiresIn } = await activityService.exchangeToken(req.body?.code);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, access_token: accessToken, expires_in: expiresIn });
    } catch (error) {
      activityError(res, error);
    }
  });

  app.get(activityApi.map((base) => `${base}/presence`), activityLimiter.middleware(), async (req, res) => {
    try {
      const { changed, ...payload } = await activityService.presence({
        accessToken: bearer(req),
        origin: publicOrigin(req)
      });
      res.setHeader("Cache-Control", "no-store");
      // A 5-second poll must not spam every open dashboard; only a change is news.
      if (changed) broadcastState();
      res.json({ ok: true, ...payload });
    } catch (error) {
      if (activityService.noteError(error.message)) broadcastState();
      activityError(res, error);
    }
  });

  app.get(activityApi.map((base) => `${base}/status`), (req, res) => {
    const session = activityService.snapshot();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      configured: activityService.ready(),
      applicationId: activityService.config().clientId || null,
      session
    });
  });

  // --------------------------------------------------------------- fallbacks

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "Not found." });
    return sendErrorPage(res, 404, "Page not found", "That page does not exist.");
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.status || error.statusCode || 500;
    if (status >= 500) logger.error?.("[http]", error);
    if (res.headersSent) return res.end();
    const message =
      error.type === "entity.parse.failed"
        ? "Request body was not valid JSON."
        : error.type === "entity.too.large"
          ? "That upload is too large."
          : status >= 500
            ? "Something went wrong on the server."
            : error.message;
    if (req.path.startsWith("/api/")) return res.status(status).json({ ok: false, error: message });
    return sendErrorPage(res, status, status === 400 ? "Bad request" : "Server error", message);
  });

  app.locals.closeStreams = () => {
    for (const res of streams) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    streams.clear();
    bot.off("state", onBotState);
  };

  return app;
}

module.exports = { createApp };
