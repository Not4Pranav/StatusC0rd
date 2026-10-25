"use strict";

const crypto = require("node:crypto");

/**
 * Constant-time string comparison.
 * Hashing first keeps the comparison time independent of the input length.
 */
function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const right = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(left, right) && String(a ?? "").length > 0;
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * In-memory sliding-window limiter, keyed by client identity.
 * Node's event loop is single threaded, so no locking is required.
 */
class RateLimiter {
  constructor({ windowMs = 60_000, max = 30, now = Date.now } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.hits = new Map();
  }

  /** @returns {{allowed: boolean, retryAfterMs: number, remaining: number}} */
  check(key) {
    const now = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      return { allowed: true, retryAfterMs: 0, remaining: this.max };
    }
    if (entry.count >= this.max) {
      return { allowed: false, retryAfterMs: entry.resetAt - now, remaining: 0 };
    }
    return { allowed: true, retryAfterMs: 0, remaining: this.max - entry.count };
  }

  /**
   * Record one hit if the client is still under the limit.
   * `max` requests are allowed per window; request `max + 1` is rejected.
   */
  hit(key) {
    const status = this.check(key);
    if (!status.allowed) return status;

    const now = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
    this.prune(now);
    const current = this.hits.get(key);
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: Math.max(0, this.max - current.count)
    };
  }

  reset(key) {
    this.hits.delete(key);
  }

  prune(now = this.now()) {
    if (this.hits.size < 500) return;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }

  /** Express middleware that rejects over-limit requests with 429. */
  middleware({ message = "Too many requests. Please slow down." } = {}) {
    return (req, res, next) => {
      const result = this.hit(req.ip || req.socket?.remoteAddress || "unknown");
      if (result.allowed) {
        res.setHeader("RateLimit-Remaining", String(result.remaining));
        return next();
      }
      res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      if (req.path.startsWith("/api/") || req.accepts(["json", "html"]) === "json") {
        return res.status(429).json({ ok: false, error: message });
      }
      return res.status(429).type("text").send(message);
    };
  }
}

/**
 * Brute-force protection for the dashboard key.
 * Failures are counted per client; a correct key clears the counter.
 */
class LoginLimiter {
  constructor({ max = 5, windowMs = 15 * 60_000, blockMs = 15 * 60_000, now = Date.now } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.blockMs = blockMs;
    this.now = now;
    this.failures = new Map();
  }

  status(key) {
    const now = this.now();
    const entry = this.failures.get(key);
    if (!entry) return { blocked: false, retryAfterMs: 0, attemptsLeft: this.max };
    if (entry.blockedUntil > now) {
      return { blocked: true, retryAfterMs: entry.blockedUntil - now, attemptsLeft: 0 };
    }
    if (entry.resetAt <= now) {
      this.failures.delete(key);
      return { blocked: false, retryAfterMs: 0, attemptsLeft: this.max };
    }
    return { blocked: false, retryAfterMs: 0, attemptsLeft: Math.max(0, this.max - entry.count) };
  }

  fail(key) {
    const now = this.now();
    let entry = this.failures.get(key);
    if (!entry || (entry.resetAt <= now && entry.blockedUntil <= now)) {
      entry = { count: 0, resetAt: now + this.windowMs, blockedUntil: 0 };
      this.failures.set(key, entry);
    }
    if (entry.blockedUntil <= now) {
      entry.count += 1;
      if (entry.count >= this.max) {
        entry.count = 0;
        entry.blockedUntil = now + this.blockMs;
        entry.resetAt = now + this.blockMs;
      }
    }
    if (this.failures.size > 1000) {
      for (const [k, v] of this.failures) {
        if (v.resetAt <= now && v.blockedUntil <= now) this.failures.delete(k);
      }
    }
    return this.status(key);
  }

  reset(key) {
    this.failures.delete(key);
  }
}

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/** Returns an existing CSRF token or creates one on the session. */
function ensureCsrf(req) {
  if (!req.session) throw new Error("ensureCsrf requires a session");
  if (!req.session.csrf) req.session.csrf = randomToken(24);
  return req.session.csrf;
}

/**
 * Double-submit CSRF protection for state-changing requests.
 * The token is delivered in the page itself (meta tag / hidden input) and
 * echoed back in the `x-csrf-token` header or `_csrf` body field.
 */
function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const expected = req.session?.csrf;
  if (!expected) return deny(req, res, "Invalid or missing CSRF token. Reload the page and try again.", 403);
  // Header or form body only. A token in the query string leaks into server
  // logs, browser history and Referer headers, which is exactly what a CSRF
  // token must never do.
  const supplied = req.get("x-csrf-token") || req.body?._csrf;
  if (typeof supplied === "string" && safeEqual(supplied, expected)) return next();
  return deny(req, res, "Invalid or missing CSRF token. Reload the page and try again.", 403);
}

function deny(req, res, message, status) {
  const wantsJson = req.path.startsWith("/api/") || req.get("accept")?.includes("application/json");
  if (wantsJson) return res.status(status).json({ ok: false, error: message });
  return res.status(status).type("text").send(message);
}

/** The signed-in identity as the browser may see it: no email, no hashes. */
function publicUser(req) {
  const user = req.session?.user;
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    avatar: user.avatar || null,
    via: user.via
  };
}

module.exports = {
  safeEqual,
  randomToken,
  RateLimiter,
  LoginLimiter,
  clientKey,
  ensureCsrf,
  requireCsrf,
  publicUser
};
