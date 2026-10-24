"use strict";

/**
 * End-to-end proof of the headline feature: text, photos and buttons configured
 * in the dashboard reach the user's own Discord client.
 *
 * Everything here is real except Discord itself: a temporary UNIX socket
 * emulates `discord-ipc-0`, speaks the actual handshake, and records the
 * SET_ACTIVITY frames the companion sends.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { startApp, PNG_DATA_URL } = require("./helpers");
const { PacketDecoder, encodePacket, OPCODES, start } = require("../src/companion/agent");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeout = 5_000, interval = 25, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await wait(interval);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** A tiny stand-in for the Discord desktop client. */
class FakeDiscord {
  constructor(dir) {
    this.dir = dir;
    this.socketPath = path.join(dir, "discord-ipc-0");
    this.received = [];
    this.sockets = new Set();
    this.server = net.createServer((socket) => this._onConnection(socket));
  }

  async listen() {
    await new Promise((resolve) => this.server.listen(this.socketPath, resolve));
    return this;
  }

  _onConnection(socket) {
    this.sockets.add(socket);
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.push(chunk)) {
        this.received.push(packet);
        if (packet.opcode === OPCODES.HANDSHAKE) {
          socket.write(
            encodePacket(OPCODES.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1, config: {} } })
          );
        }
        if (packet.opcode === OPCODES.PING) socket.write(encodePacket(OPCODES.PONG, packet.data));
        if (packet.data?.cmd === "SET_ACTIVITY") {
          socket.write(
            encodePacket(OPCODES.FRAME, {
              cmd: "SET_ACTIVITY",
              data: { name: "SET_ACTIVITY" },
              nonce: packet.data.nonce
            })
          );
        }
      }
    });
    socket.on("error", () => {});
  }

  /** Last activity the companion pushed (null means "cleared"). */
  get lastActivity() {
    const frame = [...this.received]
      .reverse()
      .find((packet) => packet.data?.cmd === "SET_ACTIVITY");
    return frame ? frame.data.args.activity : undefined;
  }

  get activities() {
    return this.received
      .filter((packet) => packet.data?.cmd === "SET_ACTIVITY")
      .map((packet) => packet.data.args.activity);
  }

  get handshakes() {
    return this.received.filter((packet) => packet.opcode === OPCODES.HANDSHAKE);
  }

  async close() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

async function setupDashboard(ctx) {
  const csrf = await ctx.signIn();

  const upload = await ctx.request("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ dataUrl: PNG_DATA_URL, name: "banner.png" })
  });
  assert.equal(upload.status, 200);
  const asset = (await upload.json()).asset;

  const presence = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({
      name: "Building StatusC0rd",
      type: 2,
      status: "online",
      details: "Shipping photo-rich presence",
      state: "v2.1",
      largeImage: `asset:${asset.id}`,
      largeText: "the banner",
      smallImage: "https://cdn.example.com/dot.png",
      smallText: "live",
      buttons: [
        { label: "GitHub", url: "https://github.com/Not4Pranav/StatusC0rd" },
        { label: "Website", url: "https://example.com" }
      ],
      startedAt: true,
      targets: { bot: true, companion: true }
    })
  });
  assert.equal(presence.status, 200);

  const pairing = await ctx.request("/api/companion/pairings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ label: "E2E laptop" })
  });
  assert.equal(pairing.status, 200);
  const pair = await pairing.json();

  return { csrf, asset, pair };
}

test("the dashboard drives photos, text and buttons onto the user's profile", async (t) => {
  const ctx = await startApp({ publicUrl: "http://127.0.0.1:1" }); // overwritten below
  const discord = await new FakeDiscord(fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-e2e-"))).listen();
  t.after(async () => {
    await discord.close();
    await ctx.close();
  });

  // Photos are served from the live server in this test, so point the public URL
  // at it. (Production uses the https domain instead.)
  ctx.settings.update({ publicUrl: ctx.base });

  const { csrf, asset, pair } = await setupDashboard(ctx);

  // --- the payload the companion is served ---------------------------------
  const config = await (
    await ctx.request("/api/companion/config", { headers: { authorization: `Bearer ${pair.token}` } })
  ).json();
  assert.equal(config.activity.assets.large_image, `${ctx.base}/assets/${asset.id}.png`);
  assert.deepEqual(config.activity.buttons, ["GitHub", "Website"]);

  // The uploaded photo is actually downloadable (Discord fetches this URL).
  const photo = await ctx.request(`/assets/${asset.id}.png`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.equal(photo.headers.get("access-control-allow-origin"), "*");

  // --- run the real companion against the fake Discord ---------------------
  const handle = await start(
    { server: ctx.base, token: pair.token, appId: "1554342719923560518", label: "E2E laptop" },
    {
      env: { XDG_RUNTIME_DIR: discord.dir },
      platform: "linux",
      pollIntervalMs: 80,
      heartbeatIntervalMs: 200,
      logger: { log() {}, warn() {} }
    }
  );
  t.after(() => handle.stop());

  assert.equal(handle.ipc.socketPath, discord.socketPath, "companion found the IPC socket");
  assert.equal(discord.handshakes.length, 1);
  assert.equal(discord.handshakes[0].data.client_id, "1554342719923560518");

  const applied = await waitFor(() => discord.lastActivity, { label: "the first SET_ACTIVITY" });

  // Text
  assert.equal(applied.name, "Building StatusC0rd");
  assert.equal(applied.details, "Shipping photo-rich presence");
  assert.equal(applied.state, "v2.1");
  assert.equal(applied.type, 2);
  // Photos (the uploaded asset, served over the public URL)
  assert.equal(applied.assets.large_image, `${ctx.base}/assets/${asset.id}.png`);
  assert.equal(applied.assets.large_text, "the banner");
  assert.equal(applied.assets.small_image, "https://cdn.example.com/dot.png");
  assert.equal(applied.assets.small_text, "live");
  // Buttons
  assert.deepEqual(applied.buttons, ["GitHub", "Website"]);
  assert.deepEqual(applied.metadata.button_urls, [
    "https://github.com/Not4Pranav/StatusC0rd",
    "https://example.com"
  ]);
  // Timer
  assert.equal(typeof applied.timestamps.start, "number");
  assert.ok(applied.timestamps.start > Date.now() - 60_000);

  // --- the dashboard sees the device as live -------------------------------
  const liveState = await waitFor(
    async () => {
      const state = await (await ctx.request("/api/state")).json();
      const device = state.pairings.find((entry) => entry.id === pair.pairing.id);
      return device?.lastStatus === "connected" ? device : null;
    },
    { label: "a heartbeat from the companion" }
  );
  assert.ok(liveState.lastSeenAt);

  // --- editing in the dashboard updates the profile within seconds ---------
  const updated = await ctx.request("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({
      name: "Just changed this",
      type: 0,
      details: "no reload needed",
      largeImage: `asset:${asset.id}`,
      buttons: [{ label: "Read the docs", url: "https://example.com/docs" }],
      targets: { bot: true, companion: true }
    })
  });
  assert.equal(updated.status, 200);

  const live = await waitFor(
    () => (discord.lastActivity?.name === "Just changed this" ? discord.lastActivity : null),
    { label: "the live update to reach Discord" }
  );
  assert.equal(live.details, "no reload needed");
  assert.deepEqual(live.buttons, ["Read the docs"]);

  // --- clearing the presence removes it from the profile -------------------
  await ctx.request("/api/presence/clear", {
    method: "POST",
    headers: { "x-csrf-token": csrf }
  });
  await waitFor(() => discord.lastActivity === null, { label: "the presence to be cleared" });

  // --- stopping the companion clears it too -------------------------------
  await handle.stop();
  const frames = discord.activities;
  assert.equal(frames.at(-1), null, "the companion clears the activity on exit");
});

test("a revoked pairing stops the companion", async (t) => {
  const ctx = await startApp();
  const discord = await new FakeDiscord(fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-e2e-"))).listen();
  t.after(async () => {
    await discord.close();
    await ctx.close();
  });

  const csrf = await ctx.signIn();
  const pair = await (
    await ctx.request("/api/companion/pairings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ label: "soon revoked" })
    })
  ).json();

  const handle = await start(
    { server: ctx.base, token: pair.token, appId: "1", label: "soon revoked" },
    {
      env: { XDG_RUNTIME_DIR: discord.dir },
      platform: "linux",
      pollIntervalMs: 50,
      heartbeatIntervalMs: 200,
      logger: { log() {}, warn() {} }
    }
  );
  t.after(() => handle.stop());

  await ctx.request(`/api/companion/pairings/${pair.pairing.id}`, {
    method: "DELETE",
    headers: { "x-csrf-token": csrf }
  });

  await waitFor(() => handle.unmatchedPairing === true, { label: "the companion to notice the revoke" });
  assert.equal(handle.state.unmatchedPairing, true);
});

test("launchers are generated per pairing and stay private", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const csrf = await ctx.signIn();
  const pair = await (
    await ctx.request("/api/companion/pairings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ label: "Family PC" })
    })
  ).json();

  assert.match(pair.launchers.windows, /\/companion\/start\.bat\?pair=/);
  assert.match(pair.launchers.mac, /\/companion\/start-mac\.zip\?pair=/);

  // macOS gets a zip so the execute bit survives the download (double-clickable).
  const macZip = await ctx.request(`/companion/start-mac.zip?pair=${pair.token}`);
  assert.equal(macZip.status, 200);
  assert.equal(macZip.headers.get("content-type"), "application/zip");
  assert.match(macZip.headers.get("content-disposition"), /StatusC0rd-mac\.zip/);
  const zip = Buffer.from(await macZip.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "local file header");
  const nameLength = zip.readUInt16LE(26);
  const name = zip.subarray(30, 30 + nameLength).toString("utf8");
  assert.equal(name, "StatusC0rd.command");
  // External attributes live in the *central directory* entry.
  const centralOffset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(centralOffset > 0, "central directory entry found");
  const mode = (zip.readUInt32LE(centralOffset + 38) >>> 16) & 0o777;
  assert.equal(mode, 0o755, "launcher is stored executable");
  const dataLength = zip.readUInt32LE(18);
  const content = zip.subarray(30 + nameLength, 30 + nameLength + dataLength).toString("utf8");
  assert.match(content, /^#!\/bin\/bash/);
  assert.ok(content.includes(pair.token), "launcher embeds the pairing token");
  assert.match(content, /command -v node/, "explains the Node.js requirement");

  const win = await ctx.request(`/companion/start.bat?pair=${pair.token}`);
  const winBody = await win.text();
  assert.match(winBody, /@echo off/);
  assert.match(winBody, /powershell -NoProfile/);
  assert.match(win.headers.get("content-disposition"), /StatusC0rd\.bat/);

  assert.equal((await ctx.request("/companion/start.sh?pair=nope")).status, 404);
});
