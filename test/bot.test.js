"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { DiscordBot, PresenceQueue } = require("../src/bot");

const silent = { log() {}, warn() {}, error() {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeClient extends EventEmitter {
  constructor({ failLogin = false } = {}) {
    super();
    this.failLogin = failLogin;
    this.presences = [];
    this.loginCalls = 0;
    this.destroyed = false;
    this.user = {
      tag: "StatusC0rd#0001",
      id: "1554342719923560518",
      setPresence: async (payload) => {
        this.presences.push(payload);
      }
    };
  }

  async login(token) {
    this.loginCalls += 1;
    this.token = token;
    if (this.failLogin) throw new Error("An invalid token was provided.");
    setImmediate(() => this.emit("clientReady"));
  }

  destroy() {
    this.destroyed = true;
  }
}

test("PresenceQueue coalesces rapid updates", async () => {
  const applied = [];
  const queue = new PresenceQueue({
    apply: async (payload) => applied.push(payload),
    minIntervalMs: 5,
    logger: silent
  });

  queue.push({ name: "one" });
  queue.push({ name: "two" });
  queue.push({ name: "three" });
  await wait(25);

  assert.deepEqual(applied, [{ name: "three" }]);
  queue.stop();
});

test("PresenceQueue sends a later update once the interval has passed", async () => {
  const applied = [];
  const queue = new PresenceQueue({
    apply: async (payload) => applied.push(payload),
    minIntervalMs: 10,
    logger: silent
  });

  queue.push({ name: "first" });
  await wait(20);
  queue.push({ name: "second" });
  await wait(40);

  assert.deepEqual(applied.map((entry) => entry.name), ["first", "second"]);
  queue.stop();
});

test("bot signs in, applies presence and clears it", async (t) => {
  const client = new FakeClient();
  const bot = new DiscordBot({
    token: "token",
    enabled: true,
    logger: silent,
    clientFactory: () => client,
    presenceIntervalMs: 5
  });
  t.after(() => bot.stop());

  await bot.start();
  await wait(10);

  assert.equal(bot.getState().status, "online");
  assert.equal(bot.getState().tag, "StatusC0rd#0001");

  bot.setPresence({ enabled: true, name: "Chess", type: 5, status: "idle" });
  await wait(25);

  const last = client.presences.at(-1);
  assert.equal(last.status, "idle");
  assert.deepEqual(last.activities, [{ name: "Chess", type: 5 }]);

  bot.clearPresence("online");
  await wait(25);
  assert.deepEqual(client.presences.at(-1).activities, []);
  assert.equal(client.presences.at(-1).status, "online");
});

test("bot reports login failures without crashing", async (t) => {
  const client = new FakeClient({ failLogin: true });
  const bot = new DiscordBot({
    token: "bad",
    enabled: true,
    logger: silent,
    clientFactory: () => client,
    presenceIntervalMs: 5
  });
  t.after(() => bot.stop());

  const state = await bot.start();
  assert.equal(state.status, "error");
  assert.equal(state.connected, false);
  assert.match(state.error, /invalid token/i);

  await bot.stop();
  assert.equal(client.destroyed, true);
  assert.equal(bot.getState().status, "stopped");
});

test("dashboard-only mode never connects", async () => {
  let created = 0;
  const bot = new DiscordBot({
    token: "",
    enabled: false,
    logger: silent,
    clientFactory: () => {
      created += 1;
      return new FakeClient();
    }
  });

  const state = await bot.start();
  assert.equal(state.status, "disabled");
  assert.equal(state.enabled, false);
  assert.equal(created, 0);
  await bot.stop();
});

test("a gateway blip re-applies the presence once the shard resumes", async (t) => {
  const client = new FakeClient();
  const bot = new DiscordBot({
    token: "token",
    enabled: true,
    logger: silent,
    clientFactory: () => client,
    presenceIntervalMs: 5
  });
  t.after(() => bot.stop());

  await bot.start();
  await wait(10);
  bot.setPresence({ enabled: true, name: "Always on", type: 0, status: "online" });
  await wait(25);
  const sentBefore = client.presences.length;
  assert.ok(sentBefore >= 1);

  // Discord drops the websocket, then resumes it: the bot must go back online
  // and push the current activity again without the dashboard doing anything.
  client.emit("shardDisconnect");
  assert.equal(bot.getState().connected, false);
  assert.equal(bot.getState().status, "reconnecting");

  client.emit("shardResume");
  await wait(25);

  assert.equal(bot.getState().connected, true);
  assert.equal(bot.getState().status, "online");
  assert.ok(client.presences.length > sentBefore, "presence re-sent after resume");
  assert.equal(client.presences.at(-1).activities[0].name, "Always on");
});

test("a client replaced by a token swap cannot overwrite the live state", async (t) => {
  const clients = [];
  const bot = new DiscordBot({
    token: "first-token",
    enabled: true,
    logger: silent,
    clientFactory: () => {
      const client = new FakeClient();
      clients.push(client);
      return client;
    },
    presenceIntervalMs: 5
  });
  t.after(() => bot.stop());

  await bot.start();
  await wait(10);
  assert.equal(clients.length, 1);

  await bot.reconfigure({ token: "second-token" });
  await wait(10);
  assert.equal(clients.length, 2, "a new client was created for the new token");
  assert.equal(bot.getState().status, "online");

  // The discarded client still emits an error; it must not mark the bot failed.
  clients[0].emit("shardError", new Error("old client blew up"));
  clients[0].emit("shardDisconnect");
  await wait(10);
  assert.equal(bot.getState().status, "online");
  assert.equal(bot.getState().error, null);
  assert.equal(bot.getState().connected, true);
});
