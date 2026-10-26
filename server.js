"use strict";

/**
 * Every route, in one file, in reading order:
 *   pages    /  /card/:id  /activity/  /health
 *   session  /auth/discord  /auth/discord/callback  POST /logout
 *   api      /api/state /api/presence /api/presence/clear /api/settings /api/assets
 *   activity /activity/api/token  /activity/api/presence   (bearer-token, no session)
 *
 * Security model: multi-user. Anyone signs in with Discord and lands in their
 * own account - their card, their photos, their public card page. The session
 * plus a CSRF header opens every write; the in-Discord app carries an OAuth
 * token that resolves to the same account. Instance-wide settings (bot,
 * keep-alive, site name) are admin-only: ADMIN_DISCORD_IDS, or the first
 * account to sign in when the environment is silent.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cookieSession = require("cookie-session");

const { sanitizePresence, buildActivity, ACTIVITY_TYPES } = require("./src/presence");
const { validateImage, ImageError } = require("./src/images");
const { buildAuthorizeUrl, exchangeCode, fetchMe } = require("./src/oauth");
const { ActivityError } = require("./src/activity");

const VIEWS_DIR = path.join(__dirname, "views");
const PUBLIC_DIR = path.join(__dirname, "public");
const ASSET_NAME = /^[a-f0-9]{16}\.(png|jpg|gif|webp)$/;
const CONTENT_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const OAUTH_STARTS_PER_WINDOW = 10;
const OAUTH_WINDOW_MS = 15 * 60_000;

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandHtml(siteName) {
  return escapeHtml(siteName).replace(/0/g, "<strong>0</strong>");
}

function loadTemplates() {
  const templates = new Map();
  for (const entry of fs.readdirSync(VIEWS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".html")) {
      templates.set(entry.name, fs.readFileSync(path.join(VIEWS_DIR, entry.name), "utf8"));
    }
  }
  return templates;
}

function makeLimiter({ max, windowMs }) {
  const hits = new Map();
  return function allowed(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      if (hits.size > 1000) hits.clear();
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

function sanitizeSiteName(value) {
  const text = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text ? text.slice(0, 40) : "";
}

function elapsedText(startMs, now) {
  const seconds = Math.max(0, Math.floor((now - Number(startMs)) / 1000));
  const pad = (v) => String(v).padStart(2, "0");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
}

function createApp({ store, bot, keepAlive, activity, effective, version, production, applyKeepAlive, applyBotPresence }) {
  const app = express();
  const templates = loadTemplates();
  const oauthLimiter = makeLimiter({ max: OAUTH_STARTS_PER_WINDOW, windowMs: OAUTH_WINDOW_MS });
  const activityTokenLimiter = makeLimiter({ max: 10, windowMs: 60_000 });

  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === undefined ? (production ? 1 : false) : process.env.TRUST_PROXY);

  /* ---- plumbing ---- */

  app.use(
    cookieSession({
      name: "sc0rd",
      keys: [store.sessionSecret()],
      maxAge: SESSION_MAX_AGE_MS,
      sameSite: "lax",
      httpOnly: true,
      secure: production
    })
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false }));

  const logRequests = !["0", "false", "off", "no"].includes(String(process.env.LOG_REQUESTS || "").trim().toLowerCase());
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      if (logRequests) console.log("[http] " + req.method + " " + req.originalUrl + " " + res.statusCode + " " + (Date.now() - startedAt) + "ms");
    });
    next();
  });

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.path.startsWith("/activity")) {
      // Discord embeds the Activity in an iframe; nobody else may.
      res.setHeader("Content-Security-Policy", "frame-ancestors " + (activity.FRAME_ANCESTORS || "https://discord.com https://*.discord.com") + ";");
    } else {
      res.setHeader("X-Frame-Options", "DENY");
    }
    next();
  });

  app.use(express.static(PUBLIC_DIR, { maxAge: "1h" }));

  function render(res, name, vars, status) {
    const template = templates.get(name);
    if (!template) {
      res.status(500).type("text/plain").send("Missing template: " + name);
      return;
    }
    const out = template
      .replace(/\{\{\{(\w+)\}\}\}/g, (match, key) => String(vars[key] !== undefined ? vars[key] : ""))
      .replace(/\{\{(\w+)\}\}/g, (match, key) => escapeHtml(vars[key] !== undefined ? vars[key] : ""));
    res.status(status || 200).type("html").send(out);
  }

  function ensureCsrf(req) {
    if (!req.session || !req.session.cs) req.session.cs = crypto.randomBytes(24).toString("hex");
    return req.session.cs;
  }

  function currentUser(req) {
    const id = req.session && req.session.uid;
    return id ? store.getUser(id) : null;
  }

  function requireAuth(req, res, next) {
    if (currentUser(req)) return next();
    res.status(401).json({ ok: false, error: "Not signed in." });
  }

  function isAdmin(req) {
    const user = currentUser(req);
    return Boolean(user && store.isAdmin(user.id, effective().adminIds));
  }

  function requireCsrf(req, res, next) {
    const given = req.get("x-csrf") || (req.body && req.body._csrf) || "";
    const expected = req.session && req.session.cs ? req.session.cs : "";
    const a = Buffer.from(String(given));
    const b = Buffer.from(String(expected));
    if (a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)) return next();
    res.status(403).json({ ok: false, error: "The form was stale - reload the page and try again." });
  }

  function pageVars(extra) {
    const config = effective();
    return Object.assign(
      {
        SITE_NAME: config.siteName,
        BRAND_HTML: brandHtml(config.siteName),
        VERSION: version
      },
      extra
    );
  }

  /* ---- pages ---- */

  app.get("/", (req, res) => {
    if (currentUser(req)) {
      return render(res, "dashboard.html", pageVars({ CLIENT_ID: effective().clientId }));
    }
    const reasons = {
      "1": "Discord refused that sign-in - try again.",
      "2": "Too many sign-ins from this address - wait fifteen minutes.",
      "3": "This instance has no Discord application configured yet."
    };
    render(res, "index.html", pageVars({ ERROR: reasons[req.query.e] || "" }));
  });

  app.post("/logout", (req, res) => {
    req.session = null;
    res.redirect("/");
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: Math.floor(process.uptime()), version });
  });

  // The user-install link: the app lands in anyone's App Launcher with no
  // server invite - the same Discord-provided flow the reference site uses.
  app.get("/invite", (req, res) => {
    const clientId = effective().clientId;
    if (!clientId) return res.redirect("/?e=3");
    res.redirect("https://discord.com/oauth2/authorize?client_id=" + encodeURIComponent(clientId) + "&integration_type=1&scope=applications.commands");
  });

  /* ---- sign in with Discord ---- */

  app.get("/auth/discord", (req, res) => {
    const config = effective();
    if (!config.clientId || !config.clientSecret || !config.publicUrl) return res.redirect("/?e=3");
    if (!oauthLimiter(req.ip || "unknown")) return res.redirect("/?e=2");
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    res.redirect(buildAuthorizeUrl({ clientId: config.clientId, redirectUri: config.publicUrl + "/auth/discord/callback", state, scope: "identify" }));
  });

  app.get("/auth/discord/callback", async (req, res) => {
    try {
      const config = effective();
      if (!req.session.oauthState || String(req.query.state) !== req.session.oauthState) {
        return res.redirect("/?e=1");
      }
      req.session.oauthState = null;
      if (req.query.error) return res.redirect("/?e=1");
      const token = await exchangeCode({ code: String(req.query.code || ""), clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.publicUrl + "/auth/discord/callback" });
      const me = await fetchMe(token.access_token);
      const user = store.ensureUser(me.id, me.global_name || me.username);
      // Nobody named an admin and this is the first account through the door:
      // it owns the instance.
      if (store.userCount() === 1 && store.adminIds.length === 0 && config.adminIds.length === 0) {
        store.addAdmin(user.id);
        console.log("[auth] first account through the door - " + user.username + " is now the admin.");
      }
      req.session.uid = user.id;
      req.session.cs = crypto.randomBytes(24).toString("hex");
      res.redirect("/");
    } catch (error) {
      console.warn("[oauth] sign-in failed:", error.message);
      res.redirect("/?e=3");
    }
  });

  /* ---- the signed-in api ---- */

  app.get("/api/state", requireAuth, (req, res) => {
    const user = currentUser(req);
    const config = effective();
    const admin = store.isAdmin(user.id, config.adminIds);
    res.json({
      ok: true,
      csrf: ensureCsrf(req),
      siteName: config.siteName,
      version,
      publicUrl: config.publicUrl,
      publicUrlManaged: Boolean(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL),
      user: { id: user.id, username: user.username, admin },
      cardPath: "/card/" + user.id,
      presence: user.presence,
      assets: user.assets.map((a) => ({ id: a.id, ext: a.ext, bytes: a.bytes, width: a.width, height: a.height, addedAt: a.addedAt, url: store.assetUrl(a, config.publicUrl) })),
      activity: activity.snapshot(user.id),
      bot: admin ? bot.getState() : null,
      keepAlive: admin ? keepAlive.getState() : null,
      settings: admin
        ? {
            cardPublished: user.cardPublished === true,
            clientId: config.clientId,
            hasClientSecret: Boolean(config.clientSecret),
            hasBotToken: Boolean(config.botToken),
            siteName: store.settings.siteName || "",
            keepAlive: config.keepAlive,
            keepAliveMinutes: config.keepAliveMinutes
          }
        : { cardPublished: user.cardPublished === true }
    });
  });

  app.post("/api/presence", requireAuth, requireCsrf, (req, res) => {
    const user = currentUser(req);
    const admin = isAdmin(req);
    const result = sanitizePresence(req.body, {
      current: user.presence,
      ownsAsset: (id) => store.ownsAsset(user.id, id)
    });
    if (!result.ok) {
      return res.status(422).json({ ok: false, errors: result.errors });
    }
    // Only the admin's card rides the gateway bot. Everyone else is
    // profile-only - which is where photos and buttons work anyway.
    if (!admin) result.value.targets.bot = false;
    store.setPresence(user.id, result.value);
    if (admin) bot.setPresence(result.value);
    res.json({ ok: true, presence: result.value });
  });

  app.post("/api/presence/clear", requireAuth, requireCsrf, (req, res) => {
    const user = currentUser(req);
    const presence = { ...user.presence, enabled: false, updatedAt: new Date().toISOString() };
    store.setPresence(user.id, presence);
    if (isAdmin(req)) bot.clearPresence(presence.status || "online");
    res.json({ ok: true, presence });
  });

  app.post("/api/settings", requireAuth, requireCsrf, (req, res) => {
    const user = currentUser(req);
    const admin = isAdmin(req);
    const body = req.body || {};

    // Everyone: the publish switch on their own card page.
    if (body.cardPublished !== undefined) {
      store.setCardPublished(user.id, body.cardPublished === true || body.cardPublished === "true");
    }

    // Admins only: instance-wide values.
    const adminOnly = ["clientId", "clientSecret", "botToken", "siteName", "keepAlive", "keepAliveMinutes"];
    const touchedAdminFields = adminOnly.some((k) => body[k] !== undefined);
    if (touchedAdminFields && !admin) {
      return res.status(403).json({ ok: false, error: "Those settings are admin-only." });
    }
    if (admin && touchedAdminFields) {
      const s = store.settings;
      if (body.clientId !== undefined) s.clientId = String(body.clientId).trim().slice(0, 32);
      if (typeof body.clientSecret === "string" && body.clientSecret.trim() !== "") s.clientSecret = body.clientSecret.trim().slice(0, 128);
      if (typeof body.botToken === "string" && body.botToken.trim() !== "") s.botToken = body.botToken.trim().slice(0, 128);
      if (body.siteName !== undefined) s.siteName = sanitizeSiteName(body.siteName);
      if (body.keepAlive !== undefined) s.keepAlive = body.keepAlive === true || body.keepAlive === "true" || body.keepAlive === 1;
      if (body.keepAliveMinutes !== undefined) s.keepAliveMinutes = Math.min(60, Math.max(5, Number(body.keepAliveMinutes) || 10));
      store.save();
      const config = effective();
      // A settings save may re-point the bot and the keep-alive; both no-op when nothing changed.
      void bot.reconfigure({ token: config.botToken, enabled: config.botEnabled });
      if (applyBotPresence) applyBotPresence();
      if (applyKeepAlive) applyKeepAlive();
    }

    res.json({ ok: true });
  });

  app.get("/api/assets", requireAuth, (req, res) => {
    const user = currentUser(req);
    const config = effective();
    res.json({ ok: true, assets: user.assets.map((a) => ({ id: a.id, ext: a.ext, bytes: a.bytes, width: a.width, height: a.height, addedAt: a.addedAt, url: store.assetUrl(a, config.publicUrl) })) });
  });

  app.post("/api/assets", requireAuth, requireCsrf, express.raw({ type: "application/octet-stream", limit: "2.5mb" }), (req, res) => {
    const user = currentUser(req);
    try {
      if (user.assets.length >= store.assetLimit) {
        return res.status(422).json({ ok: false, error: "Photo limit reached - " + store.assetLimit + " per account. Delete one first." });
      }
      let record = validateImage(req.body);
      // The same picture from a second account gets an id of its own.
      record = store.uniqueAssetId(record, user.id);
      if (!store.ownsAsset(user.id, record.id)) {
        fs.writeFileSync(store.assetPath(record), req.body);
        store.addAsset(user.id, record);
      }
      res.json({ ok: true, asset: { id: record.id, ext: record.ext, bytes: record.bytes, width: record.width, height: record.height, addedAt: record.addedAt, url: store.assetUrl(record, effective().publicUrl) } });
    } catch (error) {
      if (error instanceof ImageError) return res.status(422).json({ ok: false, error: error.message });
      res.status(500).json({ ok: false, error: "The upload did not make it to disk." });
    }
  });

  app.delete("/api/assets/:id", requireAuth, requireCsrf, (req, res) => {
    const user = currentUser(req);
    const asset = store.removeAsset(user.id, req.params.id);
    if (!asset) return res.status(404).json({ ok: false, error: "No such photo." });
    if (isAdmin(req)) bot.setPresence(store.getPresence(user.id));
    res.json({ ok: true });
  });

  app.get("/assets/:name", (req, res) => {
    if (!ASSET_NAME.test(req.params.name)) return res.status(404).type("text/plain").send("Not found");
    const asset = store.findAnyAsset(req.params.name.split(".")[0]);
    if (!asset) return res.status(404).type("text/plain").send("Not found");
    res.setHeader("Content-Type", CONTENT_TYPES[asset.ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(store.assetPath(asset));
  });

  /* ---- the in-Discord app (no session: the iframe is Discord's, cookies are not guaranteed) ---- */

  app.get(/^\/activity\/?$/, (req, res) => {
    render(res, "activity.html", pageVars({ CLIENT_ID: effective().clientId, DASHBOARD_URL: effective().publicUrl }));
  });

  app.post("/activity/api/token", (req, res) => {
    if (!activityTokenLimiter(req.ip || "unknown")) return res.status(429).json({ ok: false, error: "Too many handshakes - wait a minute." });
    try {
      const code = req.body && req.body.code;
      activity.exchangeToken(code).then((accessToken) => {
        res.json({ ok: true, access_token: accessToken });
      }).catch((error) => {
        res.status(error instanceof ActivityError ? error.status : 502).json({ ok: false, error: error.message });
      });
    } catch (error) {
      res.status(error instanceof ActivityError ? error.status : 400).json({ ok: false, error: error.message });
    }
  });

  app.get("/activity/api/presence", (req, res) => {
    const header = String(req.get("authorization") || "");
    const accessToken = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    const origin = (req.protocol || "https") + "://" + (req.get("host") || "localhost");
    activity.presence({ accessToken, origin }).then((payload) => {
      res.json(Object.assign({ ok: true }, payload));
    }).catch((error) => {
      res.status(error instanceof ActivityError ? error.status : 500).json({ ok: false, error: error.message || "Something went wrong." });
    });
  });

  /* ---- public card pages ---- */

  function cardNotFound(res) {
    return render(res, "error.html", pageVars({ STATUS: 404, TITLE: "No card here", MESSAGE: "This card is private or does not exist." }), 404);
  }

  function renderCard(res, user) {
    const config = effective();
    const presence = user.presence;
    if (!user.cardPublished || !presence.enabled || !presence.name) return cardNotFound(res);
    const resolveAsset = (id) => {
      const asset = store.findAsset(user.id, id);
      return asset ? store.assetUrl(asset, config.publicUrl) : "";
    };
    const activityObject = buildActivity(presence, { target: "profile", publicUrl: config.publicUrl, resolveAsset });
    if (!activityObject) return cardNotFound(res);
    const large = (activityObject.assets && activityObject.assets.large_image) || "";
    const type = Number(presence.type) || 0;
    const description = [presence.details, presence.state].filter(Boolean).join(" - ");
    const buttons = (activityObject.buttons || []).map((label, index) => {
      const url = activityObject.metadata && activityObject.metadata.button_urls ? activityObject.metadata.button_urls[index] : "";
      if (!/^https:\/\//i.test(String(url))) return "";
      return '<a class="pv-btn" href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer noopener">' + escapeHtml(label) + "</a>";
    }).join("");
    const startMs = presence.startedAt && Number(presence.startTimestamp) > 0 ? Number(presence.startTimestamp) : 0;
    render(res, "card.html", pageVars({
      NAME: activityObject.name,
      TYPE_LABEL: (ACTIVITY_TYPES[type] || "Playing").toUpperCase(),
      DETAILS: presence.details || "",
      STATE_TEXT: type === 4 ? "" : presence.state || "",
      TIME_TEXT: startMs ? elapsedText(startMs, Date.now()) : "",
      START_MS: startMs,
      ART_HTML: large
        ? '<img src="' + escapeHtml(large) + '" alt="" width="96" height="96" />'
        : '<span class="pv-fallback" aria-hidden="true">' + escapeHtml(String(config.siteName).charAt(0).toUpperCase() || "S") + "</span>",
      BUTTONS_HTML: buttons,
      OG_IMAGE: large ? '<meta property="og:image" content="' + escapeHtml(large) + '" />' : "",
      PAGE_TITLE: presence.name + " - " + config.siteName,
      PAGE_DESCRIPTION: description || "A card made with " + config.siteName
    }));
  }

  app.get("/card/:userId", (req, res) => {
    const user = store.getUser(req.params.userId);
    if (!user) return cardNotFound(res);
    renderCard(res, user);
  });

  // Short link for the instance owner.
  app.get("/card", (req, res) => {
    const owner = [...effective().adminIds, ...store.adminIds].map((id) => store.getUser(id)).find(Boolean) || null;
    if (!owner) return cardNotFound(res);
    renderCard(res, owner);
  });

  /* ---- fallthrough ---- */

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "API route not found." });
    render(res, "error.html", pageVars({ STATUS: 404, TITLE: "Not found", MESSAGE: "There is nothing at this address." }), 404);
  });

  app.use((error, req, res, next) => {
    if (error && (error.type === "entity.parse.failed" || error.type === "entity.too.large")) {
      return res.status(400).json({ ok: false, error: error.type === "entity.too.large" ? "That request was too large." : "That request was not valid JSON." });
    }
    console.error("[http]", error);
    if (req.path.startsWith("/api/")) return res.status(500).json({ ok: false, error: "Something went wrong on the server." });
    render(res, "error.html", pageVars({ STATUS: 500, TITLE: "Server error", MESSAGE: "Something went wrong on the server." }), 500);
  });

  return app;
}

module.exports = { createApp };
