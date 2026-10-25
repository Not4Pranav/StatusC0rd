"use strict";

const crypto = require("node:crypto");
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
const { createActivityService, ActivityError, FRAME_ANCESTORS } = require("./src/activity");
const {
  ADMIN_USER_ID,
  MIN_KEY_LENGTH,
  MAX_USERS,
  clampKeepAliveInterval
} = require("./src/settings");
const { templateList, applyTemplate } = require("./src/templates");


const VIEWS_DIR = path.join(__dirname, "views");
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SETUP_GRANT_TTL_MS = 30 * 60 * 1000;

function isLoopback(req) {
  const address = req.socket?.remoteAddress || "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "::ffff:::1"
  );
}

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
  isProduction = process.env.NODE_ENV === "production",
  logRequests = process.env.LOG_REQUESTS === undefined
    ? true
    : !["0", "false", "no", "off"].includes(String(process.env.LOG_REQUESTS).toLowerCase())
}) {
  if (!settings) throw new Error("createApp requires a settings store");
  if (!assets) throw new Error("createApp requires an asset store");
  if (!bot) throw new Error("createApp requires a bot instance");

  // Templates never change while the process runs, so a production box caches
  // them; development reads from disk so an edit shows up on reload.
  const render = createRenderer(VIEWS_DIR, { cache: isProduction });
  const app = express();
  const startedAt = now();

  const loginLimiter = new LoginLimiter();
  const writeLimiter = new RateLimiter({ windowMs: 60_000, max: 60 });
  const setupLimiter = new RateLimiter({ windowMs: 5 * 60_000, max: 20 });
  // The Activity polls every 5s (12 requests/minute per person) and its traffic
  // is proxied through Discord, so several members can arrive from one address.
  // A per-dashboard-sized limit would throttle a whole server; this still bounds
  // abuse without doing that.
  const activityLimiter = new RateLimiter({ windowMs: 60_000, max: 600, now });
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

  /**
   * One line per page and API request.
   *
   * On a managed host the log is the *only* debugging surface: "the dashboard was
   * a blank page" is unanswerable without knowing whether `GET /` was served, at
   * which status, and how many bytes went out. Static assets and the SSE stream
   * are skipped (they would drown the log and `EventSource` reconnects on its
   * own), and `LOG_REQUESTS=0` turns the whole thing off.
   */
  function requestLogging(req) {
    if (logRequests === false) return false;
    if (req.path === "/api/events") return false;
    if (req.path.startsWith("/assets/") || req.path === "/favicon.ico") return false;
    return !/\.[a-z0-9]{2,5}$/i.test(req.path);
  }

  app.use((req, res, next) => {
    if (!requestLogging(req)) return next();
    const startedAt = now();
    let done = false;
    const line = (status) => {
      if (done) return;
      done = true;
      const bytes = res.getHeader("Content-Length");
      const size = bytes ? ` ${bytes}b` : "";
      const ms = `${now() - startedAt}ms`;
      logger.log?.(`[http] ${req.method} ${req.originalUrl} ${status}${size} ${ms}`);
    };
    res.on("finish", () => line(res.statusCode));
    // A client that hangs up mid-response is exactly the blank-page case, so it
    // deserves its own line rather than silence.
    res.on("close", () => {
      if (res.writableEnded) return line(res.statusCode);
      done = true;
      const ms = `${now() - startedAt}ms`;
      logger.warn?.(`[http] ${req.method} ${req.originalUrl} aborted by the client after ${ms}`);
    });
    next();
  });

  // --------------------------------------------------------------- helpers

  /** Public origin used for image URLs: configured URL first, request origin otherwise. */
  function publicOrigin(req) {
    return settings.effective().publicUrl || originOf(req);
  }

  /**
   * Who is asking?
   *
   * Two kinds of principal: the dashboard key ("admin") and a member account
   * ("u_…"). Every per-user map is keyed by this id, so the same endpoints serve
   * both without a second code path.
   */
  function ownerId(req) {
    return req.session?.user?.id || null;
  }

  function isAdminSession(req) {
    return req.session?.user?.role === "admin";
  }

  /**
   * The split-hosting worker's own report, if this instance has one.
   *
   * Declared up here because `snapshotFor` reads it; it is filled in by
   * `POST /api/bot/status` further down.
   */
  let botWorker = { connected: false, status: null, tag: null, error: null, lastSeenAt: null, lastActivity: null };

  function snapshotFor(req) {
    const userId = ownerId(req);
    const admin = isAdminSession(req);
    const presence = settings.presenceFor(userId) || DEFAULT_CONFIG;
    const origin = publicOrigin(req);
    const resolveAsset = (id) => {
      if (!settings.ownsAsset(id, userId)) return "";
      const asset = settings.findAsset(id);
      return asset ? assets.url(asset, origin) : "";
    };
    const activitySession = activityService.snapshot();
    // One shared session: only its owner may see who it is or why it failed.
    // Everyone else gets the bare connection state.
    const sessionIsMine = admin || (userId && activitySession.userId === userId);
    const visibleSession = sessionIsMine
      ? activitySession
      : { connected: activitySession.connected, lastSeenAt: activitySession.lastSeenAt, error: null };
    return {
      presence,
      activity: buildActivity(presence, { target: "profile", publicUrl: origin, resolveAsset }),
      // One bot, one card: only the owner's presence can reach it.
      botActivity: admin ? buildActivity(presence, { target: "bot", publicUrl: origin, resolveAsset }) : null,
      bot: bot.getState(),
      assets: settings.listAssets(userId).map((asset) => ({
        ...asset,
        url: assets.url(asset, origin)
      })),
      draft: settings.draftFor(userId),
      templates: templateList(),
      // Keep-alive is an instance concern: members do not need to know whether
      // the owner's uptime ping is on, let alone its target.
      keepAlive: admin && keepAlive ? keepAlive.getState() : null,
      // A worker hosted elsewhere, if this instance uses one.
      botWorker: admin ? botWorker : null,
      activitySession: visibleSession,
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
        card: {
          ...(settings.cardFor(userId) || {}),
          url: `${settings.effective().publicUrl || origin}/c/${settings.cardFor(userId)?.handle || ""}`
        },
        startedAt: new Date(startedAt).toISOString(),
        needsSetupToken: Boolean(settings.setupToken),
        role: req.session?.user?.role || "member",
        isAdmin: admin,
        userId,
        linkedDiscord: Boolean(settings.discordIdForUser(userId)),
        allowSignup: settings.allowSignup,
        memberCount: settings.countUsers()
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

  /**
   * The session on this request, or null when it should no longer be trusted.
   *
   * A dashboard-key session is the instance owner and never goes stale. A member
   * session is only as good as the account behind it: removing the account, or
   * an admin resetting the password, ends every session that came before it.
   */
  function liveUser(req) {
    const user = req.session?.user;
    if (!user) return null;
    if (user.id === ADMIN_USER_ID) return user;
    const row = settings.findUserById(user.id);
    if (!row || row.disabled) return null;
    if (user.pwAt && row.passwordChangedAt && user.pwAt !== row.passwordChangedAt) return null;
    return user;
  }

  function requireAuthApi(req, res, next) {
    if (liveUser(req)) return next();
    if (req.session?.user) req.session = null;
    return res.status(401).json({ ok: false, error: "Not signed in." });
  }

  /**
   * The admin panel - instance configuration, member accounts, keys.
   *
   * Members get their own card and nothing else; the dashboard key (or a member
   * explicitly promoted to `admin`) is what opens this.
   */
  function requireAdmin(req, res, next) {
    if (!liveUser(req)) {
      req.session = null;
      return res.redirect(302, "/login");
    }
    if (isAdminSession(req)) return next();
    return res.status(403).type("html").send(
      render("error.html", {
        TITLE: "Admins only",
        STATUS: 403,
        DETAIL: "That page is the admin panel. Ask the server owner for access."
      })
    );
  }

  function requireAdminApi(req, res, next) {
    if (!liveUser(req)) {
      req.session = null;
      return res.status(401).json({ ok: false, error: "Not signed in." });
    }
    if (isAdminSession(req)) return next();
    return res.status(403).json({ ok: false, error: "That action is for the instance owner." });
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

  /** Only the admin's card reaches the bot; members' cards go to their profile. */
  function applyPresenceToBot() {
    const presence = settings.presenceFor(ADMIN_USER_ID) || DEFAULT_CONFIG;
    const wanted = presence.enabled && presence.targets?.bot !== false;
    bot.setPresence(wanted ? presence : { ...presence, enabled: false });
    if (!wanted) bot.clearPresence(presence.status || "online");
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
      // Present only when the gateway lives in another process (SETUP.md 6.5).
      botWorker: botWorker.lastSeenAt ? botWorker : null,
      activity: activityService.snapshot()
    });
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
    let client = null;
    try {
      const { Client, GatewayIntentBits } = require("discord.js");
      client = new Client({ intents: [GatewayIntentBits.Guilds] });
      const result = await Promise.race([
        client.login(token).then(() => ({
          tag: client.user?.tag,
          id: client.user?.id,
          username: client.user?.username
        })),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Discord did not answer in time.")), 15_000))
      ]);
      return res.json({ ok: true, bot: result });
    } catch (error) {
      const raw = String(error.message || error);
      // Three very different failures must not look alike: a wrong token, a
      // server that cannot reach Discord at all, and Discord being slow.
      const message = /token|unauthorized|401/i.test(raw)
        ? "Discord rejected that bot token. Copy it again from Developer Portal → Bot → Reset Token."
        : /timed? ?out|did not answer/i.test(raw)
          ? "Discord did not answer in time. Check this server's internet access and try again."
          : /socket|ECONN|ENOTFOUND|EAI_AGAIN|network|TLS|certificate/i.test(raw)
            ? "This server could not reach Discord. The token was not checked - fix outbound HTTPS first."
            : raw;
      logger.warn?.(`[setup] bot token test failed: ${raw.slice(0, 120)}`);
      return res.status(400).json({ ok: false, error: message });
    } finally {
      // A timed-out login keeps trying in the background; close it either way.
      try {
        client?.destroy();
      } catch {
        /* ignore */
      }
    }
  });

  app.post("/api/setup/complete", requireSetupAccess, setupLimiter.middleware(), async (req, res) => {
    // One-time by design. Re-running it would rewrite the Discord application
    // and the public URL from an endpoint that needs no CSRF token; everything
    // it sets afterwards lives in the dashboard's Settings tab.
    if (!settings.needsSetup()) {
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
        intervalMinutes: clampKeepAliveInterval(body.keepAliveIntervalMinutes)
      };
    }

    settings.update({ ...patch, discord: { ...settings.get().discord, ...discordPatch } });

    if (body.presence && typeof body.presence === "object") {
      const result = sanitizePresence(body.presence, {
        current: settings.presenceFor(ADMIN_USER_ID) || DEFAULT_CONFIG,
        now: now(),
        ownsAsset: (id) => settings.ownsAsset(id, ADMIN_USER_ID)
      });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });
      }
      settings.setPresence(ADMIN_USER_ID, result.value);
    }

    settings.completeSetup();

    const effective = settings.effective();
    await bot.reconfigure({ token: effective.botToken, enabled: effective.botEnabled });
    applyPresenceToBot();
    if (keepAlive) keepAlive.configure(effective.keepAlive.enabled ? { ...effective.keepAlive, publicUrl: effective.publicUrl } : { enabled: false });

    resetSession(req, {
      user: { id: ADMIN_USER_ID, name: "Dashboard", role: "admin", via: "key" },
      csrf: randomToken(24)
    });
    logger.log?.(`[setup] completed (bot: ${effective.hasBotToken ? "configured" : "not configured"})`);
    broadcastState();
    res.json({ ok: true, redirect: "/" });
  });

  // -------------------------------------------------------------------- auth

  /**
   * One page, two doors: members use email + password, the owner uses the
   * dashboard key. Both end in the same session shape, with `role` deciding what
   * the dashboard shows (the admin panel is the key's, or a promoted member's).
   */
  app.get("/login", (req, res) => {
    if (settings.needsSetup()) return res.redirect(302, "/setup");
    if (req.session?.user) return res.redirect(302, "/");
    res.type("html").send(
      render("login.html", {
        CSRF: ensureCsrf(req),
        DISCORD_ENABLED: settings.effective().discordLoginEnabled ? "true" : "false",
        KEY_ENABLED: settings.hasAdminKey ? "true" : "false",
        SIGNUP_ENABLED: settings.allowSignup ? "true" : "false",
        VERSION: version
      })
    );
  });

  function startMemberSession(req, user) {
    resetSession(req, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role === "admin" ? "admin" : "member",
        via: "password",
        // Pinned so a later password reset can retire this session.
        pwAt: user.passwordChangedAt || null
      },
      csrf: randomToken(24)
    });
  }

  app.post("/login", requireCsrf, (req, res) => {
    const ip = clientKey(req);
    const limited = loginLimiter.status(ip);
    if (limited.blocked) {
      res.setHeader("Retry-After", String(Math.ceil(limited.retryAfterMs / 1000)));
      return res.redirect(303, "/login?error=locked");
    }

    // Door 1: the dashboard key (the admin panel).
    if (req.body?.key !== undefined && req.body.key !== "") {
      if (!settings.hasAdminKey) return res.redirect(303, "/login?error=key_disabled");
      if (!settings.verifyAdminKey(req.body.key)) {
        const after = loginLimiter.fail(ip);
        logger.warn?.(`[auth] failed dashboard-key sign-in from ${ip}`);
        return res.redirect(303, after.blocked ? "/login?error=locked" : "/login?error=invalid");
      }
      loginLimiter.reset(ip);
      resetSession(req, {
        user: { id: ADMIN_USER_ID, name: "Dashboard", role: "admin", via: "key" },
        csrf: randomToken(24)
      });
      logger.log?.(`[auth] dashboard key sign-in from ${ip}`);
      return res.redirect(303, "/");
    }

    // Door 2: a member account.
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    const user = settings.verifyCredentials(email, password);
    if (!user) {
      const after = loginLimiter.fail(ip);
      logger.warn?.(`[auth] failed password sign-in for "${email.slice(0, 80)}" from ${ip}`);
      return res.redirect(303, after.blocked ? "/login?error=locked" : "/login?error=bad_credentials");
    }
    loginLimiter.reset(ip);
    settings.touchUserLogin(user.id);
    startMemberSession(req, user);
    logger.log?.(`[auth] ${user.id} signed in`);
    res.redirect(303, "/");
  });

  app.get("/register", (req, res) => {
    if (settings.needsSetup()) return res.redirect(302, "/setup");
    if (req.session?.user) return res.redirect(302, "/");
    res.type("html").send(
      render("register.html", {
        CSRF: ensureCsrf(req),
        SIGNUP_ENABLED: settings.allowSignup ? "true" : "false",
        VERSION: version
      })
    );
  });

  app.post("/register", requireCsrf, (req, res) => {
    if (!settings.allowSignup) return res.redirect(303, "/register?error=closed");
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    const confirm = String(req.body?.confirm ?? password);
    if (password !== confirm) return res.redirect(303, "/register?error=mismatch");
    let user;
    try {
      user = settings.createUser({ email, password, name: req.body?.name });
    } catch (error) {
      const message = encodeURIComponent(error.message);
      return res.redirect(303, `/register?error=invalid&message=${message}`);
    }
    settings.touchUserLogin(user.id);
    // createUser() hands back the public shape; the session needs the row so it
    // can pin passwordChangedAt and be retired by a later reset.
    startMemberSession(req, settings.findUserById(user.id) || user);
    logger.log?.(`[auth] ${user.id} signed up`);
    res.redirect(303, "/");
  });

  app.post("/logout", requireCsrf, (req, res) => {
    req.session = null;
    res.redirect(303, "/");
  });

  // ------------------------------------------------------------- discord sso

  function callbackUri(req) {
    const effective = settings.effective();
    if (effective.redirectUri) return effective.redirectUri;
    return `${originOf(req)}/auth/discord/callback`;
  }

  function startOAuth(req, res, intent) {
    const effective = settings.effective();
    if (!effective.clientId || !effective.clientSecret) {
      return res.redirect(302, intent === "link" ? "/?tab=profile&link=unconfigured" : "/login?error=discord_disabled");
    }
    const state = randomToken(24);
    req.session.oauth = { state, at: now(), intent };
    res.redirect(
      302,
      oauth.buildAuthorizeUrl({ clientId: effective.clientId, redirectUri: callbackUri(req), state })
    );
  }

  app.get("/auth/discord", (req, res) => {
    const effective = settings.effective();
    if (!effective.discordLoginEnabled) return res.redirect(302, "/login?error=discord_disabled");
    return startOAuth(req, res, "login");
  });

  /**
   * Tie the Discord account you are signed in as to this StatusC0rd account.
   *
   * The in-Discord app only learns a Discord user id, so without this link it
   * cannot know whose card to push. It is the member equivalent of "sign in with
   * Discord", and it needs no allowlist - you are already signed in.
   */
  app.get("/auth/discord/link", (req, res) => {
    if (!req.session?.user) return res.redirect(302, "/login");
    return startOAuth(req, res, "link");
  });

  app.get("/auth/discord/callback", async (req, res) => {
    const pending = req.session?.oauth;
    req.session.oauth = null;
    const intent = pending?.intent === "link" ? "link" : "login";
    const fail = (code) =>
      intent === "link" ? res.redirect(302, `/?tab=profile&link=${code}`) : res.redirect(302, `/login?error=${code}`);

    if (req.query.error) return fail("cancelled");
    if (!pending || !req.query.state || !safeEqual(req.query.state, pending.state)) return fail("state");
    if (now() - Number(pending.at) > OAUTH_STATE_TTL_MS) return fail("expired");
    if (!req.query.code) return fail("state");

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
      logger.error?.(`[auth] Discord ${intent} failed: ${error.message}`);
      return fail(intent === "link" ? "failed" : "discord_failed");
    }

    // ---- linking an already signed-in account ----
    if (intent === "link") {
      const userId = ownerId(req);
      if (!userId) return res.redirect(302, "/login?error=state");
      try {
        settings.linkDiscord(me.id, userId);
      } catch (error) {
        logger.warn?.(`[auth] could not link ${me.id} to ${userId}: ${error.message}`);
        return res.redirect(302, "/?tab=profile&link=taken");
      }
      logger.log?.(`[auth] Discord account ${me.id} linked to ${userId}`);
      broadcastState();
      return res.redirect(302, "/?tab=profile&link=ok");
    }

    // ---- signing in with Discord ----
    // A link already on file is the strongest signal: a member who connected
    // their account earlier signs in without being on any allowlist.
    const linked = settings.userIdForDiscord(me.id);
    if (linked === ADMIN_USER_ID) {
      resetSession(req, {
        user: { id: ADMIN_USER_ID, name: me.global_name || me.username || "Dashboard", role: "admin", via: "discord" },
        csrf: randomToken(24)
      });
      return res.redirect(302, "/");
    }
    const member = linked ? settings.findUserById(linked) : null;
    if (member && !member.disabled) {
      settings.touchUserLogin(member.id);
      startMemberSession(req, member);
      return res.redirect(302, "/");
    }

    // Otherwise the allowlist decides, and an allowlisted account becomes the
    // admin - linking it too, so its card can reach the bot.
    if (!effective.allowedDiscordIds.includes(me.id)) {
      logger.warn?.(`[auth] Discord account ${me.id} is neither linked nor allowlisted`);
      return res.redirect(302, "/login?error=not_allowed");
    }
    try {
      settings.linkDiscord(me.id, ADMIN_USER_ID);
    } catch {
      /* another account already owns it; the session below is still valid */
    }
    resetSession(req, {
      user: { id: ADMIN_USER_ID, name: me.global_name || me.username || "Dashboard", role: "admin", via: "discord" },
      csrf: randomToken(24)
    });
    res.redirect(302, "/");
  });

  // --------------------------------------------------------------- dashboard

  /**
   * The front door.
   *
   * A stranger gets the pitch and two buttons; a signed-in account goes straight
   * to its dashboard. Before setup there is nothing to sign in to, so everyone
   * is sent to the wizard instead.
   */
  function renderHome(req, res) {
    // Built here rather than in the template: the buttons depend on whether the
    // instance is configured and whether sign-ups are open.
    const actions = settings.allowSignup
      ? '<a class="btn primary" href="/register">Create your card</a>' +
        '<a class="btn ghost" href="/login">Sign in</a>'
      : '<a class="btn primary" href="/login">Sign in</a>';
    res.type("html").send(render("home.html", { VERSION: version, ACTIONS_HTML: actions }));
  }

  app.get("/", (req, res) => {
    if (settings.needsSetup()) return res.redirect(302, "/setup");
    if (!liveUser(req)) {
      if (req.session?.user) req.session = null;
      return renderHome(req, res);
    }
    const effective = settings.effective();
    const user = req.session.user;
    res.type("html").send(
      render("dashboard.html", {
        CSRF: ensureCsrf(req),
        VERSION: version,
        CLIENT_ID: effective.clientId,
        ROLE: user.role === "admin" ? "admin" : "member",
        USER_NAME: user.name || "Member",
        USER_EMAIL: user.email || "",
        MEMBER_COUNT: String(settings.countUsers()),
        ALLOW_SIGNUP: settings.allowSignup ? "true" : "false",
        CARD_HANDLE: settings.cardFor(user.id || ADMIN_USER_ID)?.handle || "",
        CARD_CHECKED: settings.cardFor(user.id || ADMIN_USER_ID)?.publicCard ? "checked" : "",
        CARD_URL: `${(settings.effective().publicUrl || originOf(req)).replace(/\/+$/, "")}/c/${
          settings.cardFor(user.id || ADMIN_USER_ID)?.handle || ""
        }`,
        CARD_TAG: settings.cardFor(user.id || ADMIN_USER_ID)?.publicCard ? "Public" : "Private",
        CARD_STATUS: settings.cardFor(user.id || ADMIN_USER_ID)?.publicCard
          ? "Anyone with the link can view it. Turn the switch off to close it again."
          : "The link is private: only you can open it until you switch it on.",
        ALLOW_SIGNUP_CHECKED: settings.allowSignup ? "checked" : "",
        // No application id means no invite link: a `client_id=` with an empty
        // value is a dead page on discord.com, worse than no button at all.
        // `applications.commands` is what puts the app in Discord's App Launcher;
        // without it the Activity can never be opened, so photos and buttons
        // would have no way to reach a profile. `bot` is optional but harmless.
        INVITE_URL: effective.clientId
          ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(effective.clientId)}` +
            `&scope=${encodeURIComponent("bot applications.commands")}&permissions=0`
          : ""
      })
    );
  });

  // ------------------------------------------------------------ public cards

  const CARD_TYPE_LABELS = ["PLAYING", "STREAMING", "LISTENING TO", "WATCHING", "", "COMPETING IN"];

  /** Header buttons for a page that is not the dashboard. */
  function siteActions(req, primary = "Create your card") {
    if (liveUser(req)) return '<a class="btn ghost" href="/">Open dashboard</a>';
    const signup = settings.allowSignup
      ? `<a class="btn primary" href="/register">${primary}</a>`
      : "";
    return `${signup}<a class="btn ghost" href="/login">Sign in</a>`;
  }

  /** "1:23:45" for an elapsed timer, in the same shape the dashboard shows. */
  function elapsedLabel(startMs) {
    const seconds = Math.max(0, Math.floor((now() - Number(startMs)) / 1000));
    const pad = (value) => String(value).padStart(2, "0");
    const hours = Math.floor(seconds / 3600);
    return hours > 0
      ? `${hours}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
      : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }

  /**
   * A shareable card page.
   *
   * Discord only accepts presence from a Discord client, so a website cannot
   * set it. What a website *can* do - and what this page is - is show the card
   * you built: photo, both lines, timer and working buttons, at a link you can
   * paste anywhere. Private until the owner turns it on.
   */
  function renderCard(req, res, found) {
    const origin = publicOrigin(req);
    const presence = settings.presenceFor(found.ownerId) || DEFAULT_CONFIG;
    const resolveAsset = (id) => {
      if (!settings.ownsAsset(id, found.ownerId)) return "";
      const asset = settings.findAsset(id);
      return asset ? assets.url(asset, origin) : "";
    };

    const large = resolveAsset(String(presence.largeImage || "").replace(/^asset:/, ""));
    const small = resolveAsset(String(presence.smallImage || "").replace(/^asset:/, ""));
    const custom = Number(presence.type) === 4;

    const art = custom
      ? '<span class="preview-art-fallback" aria-hidden="true">S</span>'
      : `${large
          ? `<img src="${escapeHtml(large)}" alt="" />`
          : '<span class="preview-art-fallback" aria-hidden="true">S</span>'}${
          small ? `<span class="preview-small"><img src="${escapeHtml(small)}" alt="" /></span>` : ""
        }`;

    // Buttons are real links here: this page is meant to be clicked.
    const buttons = (Array.isArray(presence.buttons) ? presence.buttons : [])
      .map(
        (button) =>
          `<a class="preview-button" href="${escapeHtml(button.url)}" rel="noreferrer noopener nofollow" target="_blank">${escapeHtml(button.label)}</a>`
      )
      .join("");

    const name = String(presence.name || "").trim() || "StatusC0rd";
    const startMs = presence.startedAt && Number(presence.startTimestamp) > 0 ? Number(presence.startTimestamp) : 0;
    const live = presence.enabled && presence.targets?.profile !== false;
    const description = [presence.details, presence.state].filter(Boolean).join(" · ") || `${name} on StatusC0rd`;
    const note = live
      ? `This is the card @${found.handle} publishes to Discord.`
      : "This card is switched off right now — the owner's last saved version is shown.";

    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(
      render("card.html", {
        VERSION: version,
        HANDLE: found.handle,
        PAGE_TITLE: `${name} — StatusC0rd card`,
        PAGE_DESCRIPTION: description,
        OG_HTML: large && /^https:\/\//.test(large)
          ? `<meta property="og:image" content="${escapeHtml(large)}" />`
          : "",
        ACTIONS_HTML: siteActions(req),
        ART_HTML: art,
        TYPE_LABEL: custom ? "" : CARD_TYPE_LABELS[Number(presence.type) || 0] || "",
        NAME: name,
        DETAILS: custom ? "" : presence.details || "",
        STATE_TEXT: custom ? "" : presence.state || "",
        TIME_TEXT: startMs ? elapsedLabel(startMs) : "",
        START_MS: startMs ? String(startMs) : "",
        STATE_LABEL: live ? "Live" : "Paused",
        NOTE: note,
        BUTTONS_HTML: buttons
      })
    );
  }

  app.get("/c/:handle", (req, res) => {
    const found = settings.findCardByHandle(req.params.handle);
    // A private or unknown card is a 404 either way: publishing is opt-in, and
    // "this handle exists but is private" is not something to confirm.
    if (!found || !found.publicCard) {
      return sendErrorPage(res, 404, "No card at that link", "This card is private or the handle changed. Ask the owner for a fresh link.");
    }
    if (found.ownerId !== ADMIN_USER_ID) {
      const owner = settings.findUserById(found.ownerId);
      if (!owner || owner.disabled) {
        return sendErrorPage(res, 404, "No card at that link", "This card is private or the handle changed. Ask the owner for a fresh link.");
      }
    }
    return renderCard(req, res, found);
  });

  /** Change your handle, or publish / unpublish the card. */
  app.post("/api/card", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const userId = ownerId(req);
    try {
      const card = settings.setCard(userId, {
        handle: req.body?.handle,
        publicCard: req.body?.publicCard
      });
      broadcastState();
      res.json({ ok: true, card: { ...card, url: `${publicOrigin(req)}/c/${card.handle}` } });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // --------------------------------------------------------------------- api

  // ------------------------------------------------------- split-hosting API
  //
  // When the bot is hosted apart from the website, its worker holds the gateway
  // connection and reads the owner's card from here. The shared secret is
  // BOT_WORKER_TOKEN; without it both routes answer 404, so an instance that
  // does not use split hosting exposes nothing extra.

  function workerToken() {
    return String(process.env.BOT_WORKER_TOKEN || "").trim();
  }

  function workerAuth(req, res) {
    const expected = workerToken();
    if (!expected) {
      res.status(404).json({ ok: false, error: "Split hosting is not enabled on this instance." });
      return false;
    }
    const supplied = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ ok: false, error: "The bot worker token is not correct." });
      return false;
    }
    return true;
  }

  app.get("/api/bot/card", (req, res) => {
    if (!workerAuth(req, res)) return undefined;
    // Only the owner's card ever reaches a bot; members' cards go to their own
    // profile through the Activity, exactly as inside Discord.
    res.setHeader("Cache-Control", "no-store");
    const presence = settings.presenceFor(ADMIN_USER_ID) || DEFAULT_CONFIG;
    return res.json({ ok: true, presence, version, updatedAt: presence.updatedAt || null });
  });

  app.post("/api/bot/status", writeLimiter.middleware(), (req, res) => {
    if (!workerAuth(req, res)) return undefined;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    botWorker = {
      connected: Boolean(body.connected),
      status: typeof body.status === "string" ? body.status.slice(0, 32) : null,
      tag: typeof body.tag === "string" ? body.tag.slice(0, 64) : null,
      error: typeof body.error === "string" ? body.error.slice(0, 200) : null,
      lastActivity: typeof body.lastActivity === "string" ? body.lastActivity.slice(0, 128) : null,
      lastSeenAt: new Date(now()).toISOString()
    };
    // The dashboard's bot pill listens to this, so a remote worker shows up
    // exactly like a local connection would.
    broadcastState();
    return res.json({ ok: true });
  });

  app.get("/api/state", requireAuthApi, (req, res) => {
    res.json({ ok: true, user: publicUser(req), csrf: ensureCsrf(req), ...snapshotFor(req) });
  });

  /**
   * Validate a card for whoever is asking.
   *
   * A member's card can only target their own profile: there is one bot and its
   * card is the server owner's. Forcing that here (rather than trusting the
   * checkbox) means a crafted request cannot take over the bot card.
   */
  function sanitizeForOwner(req, body) {
    const userId = ownerId(req);
    const current = settings.presenceFor(userId) || DEFAULT_CONFIG;
    const payload = isAdminSession(req)
      ? body
      : { ...(body || {}), targets: { bot: false, profile: true } };
    const result = sanitizePresence(payload, {
      current,
      now: now(),
      // A card may only point at photos its own account uploaded.
      ownsAsset: (id) => settings.ownsAsset(id, userId)
    });
    return { ...result, userId };
  }

  /** Only the owner's publish moves the bot card. */
  function applyBotIfOwner(req) {
    if (isAdminSession(req)) applyPresenceToBot();
  }

  app.get("/api/presence", requireAuthApi, (req, res) => {
    const userId = ownerId(req);
    const presence = settings.presenceFor(userId) || DEFAULT_CONFIG;
    const origin = publicOrigin(req);
    const resolveAsset = (id) => {
      if (!settings.ownsAsset(id, userId)) return "";
      const asset = settings.findAsset(id);
      return asset ? assets.url(asset, origin) : "";
    };
    res.json({
      ok: true,
      presence,
      activity: buildActivity(presence, { target: "profile", publicUrl: origin, resolveAsset }),
      botActivity: isAdminSession(req)
        ? buildActivity(presence, { target: "bot", publicUrl: origin, resolveAsset })
        : null
    });
  });

  app.post("/api/presence", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const result = sanitizeForOwner(req, req.body);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });

    settings.setPresence(result.userId, result.value);
    settings.setDraft(result.userId, null);
    applyBotIfOwner(req);
    broadcastState();
    logger.log?.(`[presence] ${result.userId} -> "${result.value.name}"`);
    res.json({ ok: true, presence: result.value, bot: bot.getState() });
  });

  /**
   * Draft endpoints: the editor stages changes here without touching what
   * Discord is showing. `POST /api/presence` still means "save and apply now",
   * so anything scripted against the old API keeps working.
   */
  app.post("/api/presence/draft", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const result = sanitizeForOwner(req, req.body);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });

    const draft = { ...result.value, savedAt: new Date(now()).toISOString() };
    settings.setDraft(result.userId, draft);
    broadcastState();
    res.json({ ok: true, draft });
  });

  app.post("/api/presence/publish", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const userId = ownerId(req);
    const source =
      req.body && Object.keys(req.body).length > 0 ? req.body : settings.draftFor(userId);
    if (!source) return res.status(400).json({ ok: false, error: "There is nothing staged to publish." });

    const result = sanitizeForOwner(req, source);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });

    settings.setPresence(result.userId, result.value);
    settings.setDraft(result.userId, null);
    applyBotIfOwner(req);
    broadcastState();
    logger.log?.(`[presence] ${result.userId} published "${result.value.name}"`);
    res.json({ ok: true, presence: result.value, bot: bot.getState() });
  });

  app.delete("/api/presence/draft", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    settings.setDraft(ownerId(req), null);
    broadcastState();
    res.json({ ok: true, draft: null });
  });

  /** A template, merged into the current config and validated the same way. */
  app.post("/api/templates/:id", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const userId = ownerId(req);
    const current = settings.draftFor(userId) || settings.presenceFor(userId) || DEFAULT_CONFIG;
    const merged = applyTemplate(req.params.id, current);
    if (!merged) return res.status(404).json({ ok: false, error: "Unknown template." });

    const result = sanitizeForOwner(req, merged);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });
    res.json({ ok: true, presence: result.value });
  });

  app.post("/api/presence/clear", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const userId = ownerId(req);
    const current = settings.presenceFor(userId) || DEFAULT_CONFIG;
    const next = { ...current, enabled: false, updatedAt: new Date(now()).toISOString() };
    settings.setPresence(userId, next);
    settings.setDraft(userId, null);
    applyBotIfOwner(req);
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
      assets: settings
        .listAssets(ownerId(req))
        .map((asset) => ({ ...asset, url: assets.url(asset, origin) }))
    });
  });

  app.post("/api/assets", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const result = assets.save({
      dataUrl: req.body?.dataUrl,
      name: req.body?.name,
      owner: ownerId(req)
    });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    broadcastState();
    res.json({ ok: true, asset: { ...result.asset, url: assets.url(result.asset, publicOrigin(req)) } });
  });

  app.delete("/api/assets/:id", requireAuthApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const id = String(req.params.id || "");
    // 404 rather than 403: another member's library is not your business.
    if (!settings.ownsAsset(id, ownerId(req))) {
      return res.status(404).json({ ok: false, error: "Image not found." });
    }
    assets.remove(id, ownerId(req));
    // The photo may still be referenced by the card that is on Discord.
    settings.clearAssetReferences(id, ownerId(req));
    broadcastState();
    res.json({ ok: true });
  });

  // --------------------------------------------------------------- settings

  app.get("/api/settings", requireAdminApi, (req, res) => {
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
        allowSignup: settings.allowSignup,
        memberCount: settings.countUsers(),
        updatedAt: stored.updatedAt
      }
    });
  });

  app.post("/api/settings", requireAdminApi, requireCsrf, writeLimiter.middleware(), async (req, res) => {
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
        intervalMinutes: clampKeepAliveInterval(body.keepAlive.intervalMinutes)
      };
    }
    if (body.allowSignup !== undefined) patch.allowSignup = Boolean(body.allowSignup);

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

  // ---------------------------------------------------------------- members
  //
  // The admin panel's account management. Open sign-up creates members; these
  // endpoints are for the owner: add someone by hand, disable an account, reset
  // a forgotten password, unlink a Discord account, or remove someone entirely.

  function memberPayload(user) {
    return {
      ...user,
      presenceName: settings.presenceFor(user.id)?.name || null,
      photos: settings.listAssets(user.id).length
    };
  }

  app.get("/api/admin/users", requireAdminApi, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      users: settings.listUsers().map(memberPayload),
      allowSignup: settings.allowSignup,
      limit: MAX_USERS
    });
  });

  app.post("/api/admin/users", requireAdminApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    try {
      const user = settings.createUser({
        email: req.body?.email,
        name: req.body?.name,
        password: req.body?.password,
        role: req.body?.role
      });
      logger.log?.(`[admin] created account ${user.id}`);
      broadcastState();
      return res.json({ ok: true, user: memberPayload(user) });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.patch("/api/admin/users/:id", requireAdminApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    try {
      const user = settings.updateUser(String(req.params.id || ""), {
        name: req.body?.name,
        email: req.body?.email,
        role: req.body?.role,
        disabled: req.body?.disabled
      });
      broadcastState();
      return res.json({ ok: true, user: memberPayload(user) });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/admin/users/:id/password", requireAdminApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const id = String(req.params.id || "");
    if (!settings.findUserById(id)) return res.status(404).json({ ok: false, error: "No such account." });
    try {
      settings.setUserPassword(id, req.body?.password);
      logger.log?.(`[admin] reset the password for ${id}`);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/admin/users/:id/unlink", requireAdminApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const id = String(req.params.id || "");
    if (!settings.findUserById(id)) return res.status(404).json({ ok: false, error: "No such account." });
    settings.unlinkDiscord(id);
    broadcastState();
    res.json({ ok: true });
  });

  app.delete("/api/admin/users/:id", requireAdminApi, requireCsrf, writeLimiter.middleware(), (req, res) => {
    const id = String(req.params.id || "");
    const result = settings.deleteUser(id);
    if (!result.removed) return res.status(404).json({ ok: false, error: "No such account." });
    // Their photos are unlisted with the account; prune() then deletes exactly
    // the files no surviving account points at (identical uploads are shared).
    if (result.assetIds.length) assets.prune({ allowEmpty: true });
    logger.log?.(`[admin] removed account ${id}`);
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
    // Unauthenticated: say whether the Activity machinery is live, never who
    // used it or which account it belongs to.
    res.json({
      ok: true,
      configured: activityService.ready(),
      applicationId: activityService.config().clientId || null,
      session: { connected: session.connected, lastSeenAt: session.lastSeenAt }
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
