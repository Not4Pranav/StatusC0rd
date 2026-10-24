"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { safeEqual, RateLimiter, LoginLimiter, ensureCsrf, requireCsrf } = require("../src/auth");

test("safeEqual compares strings without leaking length", () => {
  assert.equal(safeEqual("secret", "secret"), true);
  assert.equal(safeEqual("secret", "secreT"), false);
  assert.equal(safeEqual("secret", "secret "), false);
  assert.equal(safeEqual("", ""), false);
  assert.equal(safeEqual(undefined, "x"), false);
});

test("RateLimiter blocks after the configured number of hits", () => {
  let time = 0;
  const limiter = new RateLimiter({ windowMs: 1000, max: 3, now: () => time });

  assert.equal(limiter.hit("ip").allowed, true);
  assert.equal(limiter.hit("ip").allowed, true);
  assert.equal(limiter.hit("ip").allowed, true);
  const blocked = limiter.hit("ip");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 1000);

  // Other clients are unaffected.
  assert.equal(limiter.check("other").allowed, true);

  time = 1001;
  assert.equal(limiter.check("ip").allowed, true);
});

test("RateLimiter middleware returns 429 with Retry-After", () => {
  let time = 0;
  const limiter = new RateLimiter({ windowMs: 60_000, max: 1, now: () => time });
  const middleware = limiter.middleware();
  const headers = {};
  const req = { path: "/api/x", ip: "1.2.3.4", accepts: () => "json" };
  const res = {
    setHeader: (key, value) => {
      headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  middleware(req, res, () => {
    res.nextCalled = true;
  });
  assert.equal(res.nextCalled, true);

  middleware(req, res, () => {});
  assert.equal(res.statusCode, 429);
  assert.equal(headers["Retry-After"], "60");
});

test("LoginLimiter locks out after repeated failures and resets on success", () => {
  let time = 0;
  const limiter = new LoginLimiter({ max: 3, windowMs: 1000, blockMs: 5000, now: () => time });

  limiter.fail("ip");
  limiter.fail("ip");
  assert.equal(limiter.status("ip").blocked, false);
  const after = limiter.fail("ip");
  assert.equal(after.blocked, true);
  assert.equal(limiter.status("ip").blocked, true);

  limiter.reset("ip");
  assert.equal(limiter.status("ip").blocked, false);
});

test("LoginLimiter block expires", () => {
  let time = 0;
  const limiter = new LoginLimiter({ max: 1, windowMs: 1000, blockMs: 5000, now: () => time });
  limiter.fail("ip");
  assert.equal(limiter.status("ip").blocked, true);
  time = 5001;
  assert.equal(limiter.status("ip").blocked, false);
});

test("ensureCsrf creates and reuses a token", () => {
  const req = { session: {} };
  const first = ensureCsrf(req);
  assert.match(first, /^[a-f0-9]{48}$/);
  assert.equal(ensureCsrf(req), first);
});

test("requireCsrf accepts a matching header and rejects everything else", () => {
  const token = "a".repeat(48);
  const req = {
    method: "POST",
    path: "/api/presence",
    session: { csrf: token },
    body: {},
    query: {},
    get(name) {
      return name === "x-csrf-token" ? token : undefined;
    },
    accepts: () => "json"
  };
  let called = 0;
  requireCsrf(req, {}, () => {
    called += 1;
  });
  assert.equal(called, 1);

  const badReq = {
    ...req,
    get: () => "wrong",
    accepts: () => "json",
    body: {}
  };
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  requireCsrf(badReq, res, () => {
    throw new Error("should not pass");
  });
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /CSRF/);
});

test("requireCsrf ignores safe methods", () => {
  let called = 0;
  requireCsrf({ method: "GET", path: "/", session: {} }, {}, () => {
    called += 1;
  });
  assert.equal(called, 1);
});
