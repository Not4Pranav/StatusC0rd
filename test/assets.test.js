"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const { parseUpload, readDimensions, AssetStore, MAX_BYTES } = require("../src/assets");
const { SettingsStore } = require("../src/settings");

const silent = { warn() {}, log() {}, error() {} };

/** Build a valid RGB PNG of the given size. */
function makePng(width, height) {
  const row = Buffer.alloc(width * 3 + 1, 0);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = 88;
    row[2 + x * 3] = 101;
    row[3 + x * 3] = 242;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, crcBuffer]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const png = (width = 64, height = 64) => `data:image/png;base64,${makePng(width, height).toString("base64")}`;

test("accepts a png and reads its dimensions", () => {
  const result = parseUpload(png(96, 96));
  assert.equal(result.ok, true);
  assert.equal(result.mime, "image/png");
  assert.equal(result.ext, "png");
  assert.equal(result.width, 96);
  assert.equal(result.height, 96);
});

test("rejects non-image payloads and unsupported types", () => {
  assert.match(parseUpload("").error, /No image data/);
  assert.match(parseUpload("hello").error, /PNG, JPEG, WebP or GIF/);
  assert.match(parseUpload("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=").error, /PNG, JPEG/);
});

test("rejects content that does not match its declared type", () => {
  const disguised = `data:image/png;base64,${Buffer.from("not really a png").toString("base64")}`;
  assert.match(parseUpload(disguised).error, /does not match/);
});

test("rejects oversized images", () => {
  const huge = Buffer.alloc(MAX_BYTES + 10);
  huge[0] = 0x89;
  huge[1] = 0x50;
  huge[2] = 0x4e;
  huge[3] = 0x47;
  const dataUrl = `data:image/png;base64,${huge.toString("base64")}`;
  assert.match(parseUpload(dataUrl).error, /smaller than/);
});

test("rejects tiny images", () => {
  assert.match(parseUpload(png(8, 8)).error, /at least 16/);
});

test("reads gif dimensions", () => {
  const gif = Buffer.alloc(32);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(320, 6);
  gif.writeUInt16LE(240, 8);
  assert.deepEqual(readDimensions(gif, "image/gif"), { width: 320, height: 240 });
});

test("asset store writes, dedupes and serves urls", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-assets-"));
  const settings = new SettingsStore(path.join(dir, "settings.json"), { logger: silent });
  const store = new AssetStore(path.join(dir, "assets"), settings);

  const first = store.save({ dataUrl: png(64, 64), name: "logo.png" });
  assert.equal(first.ok, true);
  const file = store.filePath(first.asset);
  assert.ok(fs.existsSync(file));
  assert.equal(settings.listAssets().length, 1);

  // identical bytes are stored once
  const second = store.save({ dataUrl: png(64, 64), name: "again.png" });
  assert.equal(second.duplicate, true);
  assert.equal(second.asset.id, first.asset.id);
  assert.equal(settings.listAssets().length, 1);

  assert.equal(
    store.url(first.asset, "https://status.example.com/"),
    `https://status.example.com/assets/${first.asset.id}.png`
  );
  assert.equal(store.url(first.asset, ""), `/assets/${first.asset.id}.png`);

  assert.equal(store.remove(first.asset.id), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(settings.listAssets().length, 0);
});

test("prune deletes orphaned image files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-prune-"));
  const settings = new SettingsStore(path.join(dir, "settings.json"), { logger: silent });
  const assetsDir = path.join(dir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "orphan.png"), "x");
  const store = new AssetStore(assetsDir, settings);
  assert.equal(store.prune(), 1);
  assert.deepEqual(fs.readdirSync(assetsDir), []);
});

