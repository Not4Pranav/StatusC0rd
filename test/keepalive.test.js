"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { KeepAlive, MIN_INTERVAL_MINUTES } = require("../src/keepalive");

const silent = { warn() {}, log() {}, error() {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("does not run without a public url", () => {
  const keepAlive = new KeepAlive({ logger: silent, fetchImpl: async () => ({ ok: true }) });
  const state = keepAlive.configure({ enabled: true, intervalMinutes: 10, publicUrl: "" });
  assert.equal(state.enabled, false);
  assert.equal(state.target, null);
  keepAlive.stop();
});

test("pings /health on the public url", async () => {
  const calls = [];
  const keepAlive = new KeepAlive({
    logger: silent,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200 };
    }
  });
  keepAlive.configure({ enabled: true, intervalMinutes: 10, publicUrl: "https://status.example.com/" });
  await keepAlive.ping();

  // configure() fires one immediate ping to validate the URL, then our explicit one
  assert.deepEqual(calls, [
    "https://status.example.com/health",
    "https://status.example.com/health"
  ]);
  const state = keepAlive.getState();
  assert.equal(state.enabled, true);
  assert.equal(state.lastStatus, 200);
  assert.ok(state.lastOkAt);
  keepAlive.stop();
});

test("clamps the interval so it never spams the host", () => {
  const keepAlive = new KeepAlive({ logger: silent, fetchImpl: async () => ({ ok: true }) });
  const state = keepAlive.configure({ enabled: true, intervalMinutes: 1, publicUrl: "https://x.dev" });
  assert.equal(state.intervalMinutes, MIN_INTERVAL_MINUTES);
  keepAlive.stop();
});

test("counts consecutive failures and warns once", async () => {
  const warnings = [];
  const keepAlive = new KeepAlive({
    logger: { ...silent, warn: (message) => warnings.push(message) },
    fetchImpl: async () => {
      throw new Error("network down");
    }
  });
  keepAlive.configure({ enabled: true, intervalMinutes: 10, publicUrl: "https://x.dev" });
  for (let i = 0; i < 2; i += 1) await keepAlive.ping();

  const state = keepAlive.getState();
  assert.equal(state.consecutiveFailures, 3);
  assert.equal(state.lastStatus, "error");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cannot reach/);
  keepAlive.stop();
});

test("stops cleanly", async () => {
  let calls = 0;
  const keepAlive = new KeepAlive({
    logger: silent,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200 };
    }
  });
  keepAlive.configure({ enabled: true, intervalMinutes: 5, publicUrl: "https://x.dev" });
  keepAlive.stop();
  const before = calls;
  await wait(20);
  assert.equal(calls, before);
});
