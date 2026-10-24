require("dotenv").config();
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const session = require("express-session");
const { Client, GatewayIntentBits } = require("discord.js");
const RPCManager = require("./rpc/manager");
const { exchangeCode, fetchMe } = require("./rpc/discordApi");

const CONFIG_PATH = path.join(__dirname, "data", "config.json");
const PORT = process.env.PORT || 3000;
const REQUIRED_ENV = ["CLIENT_ID", "DISCORD_TOKEN", "CLIENT_SECRET", "SESSION_SECRET", "DASHBOARD_KEY", "REDIRECT_URI"];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]?.trim());

if (missingEnv.length) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH + ".tmp", JSON.stringify(cfg, null, 2));
  fs.renameSync(CONFIG_PATH + ".tmp", CONFIG_PATH);
}
let config = loadConfig();

const rpc = new RPCManager();
function rpcActivityFromConfig(cfg) {
  const a = {};
  if (cfg.details) a.details = cfg.details;
  if (cfg.state) a.state = cfg.state;
  const assets = {};
  if (cfg.largeImage) assets.large_image = cfg.largeImage;
  if (cfg.smallImage) assets.small_image = cfg.smallImage;
  if (Object.keys(assets).length) a.assets = assets;
  if (cfg.startedAt) a.timestamps = { start: Date.now() };
  if (Array.isArray(cfg.buttons) && cfg.buttons.length)
    a.buttons = cfg.buttons.filter(b => b.label && b.url).slice(0, 2);
  return a;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function buildActivity(cfg) {
  const type = Number(cfg.type) || 0;
  const activity = { name: cfg.name || "...", type };
  if (cfg.state) activity.state = cfg.state;
  if (cfg.details && type !== 4) activity.details = cfg.details;
  if (type === 1 && cfg.url) activity.url = cfg.url;
  const assets = {};
  if (cfg.largeImage) assets.large_image = cfg.largeImage;
  if (cfg.smallImage) assets.small_image = cfg.smallImage;
  if (Object.keys(assets).length) activity.assets = assets;
  if (cfg.startedAt) activity.timestamps = { start: Date.now() };
  return activity;
}

function applyPresence() {
  const activity = config.name ? buildActivity(config) : null;
  if (client.user) {
    client.user.setPresence({
      status: ["online", "idle", "dnd", "invisible"].includes(config.status) ? config.status : "online",
      activities: activity ? [activity] : []
    }).catch(console.error);
  }
  rpc.broadcast(activity ? rpcActivityFromConfig(config) : null);
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  rpc.connectAll().then(applyPresence);
});
client.login(process.env.DISCORD_TOKEN).catch(e => {
  console.error("Discord login failed:", e.message);
  process.exit(1);
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 }
}));

function requireAuth(req, res, next) {
  if (req.session.authed) return next();
  return res.redirect("/login");
}

app.get("/health", (req, res) => res.sendStatus(200));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "views", "login.html")));
app.post("/login", (req, res) => {
  if (req.body.key === process.env.DASHBOARD_KEY) {
    req.session.authed = true;
    return res.redirect("/");
  }
  res.redirect("/login?error=1");
});
app.post("/logout", (req, res) => { req.session.destroy(() => res.redirect("/login")); });

app.get("/", requireAuth, (req, res) => {
  res.send(
    fs.readFileSync(path.join(__dirname, "views", "dashboard.html"), "utf8")
      .replace("{{INVITE_URL}}", `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot&permissions=0`)
      .replace("{{BOT_TAG}}", client.user ? client.user.tag : "starting...")
  );
});

app.get("/api/rpc/authorize", requireAuth, (req, res) => {
  req.session.oauthState = crypto.randomBytes(16).toString("hex");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", process.env.REDIRECT_URI);
  url.searchParams.set("scope", "rpc");
  url.searchParams.set("state", req.session.oauthState);
  res.redirect(url.toString());
});

app.get("/api/rpc/callback", async (req, res) => {
  try {
    if (!req.session.oauthState || req.query.state !== req.session.oauthState)
      return res.status(400).send("Invalid OAuth state.");
    req.session.oauthState = null;
    const tokenResp = await exchangeCode(req.query.code);
    const me = await fetchMe(tokenResp.access_token);
    await rpc.addUser(me.id, me.username, tokenResp);
    res.redirect("/?connected=" + encodeURIComponent(me.username));
  } catch (e) {
    console.error("OAuth callback failed:", e.message);
    res.status(500).send("Authorization failed: " + e.message);
  }
});

app.post("/api/rpc/disconnect", requireAuth, (req, res) => {
  rpc.removeUser(String(req.body.userId || ""));
  res.json({ ok: true });
});

app.get("/api/rpc/users", requireAuth, (req, res) => res.json(rpc.listUsers()));

const TYPES = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
function sanitize(body) {
  const buttons = [];
  for (let i = 1; i <= 2; i++) {
    const label = String(body["btn" + i + "Label"] || "").slice(0, 30);
    const url = String(body["btn" + i + "Url"] || "").slice(0, 512);
    if (/^https?:\/\//.test(url)) buttons.push({ label: label || "Click", url });
  }
  const out = {
    name: String(body.name || "").slice(0, 128),
    type: TYPES[body.type] !== undefined ? Number(body.type) : 0,
    state: String(body.state || "").slice(0, 128),
    details: String(body.details || "").slice(0, 128),
    status: ["online", "idle", "dnd", "invisible"].includes(body.status) ? body.status : "online",
    url: String(body.url || "").slice(0, 512),
    appId: String(body.appId || "").replace(/[^0-9]/g, "").slice(0, 20),
    largeImage: String(body.largeImage || "").slice(0, 256),
    smallImage: String(body.smallImage || "").slice(0, 256),
    startedAt: !!body.startedAt,
    buttons
  };
  if (out.type !== 1) out.url = "";
  return out;
}

app.get("/api/presence", requireAuth, (req, res) => res.json(config));

app.post("/api/presence", requireAuth, (req, res) => {
  config = sanitize(req.body);
  if (!config.name) return res.status(400).json({ ok: false, error: "Activity name is required." });
  saveConfig(config);
  applyPresence();
  res.json({ ok: true, config });
});

app.post("/api/presence/clear", requireAuth, (req, res) => {
  config.name = "";
  saveConfig(config);
  applyPresence();
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
