"use strict";

/**
 * The split-hosting worker.
 *
 * Normally the bot lives inside the web process: one deployment, one token, one
 * card. That is the simplest thing, and it is what the docs recommend until you
 * have a reason not to.
 *
 * The reason is cost and uptime. A free web host sleeps, and a sleeping process
 * has no gateway connection, so the 24/7 card goes away with it. A worker is the
 * other half of the app: it holds only the Discord connection, fetches the card
 * from the website every few seconds, and reports back whether the bot is online
 * so the dashboard can show the truth. It is small enough to live on the smallest
 * free instance, and it never needs a disk.
 *
 * Nothing here is secret-bearing beyond the bot token and the shared worker
 * token, and neither is ever returned to a browser.
 */

const DEFAULT_POLL_SECONDS = 10;
const MIN_POLL_SECONDS = 5;
const MAX_POLL_SECONDS = 300;
/** Wait longer after a failure, so a sleeping website is not hammered. */
const MAX_BACKOFF_MS = 60_000;

function clampPollSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_POLL_SECONDS;
  return Math.max(MIN_POLL_SECONDS, Math.min(MAX_POLL_SECONDS, Math.round(seconds)));
}

class BotWorker {
  /**
   * @param {object} options
   * @param {object} options.bot      a DiscordBot instance (not started)
   * @param {string} options.baseUrl  the website, e.g. https://status.example
   * @param {string} options.token    the shared BOT_WORKER_TOKEN
   * @param {number} [options.pollSeconds]
   * @param {Function} [options.fetchImpl] injectable for tests
   */
  constructor({ bot, baseUrl, token, pollSeconds = DEFAULT_POLL_SECONDS, logger = console, fetchImpl } = {}) {
    this.bot = bot;
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.token = String(token || "");
    this.pollSeconds = clampPollSeconds(pollSeconds);
    this.logger = logger;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.timer = null;
    this.stopping = false;
    this.failures = 0;
    this.state = {
      startedAt: null,
      lastCardAt: null,
      lastReportAt: null,
      card: null,
      error: null,
      unauthorized: false
    };
  }

  get configured() {
    return Boolean(this.baseUrl && this.token);
  }

  async start() {
    if (!this.configured) {
      throw new Error("The bot worker needs BOT_URL and BOT_WORKER_TOKEN.");
    }
    this.state.startedAt = new Date().toISOString();
    // Report the connection state as it changes, not on a timer: the dashboard
    // should say "online" the moment Discord accepts the session.
    this.bot.on("ready", () => void this.report());
    this.bot.on("state", () => void this.report());
    await this.bot.start();
    await this.tick();
    this._schedule();
    return this.state;
  }

  _schedule(delayMs = this.pollSeconds * 1000) {
    if (this.stopping) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  /** Fetch the card once and apply it. Never throws: a sleeping site is normal. */
  async tick() {
    if (this.stopping) return this.state;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/bot/card`, {
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
        signal: AbortSignal.timeout(15_000)
      });

      if (response.status === 401 || response.status === 403) {
        // A wrong token is a configuration mistake; retrying forever would just
        // fill the host's log. Say it once, keep the bot connected, wait long.
        if (!this.state.unauthorized) {
          this.state.unauthorized = true;
          this.logger.error?.(
            "[worker] the website rejected BOT_WORKER_TOKEN. Set the same value on the website and here."
          );
        }
        this._backoff();
        return this.state;
      }

      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `the website answered ${response.status}`);
      }

      this.state.unauthorized = false;
      this.failures = 0;
      this.state.error = null;
      this.state.lastCardAt = new Date().toISOString();
      this.state.card = body.presence?.name ?? null;
      this._apply(body.presence);
      await this.report();
      this._schedule();
    } catch (error) {
      this.failures += 1;
      const message = error?.message || String(error);
      if (this.state.error !== message) {
        this.logger.warn?.(`[worker] could not read the card: ${message}`);
      }
      this.state.error = message;
      this._backoff();
    }
    return this.state;
  }

  _apply(presence) {
    if (!presence) return;
    // Same rule as the web process: only the owner's card reaches the bot.
    if (presence.enabled === false || presence.targets?.bot === false) {
      this.bot.clearPresence(presence.status || "online");
      return;
    }
    this.bot.setPresence(presence);
  }

  _backoff() {
    this.failures = Math.min(this.failures, 8);
    const delay = Math.min(MAX_BACKOFF_MS, this.pollSeconds * 1000 * 2 ** Math.max(0, this.failures - 1));
    this._schedule(delay);
  }

  /** Tell the website what the gateway is doing, so its dashboard is honest. */
  async report() {
    if (!this.configured) return null;
    const bot = typeof this.bot.getState === "function" ? this.bot.getState() : {};
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/bot/status`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          status: bot.status || "unknown",
          connected: Boolean(bot.connected),
          tag: bot.tag || null,
          error: bot.error || null,
          lastActivity: bot.lastActivity || null
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (response.ok) this.state.lastReportAt = new Date().toISOString();
    } catch {
      // Reporting is best effort: the gateway connection is what matters.
    }
    return this.state.lastReportAt;
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    this.timer = null;
    await this.bot.stop();
  }
}

module.exports = { BotWorker, clampPollSeconds, DEFAULT_POLL_SECONDS };
