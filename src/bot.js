"use strict";

const { EventEmitter } = require("node:events");
const { buildActivity, STATUSES } = require("./presence");

const MIN_PRESENCE_INTERVAL_MS = 4_500; // Discord allows ~5 presence updates per 20s.
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

/**
 * Serialises presence updates so bursts of saves cannot trip Discord's
 * presence rate limit. Only the most recent payload is ever sent.
 */
class PresenceQueue {
  constructor({ apply, minIntervalMs = MIN_PRESENCE_INTERVAL_MS, logger = console } = {}) {
    this.apply = apply;
    this.minIntervalMs = minIntervalMs;
    this.logger = logger;
    this.pending = null;
    this.timer = null;
    this.lastSentAt = 0;
  }

  push(payload) {
    this.pending = payload;
    this._schedule();
  }

  _schedule() {
    if (this.timer || !this.pending) return;
    const wait = Math.max(0, this.lastSentAt + this.minIntervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this._flush();
    }, wait);
    this.timer.unref?.();
  }

  async _flush() {
    if (!this.pending) return;
    const payload = this.pending;
    this.pending = null;
    this.lastSentAt = Date.now();
    try {
      await this.apply(payload);
    } catch (error) {
      this.logger.error?.("[presence] update failed:", error.message);
    }
    if (this.pending) this._schedule();
  }

  /** Immediately send the pending payload (used on shutdown/tests). */
  async flushNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastSentAt = 0;
    await this._flush();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

function defaultClientFactory() {
  // Loaded lazily so the dashboard can run without a bot (and tests stay fast).
  const { Client, GatewayIntentBits } = require("discord.js");
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

/**
 * Owns the Discord gateway connection and keeps the bot's presence in sync with
 * the dashboard configuration. Network failures never crash the dashboard.
 */
class DiscordBot extends EventEmitter {
  constructor({ token, clientId = "", enabled = true, logger = console, clientFactory, presenceIntervalMs } = {}) {
    super();
    this.token = token;
    this.clientId = clientId;
    this.enabled = Boolean(enabled) && Boolean(token);
    this.logger = logger;
    this.clientFactory = clientFactory || defaultClientFactory;
    this.client = null;
    this.retryDelay = RETRY_BASE_MS;
    this.retryTimer = null;
    this.connecting = false;
    this.stopping = false;
    this.desired = { activity: null, status: "online" };
    this.startedAt = new Date().toISOString();

    this.note = this.enabled
      ? null
      : token
        ? "Bot disabled with BOT_ENABLED=false - the dashboard still works."
        : "No DISCORD_TOKEN configured - running in dashboard-only mode.";

    this.state = {
      enabled: this.enabled,
      status: this.enabled ? "idle" : "disabled",
      connected: false,
      tag: null,
      id: null,
      error: null,
      note: this.note,
      lastAppliedAt: null,
      lastActivity: null
    };

    this.queue = new PresenceQueue({
      apply: (payload) => this._applyPresence(payload),
      logger,
      minIntervalMs: presenceIntervalMs ?? MIN_PRESENCE_INTERVAL_MS
    });
  }

  getState() {
    return {
      ...this.state,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(this.startedAt)) / 1000)),
      pending: Boolean(this.queue.pending || this.queue.timer)
    };
  }

  _setState(patch) {
    const next = { ...this.state, ...patch };
    const changed = Object.keys(patch).some((key) => this.state[key] !== next[key]);
    this.state = next;
    if (changed) this.emit("state", this.getState());
  }

  async start() {
    if (!this.enabled) {
      this.logger.warn?.("[bot] disabled - running in dashboard-only mode.");
      return this.getState();
    }
    await this._connect();
    return this.getState();
  }

  async _connect() {
    if (this.connecting || this.stopping) return;
    this.connecting = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;

    const client = this.clientFactory();
    this.client = client;
    // A token swap destroys the old client but its event listeners can still
    // fire afterwards; ignore anything that does not belong to the live client.
    const isCurrent = () => this.client === client;
    this._setState({ status: this.state.connected ? "reconnecting" : "connecting", error: null });

    client.once("clientReady", () => {
      if (isCurrent()) this._onReady();
    });
    client.on("error", (error) => {
      if (isCurrent()) this._onClientError(error);
    });
    client.on("shardError", (error) => {
      if (isCurrent()) this._onClientError(error);
    });
    client.on("shardDisconnect", () => {
      if (isCurrent()) this._setState({ connected: false, status: "reconnecting" });
    });
    client.on("shardResume", () => {
      if (!isCurrent()) return;
      this._setState({ connected: true, status: "online", error: null });
      this._applyDesired();
    });
    client.on("invalidated", () => {
      if (!isCurrent()) return;
      this._setState({ connected: false, status: "error", error: "Discord invalidated the session." });
      this._scheduleRetry();
    });

    try {
      await client.login(this.token);
    } catch (error) {
      if (isCurrent()) {
        this._onClientError(error);
        this._scheduleRetry();
      }
    } finally {
      this.connecting = false;
    }
  }

  _onReady() {
    const user = this.client?.user;
    this.retryDelay = RETRY_BASE_MS;
    this._setState({
      status: "online",
      connected: true,
      error: null,
      tag: user?.tag ?? null,
      id: user?.id ?? null
    });
    this.logger.log?.(`[bot] logged in as ${user?.tag ?? "unknown user"}`);
    this.emit("ready", this.getState());
    this._applyDesired();
  }

  _onClientError(error) {
    const message = error?.message || String(error);
    // Avoid log spam when the same failure repeats on every retry.
    if (this.state.error !== message) {
      this.logger.error?.(`[bot] ${message}`);
    }
    this._setState({ error: message, connected: false, status: this.state.tag ? "reconnecting" : "error" });
  }

  _scheduleRetry() {
    if (this.stopping || !this.enabled) return;
    clearTimeout(this.retryTimer);
    const delay = this.retryDelay;
    this.retryDelay = Math.min(RETRY_MAX_MS, this.retryDelay * 2);
    this.logger.warn?.(`[bot] retrying in ${Math.round(delay / 1000)}s`);
    this.retryTimer = setTimeout(() => {
      // A failed client cannot be reused; drop it before reconnecting.
      try {
        this.client?.destroy();
      } catch {
        /* ignore */
      }
      this.client = null;
      void this._connect();
    }, delay);
    this.retryTimer.unref?.();
  }

  /**
   * Point the bot at a new presence configuration.
   * @param {object} config presence config (see presence.js)
   */
  setPresence(config) {
    const status = STATUSES.includes(config?.status) ? config.status : "online";
    const activity = buildActivity(config);
    this.desired = { activity, status };
    if (!this.enabled || !this.state.connected) return;
    this.queue.push(this.desired);
  }

  /** Remove the activity, optionally changing the status. */
  clearPresence(status = "online") {
    this.desired = { activity: null, status: STATUSES.includes(status) ? status : "online" };
    if (!this.enabled || !this.state.connected) return;
    this.queue.push(this.desired);
  }

  _applyDesired() {
    if (this.state.connected) this.queue.push(this.desired);
  }

  async _applyPresence({ activity, status }) {
    const user = this.client?.user;
    if (!user) throw new Error("bot user is not available yet");
    await user.setPresence({
      activities: activity ? [activity] : [],
      status: STATUSES.includes(status) ? status : "online"
    });
    this._setState({
      lastAppliedAt: new Date().toISOString(),
      lastActivity: activity ? activity.name : null
    });
  }

  /**
   * Swap credentials at runtime (used by the setup wizard and settings page).
   * @param {{token: string, enabled?: boolean}} credentials
   */
  async reconfigure({ token = this.token, enabled = this.enabled } = {}) {
    const nextToken = String(token || "").trim();
    const nextEnabled = Boolean(enabled && nextToken);
    if (nextToken === this.token && nextEnabled === this.enabled) return this.getState();

    await this.stop();
    this.token = nextToken;
    this.enabled = nextEnabled;
    this.stopping = false;
    this.connecting = false;
    this.retryDelay = RETRY_BASE_MS;
    this.note = nextEnabled
      ? null
      : nextToken
        ? "Bot disabled with BOT_ENABLED=false - the dashboard still works."
        : "No bot token configured - the dashboard works, but the bot is offline.";

    this._setState({
      enabled: nextEnabled,
      status: nextEnabled ? "idle" : "disabled",
      connected: false,
      tag: nextEnabled ? null : this.state.tag,
      error: null,
      note: this.note
    });

    if (nextEnabled) await this._connect();
    return this.getState();
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.queue.stop();
    this._setState({ status: "stopped", connected: false });
    try {
      this.client?.destroy();
    } catch {
      /* ignore */
    }
    this.client = null;
  }
}

module.exports = { DiscordBot, PresenceQueue, MIN_PRESENCE_INTERVAL_MS };
