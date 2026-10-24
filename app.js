"use strict";

const path = require("node:path");
const express = require("express");
const cookieSession = require("cookie-session");

const { createRenderer } = require("./src/views");
const { sanitizePresence, buildActivity } = require("./src/presence");
const {
  safeEqual,
  randomToken,
  RateLimiter,
  LoginLimiter,
  clientKey,
  ensureCsrf,
  requireCsrf,
  requireAuth,
  requireAuthApi,
  publicUser
} = require("./src/auth");
const { isDiscordLoginEnabled } = require("./src/env");
const oauth = require("./src/oauth");

const VIEWS_DIR = path.join(__dirname, "views");
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Build the Express application.
 *
 * Dependencies are injected so the whole HTTP surface can be exercised in tests
 * without a real Discord connection.
 *
 * @param {object} options
 * @param {object} options.config        result of src/env loadConfig()
 * @param {import('./src/store').JsonFileStore} options.store
 * @param {import('./src/bot').DiscordBot} options.bot
 * @param {Console} [options.logger]
 * @param {() => number} [options.now]  injectable clock for tests
 */
function createApp({ config, store, bot, logger = console, now = Date.now }) {
  if (!config) throw new Error("createApp requires a config object");
  if (!store) throw new Error("createApp requires a store");
  if (!bot) throw new Error("createApp requires a bot instance");

  const render = createRenderer(VIEWS_DIR, { cache: config.isProduction });
  const app = express();
  const startedAt = now();

  const loginLimiter = new LoginLimiter();
  const apiWriteLimiter = new RateLimiter({ windowMs: 60_000, max: 40 });

  /** Connected SSE clients, used to push live state to open dashboards. */
  const streams = new Set();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://cdn.discordapp.com",
        "font-src 'self'",
        "connect-src 'self'",
        "form-action 'self'",
        // Production refuses framing (clickjacking). In development the app may
        // be embedded in a hosted live-preview iframe, so framing is allowed.
        `frame-ancestors ${config.isProduction ? "'self'" : "*"}`
      ].join("; ")
    );
    if (config.isProduction && req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  });

  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      etag: true,
      maxAge: config.isProduction ? "1h" : 0,
      setHeaders(res) {
        res.setHeader("X-Content-Type-Options", "nosniff");
      }
    })
  );

  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

  app.use(
    cookieSession({
      name: "statusc0rd.sid",
      keys: [config.sessionSecret],
      maxAge: SESSION_MAX_AGE_MS,
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      overwrite: true
    })
  );

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/login" || req.path === "/") {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  // ---------------------------------------------------------------- helpers

  function snapshot() {
    const presence = store.get();
    return {
      presence,
      activity: buildActivity(presence),
      bot: bot.getState(),
      meta: {
        version: config.version,
        clientId: config.clientId,
        botEnabled: config.botEnabled,
        discordLoginEnabled: isDiscordLoginEnabled(config),
        redirectUri: config.redirectUri || null,
        startedAt: new Date(startedAt).toISOString()
      }
    };
  }

  function broadcastState() {
    if (streams.size === 0) return;
    const payload = `event: state\ndata: ${JSON.stringify({ type: "state", data: snapshot() })}\n\n`;
    for (const res of streams) {
      try {
        res.write(payload);
      } catch {
        streams.delete(res);
      }
    }
  }

  const onBotState = () => broadcastState();
  bot.on("state", onBotState);

  function resetSession(req, data) {
    // `req.session` is a plain object provided by cookie-session; clearing the
    // keys (rather than replacing the object) rotates the whole session.
    for (const key of Object.keys(req.session)) delete req.session[key];
    Object.assign(req.session, data);
  }

  function callbackUri(req) {
    if (config.redirectUri) return config.redirectUri;
    return `${req.protocol}://${req.get("host")}/auth/discord/callback`;
  }

  function sendErrorPage(res, status, title, detail) {
    res
      .status(status)
      .type("html")
      .send(
        render("error.html", {
          TITLE: title,
          STATUS: status,
          DETAIL: detail
        })
      );
  }

  // ----------------------------------------------------------------- public

  app.get("/health", (req, res) => {
    const storageOk = store.checkWritable();
    res.status(storageOk ? 200 : 503).json({
      status: storageOk ? "ok" : "degraded",
      version: config.version,
      uptimeSeconds: Math.floor(process.uptime()),
      storage: storageOk ? "ok" : "unwritable",
      bot: bot.getState().status
    });
  });

  // ------------------------------------------------------------------- auth

  app.get("/login", (req, res) => {
    if (req.session?.user) return res.redirect(302, "/");
    const csrf = ensureCsrf(req);
    res.type("html").send(
      render("login.html", {
        CSRF: csrf,
        DISCORD_ENABLED: isDiscordLoginEnabled(config) ? "true" : "false",
        KEY_ENABLED: config.dashboardKey ? "true" : "false",
        VERSION: config.version
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

    if (!config.dashboardKey) {
      return res.redirect(303, "/login?error=key_disabled");
    }

    if (!safeEqual(req.body?.key, config.dashboardKey)) {
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
    const user = publicUser(req);
    req.session = null;
    logger.log?.(`[auth] signed out ${user?.id ?? "unknown"}`);
    res.redirect(303, "/login");
  });

  // ------------------------------------------------------------ discord sso

  app.get("/auth/discord", (req, res) => {
    if (!isDiscordLoginEnabled(config)) {
      return res.redirect(302, "/login?error=discord_disabled");
    }
    const state = randomToken(24);
    req.session.oauth = { state, at: now() };
    res.redirect(302, oauth.buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: callbackUri(req),
      state
    }));
  });

  app.get("/auth/discord/callback", async (req, res) => {
    const pending = req.session?.oauth;
    req.session.oauth = null;

    if (req.query.error) {
      return res.redirect(302, "/login?error=cancelled");
    }
    if (!pending || !req.query.state || !safeEqual(req.query.state, pending.state)) {
      return res.redirect(302, "/login?error=state");
    }
    if (now() - Number(pending.at) > OAUTH_STATE_TTL_MS) {
      return res.redirect(302, "/login?error=expired");
    }
    if (!req.query.code) {
      return res.redirect(302, "/login?error=state");
    }

    let me;
    try {
      const token = await oauth.exchangeCode({
        code: String(req.query.code),
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: callbackUri(req)
      });
      me = await oauth.fetchMe(token.access_token);
    } catch (error) {
      logger.error?.(`[auth] Discord sign-in failed: ${error.message}`);
      return res.redirect(302, "/login?error=discord_failed");
    }

    if (!config.allowedDiscordIds.includes(me.id)) {
      logger.warn?.(`[auth] Discord account ${me.id} is not on the allowlist`);
      return res.redirect(302, "/login?error=not_allowed");
    }

    resetSession(req, {
      user: {
        id: me.id,
        name: me.global_name || me.username || `user ${me.id}`,
        role: "editor",
        via: "discord",
        avatar: me.avatar
          ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`
          : null
      },
      csrf: randomToken(24)
    });
    logger.log?.(`[auth] Discord sign-in as ${me.username ?? me.id}`);
    res.redirect(302, "/");
  });

  // --------------------------------------------------------------- dashboard

  app.get("/", requireAuth, (req, res) => {
    const csrf = ensureCsrf(req);
    res.type("html").send(
      render("dashboard.html", {
        CSRF: csrf,
        VERSION: config.version,
        CLIENT_ID: config.clientId,
        INVITE_URL: `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(
          config.clientId
        )}&scope=bot&permissions=0`,
        BOT_ENABLED: config.botEnabled ? "true" : "false"
      })
    );
  });

  // ------------------------------------------------------------------- api

  app.get("/api/state", requireAuthApi, (req, res) => {
    res.json({
      ok: true,
      user: publicUser(req),
      csrf: ensureCsrf(req),
      ...snapshot()
    });
  });

  app.get("/api/presence", requireAuthApi, (req, res) => {
    const presence = store.get();
    res.json({ ok: true, presence, activity: buildActivity(presence) });
  });

  app.post("/api/presence", requireAuthApi, requireCsrf, apiWriteLimiter.middleware(), (req, res) => {
    const result = sanitizePresence(req.body, { current: store.get(), now: now() });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.errors[0], errors: result.errors });
    }

    const saved = store.set(result.value);
    bot.setPresence(saved);
    broadcastState();
    logger.log?.(`[presence] applied "${saved.name}" (${saved.type})`);
    res.json({ ok: true, presence: saved, activity: buildActivity(saved), bot: bot.getState() });
  });

  app.post("/api/presence/clear", requireAuthApi, requireCsrf, apiWriteLimiter.middleware(), (req, res) => {
    const current = store.get();
    const saved = store.set({ ...current, enabled: false, updatedAt: new Date(now()).toISOString() });
    bot.clearPresence(saved.status);
    broadcastState();
    logger.log?.("[presence] cleared");
    res.json({ ok: true, presence: saved, activity: null, bot: bot.getState() });
  });

  app.get("/api/events", requireAuthApi, (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(": connected\n\n");
    res.write(`event: state\ndata: ${JSON.stringify({ type: "state", data: snapshot() })}\n\n`);
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

  // ------------------------------------------------------------- fallbacks

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ ok: false, error: "Not found." });
    }
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
        : status >= 500
          ? "Something went wrong on the server."
          : error.message;
    if (req.path.startsWith("/api/")) {
      return res.status(status).json({ ok: false, error: message });
    }
    return sendErrorPage(res, status, status === 400 ? "Bad request" : "Server error", message);
  });

  app.locals.snapshot = snapshot;
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

module.exports = { createApp, SESSION_MAX_AGE_MS };
