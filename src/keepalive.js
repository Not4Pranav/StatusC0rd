"use strict";

/**
 * "24/7 online" helper.
 *
 * Free hosting tiers (Render's free web service, for example) scale an instance
 * to zero after a period without inbound traffic, which also drops the Discord
 * gateway connection. Pinging our own public URL generates that inbound traffic
 * so the process - and the bot - stay online.
 *
 * The ping must go to the *public* URL: a loopback request does not count as
 * activity for the platform.
 */

const MIN_INTERVAL_MINUTES = 5;

class KeepAlive {
  constructor({ getPublicUrl, intervalMinutes = 10, logger = console, fetchImpl = fetch, now = Date.now } = {}) {
    this.getPublicUrl = getPublicUrl;
    this.intervalMinutes = Math.max(MIN_INTERVAL_MINUTES, Number(intervalMinutes) || 10);
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timer = null;
    this.state = {
      enabled: false,
      target: null,
      intervalMinutes: this.intervalMinutes,
      lastPingAt: null,
      lastOkAt: null,
      lastStatus: null,
      consecutiveFailures: 0,
      pings: 0
    };
  }

  getState() {
    return { ...this.state };
  }

  /** (Re)configure from the effective settings. Cheap - safe to call often. */
  configure({ enabled, intervalMinutes, publicUrl }) {
    const nextInterval = Math.max(MIN_INTERVAL_MINUTES, Number(intervalMinutes) || 10);
    const shouldRun = Boolean(enabled && publicUrl);
    const intervalChanged = nextInterval !== this.intervalMinutes;

    this.intervalMinutes = nextInterval;
    this.state.intervalMinutes = this.intervalMinutes;
    this.state.target = publicUrl || null;
    this.state.enabled = shouldRun;

    if (!shouldRun) {
      this.stopTimer();
      this.state.lastStatus = publicUrl ? "paused" : "no-url";
      return this.getState();
    }

    if (!this.timer || intervalChanged) {
      this.stopTimer();
      this.timer = setInterval(() => void this.ping(), this.intervalMinutes * 60_000);
      this.timer.unref?.();
    }
    // Verify the URL right away instead of waiting a full interval.
    if (!this.state.lastPingAt) void this.ping();
    return this.getState();
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async ping() {
    const publicUrl = this.state.target;
    if (!publicUrl) return { ok: false, skipped: true };

    const url = `${String(publicUrl).replace(/\/+$/, "")}/health`;
    this.state.pings += 1;
    this.state.lastPingAt = new Date(this.now()).toISOString();

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { "User-Agent": "StatusC0rd keep-alive" },
        signal: AbortSignal.timeout(10_000)
      });
      this.state.lastStatus = response.status;
      if (response.ok) {
        this.state.lastOkAt = this.state.lastPingAt;
        this.state.consecutiveFailures = 0;
        return { ok: true, status: response.status };
      }
      this.state.consecutiveFailures += 1;
      if (this.state.consecutiveFailures === 3) {
        this.logger.warn?.(`[keep-alive] ${url} returned ${response.status} three times in a row`);
      }
      return { ok: false, status: response.status };
    } catch (error) {
      this.state.consecutiveFailures += 1;
      this.state.lastStatus = "error";
      if (this.state.consecutiveFailures === 3) {
        this.logger.warn?.(`[keep-alive] cannot reach ${url}: ${error.message}`);
      }
      return { ok: false, error: error.message };
    }
  }

  stop() {
    this.stopTimer();
  }
}

module.exports = { KeepAlive, MIN_INTERVAL_MINUTES };
