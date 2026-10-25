"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { BotWorker, clampPollSeconds } = require("../src/worker");

/** A DiscordBot stand-in that records what the worker asked it to show. */
function fakeBot({ state = { status: "online", connected: true, tag: "StatusC0rd#0001" } } = {}) {
  const bot = new EventEmitter();
  bot.applied = [];
  bot.cleared = [];
  bot.started = 0;
  bot.stopped = 0;
  bot.getState = () => ({ ...state, lastActivity: bot.applied.at(-1)?.name ?? null });
  bot.setPresence = (config) => bot.applied.push(config);
  bot.clearPresence = (status) => bot.cleared.push(status);
  bot.start = async () => { bot.started += 1; };
  bot.stop = async () => { bot.stopped += 1; };
  return bot;
}

function fakeFetch({ card = { name: "Working", enabled: true, targets: { bot: true } }, cardStatus = 200 } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/api/bot/card")) {
      if (cardStatus !== 200) {
        return { status: cardStatus, ok: false, json: async () => ({ ok: false, error: "nope" }) };
      }
      return { status: 200, ok: true, json: async () => ({ ok: true, presence: card }) };
    }
    return { status: 200, ok: true, json: async () => ({ ok: true }) };
  };
  impl.calls = calls;
  return impl;
}

test("the worker polls the site, applies the card and reports back", async () => {
  const bot = fakeBot();
  const fetchImpl = fakeFetch({ card: { name: "Building", enabled: true, targets: { bot: true }, status: "idle" } });
  const worker = new BotWorker({ bot, baseUrl: "https://site.example/", token: "t".repeat(32), fetchImpl, pollSeconds: 5 });
  const state = await worker.start();
  await worker.stop();

  assert.equal(bot.started, 1);
  assert.equal(bot.stopped, 1, "stopping the worker stops the gateway");
  assert.equal(bot.applied.length, 1);
  assert.equal(bot.applied[0].name, "Building");
  assert.equal(state.card, "Building");

  const reads = fetchImpl.calls.filter((call) => call.url.endsWith("/api/bot/card"));
  assert.equal(reads[0].url, "https://site.example/api/bot/card", "a trailing slash is normalised away");
  assert.equal(reads[0].init.headers.authorization, `Bearer ${"t".repeat(32)}`);

  const report = fetchImpl.calls.find((call) => call.url.endsWith("/api/bot/status"));
  assert.ok(report, "the website is told the bot is online");
  const sent = JSON.parse(report.init.body);
  assert.equal(sent.connected, true);
  assert.equal(sent.tag, "StatusC0rd#0001");
});

test("a card that is switched off, or not aimed at the bot, clears the presence", async () => {
  for (const card of [
    { name: "Off", enabled: false, status: "dnd", targets: { bot: true } },
    { name: "Elsewhere", enabled: true, status: "online", targets: { bot: false } }
  ]) {
    const bot = fakeBot();
    const worker = new BotWorker({ bot, baseUrl: "https://site.example", token: "t".repeat(32), fetchImpl: fakeFetch({ card }), pollSeconds: 5 });
    await worker.tick();
    worker.stopping = true;
    assert.equal(bot.applied.length, 0, `${card.name} must not be applied`);
    assert.equal(bot.cleared.length, 1);
    assert.equal(bot.cleared[0], card.status);
  }
});

test("a wrong worker token is reported once and backed off, not hammered", async () => {
  const errors = [];
  const bot = fakeBot();
  const fetchImpl = fakeFetch({ cardStatus: 401 });
  const worker = new BotWorker({
    bot,
    baseUrl: "https://site.example",
    token: "t".repeat(32),
    fetchImpl,
    pollSeconds: 5,
    logger: { error: (message) => errors.push(message), warn: () => {} }
  });
  await worker.tick();
  await worker.tick();
  worker.stopping = true;

  assert.equal(worker.state.unauthorized, true);
  assert.equal(errors.length, 1, "the same mistake is logged once");
  assert.match(errors[0], /BOT_WORKER_TOKEN/);
  assert.equal(bot.applied.length, 0);
});

test("a failing fetch backs off and keeps the last good card", async () => {
  const bot = fakeBot();
  let fail = false;
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url.endsWith("/api/bot/card")) {
      if (fail) throw new Error("getaddrinfo ENOTFOUND site.example");
      return { status: 200, ok: true, json: async () => ({ ok: true, presence: { name: "Last good", enabled: true } }) };
    }
    return { status: 200, ok: true, json: async () => ({ ok: true }) };
  };
  const worker = new BotWorker({ bot, baseUrl: "https://site.example", token: "t".repeat(32), fetchImpl, pollSeconds: 5, logger: { warn: () => {}, error: () => {} } });
  await worker.tick();
  fail = true;
  await worker.tick();
  worker.stopping = true;

  assert.equal(worker.state.card, "Last good");
  assert.match(worker.state.error, /ENOTFOUND/);
  assert.ok(calls >= 3);
});

test("the worker refuses to run without its three settings", async () => {
  const bot = fakeBot();
  const worker = new BotWorker({ bot, baseUrl: "", token: "", fetchImpl: fakeFetch() });
  await assert.rejects(() => worker.start(), /BOT_URL and BOT_WORKER_TOKEN/);
});

test("the poll interval is clamped to something Discord and a free host both survive", () => {
  assert.equal(clampPollSeconds(undefined), 10);
  assert.equal(clampPollSeconds("1"), 5);
  assert.equal(clampPollSeconds(9999), 300);
  assert.equal(clampPollSeconds(30), 30);
});
