"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const {
  encodePacket,
  PacketDecoder,
  normalizeActivity,
  ipcCandidates,
  ipcDirectories,
  DiscordIpc,
  OPCODES,
  start
} = require("../src/companion/agent");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("encodes IPC frames with an opcode and length header", () => {
  const packet = encodePacket(OPCODES.HANDSHAKE, { v: 1, client_id: "123" });
  assert.equal(packet.readInt32LE(0), 0);
  const length = packet.readInt32LE(4);
  assert.equal(length, packet.length - 8);
  assert.deepEqual(JSON.parse(packet.subarray(8).toString("utf8")), { v: 1, client_id: "123" });
});

test("decodes frames split across chunks", () => {
  const decoder = new PacketDecoder();
  const packet = encodePacket(OPCODES.FRAME, { cmd: "SET_ACTIVITY", args: { activity: { name: "x" } } });

  assert.deepEqual(decoder.push(packet.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(packet.subarray(3, 12)), []);
  const packets = decoder.push(packet.subarray(12));
  assert.equal(packets.length, 1);
  assert.equal(packets[0].opcode, OPCODES.FRAME);
  assert.equal(packets[0].data.cmd, "SET_ACTIVITY");
  assert.equal(packets[0].data.args.activity.name, "x");
});

test("decodes multiple frames arriving together", () => {
  const decoder = new PacketDecoder();
  const combined = Buffer.concat([
    encodePacket(OPCODES.PING, { a: 1 }),
    encodePacket(OPCODES.FRAME, { b: 2 })
  ]);
  const packets = decoder.push(combined);
  assert.equal(packets.length, 2);
  assert.equal(packets[0].opcode, OPCODES.PING);
  assert.equal(packets[1].data.b, 2);
});

test("rejects absurd frame lengths", () => {
  const decoder = new PacketDecoder();
  const header = Buffer.alloc(8);
  header.writeInt32LE(1, 0);
  header.writeInt32LE(10_000_000, 4);
  assert.throws(() => decoder.push(header), /Invalid IPC frame length/);
});

test("RPC does not support streaming or custom types", () => {
  assert.deepEqual(normalizeActivity({ name: "x", type: 1, url: "https://twitch.tv/x" }), { name: "x", type: 0 });
  assert.deepEqual(normalizeActivity({ name: "x", type: 4 }), { name: "x", type: 0 });
  assert.deepEqual(normalizeActivity({ name: "x", type: 2 }), { name: "x", type: 2 });
  assert.equal(normalizeActivity(null), null);
});

test("converts second timestamps to milliseconds", () => {
  const activity = normalizeActivity({ name: "x", type: 0, timestamps: { start: 1_700_000_000 } });
  assert.equal(activity.timestamps.start, 1_700_000_000_000);
  const already = normalizeActivity({ name: "x", type: 0, timestamps: { start: 1_700_000_000_000 } });
  assert.equal(already.timestamps.start, 1_700_000_000_000);
});

test("looks for the socket in the usual places", () => {
  const dirs = ipcDirectories({ XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" }, "linux");
  assert.ok(dirs.includes("/run/user/1000"));
  assert.ok(dirs.includes("/tmp"));
  assert.ok(dirs.includes("/run/user/1000/app/com.discordapp.Discord"), "flatpak");
  assert.ok(dirs.includes("/run/user/1000/snap.discord"), "snap");

  const linux = ipcCandidates({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux");
  assert.equal(linux[0], "/run/user/1000/discord-ipc-0");
  assert.ok(linux.length >= 10);

  const windows = ipcCandidates({}, "win32");
  assert.equal(windows[0], "\\\\?\\pipe\\discord-ipc-0");
  assert.equal(windows[1], "\\\\.\\pipe\\discord-ipc-0", "fallback spelling of the named pipe");
  assert.equal(windows.length, 20);
});

test("handshakes over a real unix socket and sends SET_ACTIVITY", async (t) => {
  if (process.platform === "win32") {
    t.skip("unix sockets only");
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-ipc-"));
  const socketPath = path.join(dir, "discord-ipc-0");
  const received = [];
  const server = net.createServer((socket) => {
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.push(chunk)) {
        received.push(packet);
        if (packet.opcode === OPCODES.HANDSHAKE) {
          // Discord answers the handshake with a READY dispatch.
          socket.write(
            encodePacket(OPCODES.FRAME, {
              cmd: "DISPATCH",
              evt: "READY",
              data: { v: 1, config: {} }
            })
          );
        }
        if (packet.opcode === OPCODES.PING) {
          socket.write(encodePacket(OPCODES.PONG, packet.data));
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const ipc = new DiscordIpc({ appId: "1554342719923560518", env: { XDG_RUNTIME_DIR: dir }, platform: "linux" });
  const connectedPath = await ipc.connect();
  assert.equal(connectedPath, socketPath);
  assert.equal(ipc.ready, true);

  const handshake = received[0];
  assert.equal(handshake.opcode, OPCODES.HANDSHAKE);
  assert.equal(handshake.data.client_id, "1554342719923560518");
  assert.equal(handshake.data.v, 1);

  ipc.setActivity({
    name: "Working",
    type: 2,
    details: "line one",
    assets: { large_image: "https://status.example.com/assets/abc.png" },
    buttons: ["Site"],
    metadata: { button_urls: ["https://example.com"] }
  });
  await wait(60);

  const setActivity = received.find((packet) => packet.data.cmd === "SET_ACTIVITY");
  assert.ok(setActivity, "expected a SET_ACTIVITY command");
  assert.equal(setActivity.data.args.activity.name, "Working");
  assert.equal(setActivity.data.args.activity.assets.large_image, "https://status.example.com/assets/abc.png");
  assert.equal(setActivity.data.args.activity.buttons[0], "Site");
  assert.equal(setActivity.data.args.activity.metadata.button_urls[0], "https://example.com");
  assert.equal(typeof setActivity.data.nonce, "string");

  ipc.setActivity(null);
  await wait(40);
  const cleared = received.filter((packet) => packet.data.cmd === "SET_ACTIVITY").pop();
  assert.equal(cleared.data.args.activity, null);

  ipc.close();
});

test("fails with a helpful error when Discord is not running", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-empty-"));
  const ipc = new DiscordIpc({ appId: "1", env: { XDG_RUNTIME_DIR: dir }, platform: "linux" });
  await assert.rejects(ipc.connect(), /Discord desktop app running/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a pairing without an application id fails with an actionable message", async () => {
  await assert.rejects(
    () =>
      start(
        { server: "https://status.example.com", token: "token", appId: "", label: "no app id" },
        { env: {}, platform: "linux", logger: { log() {}, warn() {} } }
      ),
    /Settings.*Application \(client\) ID|application ID/i
  );
});
