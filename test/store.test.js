"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { JsonFileStore, withDefaults } = require("../src/store");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "statusc0rd-store-"));
}

const silent = { warn() {}, log() {}, error() {} };

test("creates defaults when the file is missing", () => {
  const dir = tmpDir();
  const store = new JsonFileStore(path.join(dir, "nested", "config.json"), {
    defaults: { name: "Default", nested: { a: 1 } },
    logger: silent
  });

  assert.deepEqual(store.get(), { name: "Default", nested: { a: 1 } });
  const saved = store.set({ name: "Changed" });
  assert.deepEqual(saved, { name: "Changed", nested: { a: 1 } });
  assert.equal(fs.existsSync(path.join(dir, "nested", "config.json")), true);
});

test("persists values and reloads them", () => {
  const dir = tmpDir();
  const file = path.join(dir, "config.json");
  const first = new JsonFileStore(file, { defaults: { a: 1, b: 2 }, logger: silent });
  first.set({ a: 9 });

  const second = new JsonFileStore(file, { defaults: { a: 1, b: 2 }, logger: silent });
  assert.deepEqual(second.get(), { a: 9, b: 2 });
  assert.ok(second.lastSavedAt);
});

test("merges new default keys into an existing file", () => {
  const dir = tmpDir();
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({ a: 1 }));

  const store = new JsonFileStore(file, { defaults: { a: 0, b: 5 }, logger: silent });
  assert.deepEqual(store.get(), { a: 1, b: 5 });
});

test("recovers from corrupt JSON instead of crashing", () => {
  const dir = tmpDir();
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, "{ not json");

  const warnings = [];
  const store = new JsonFileStore(file, {
    defaults: { ok: true },
    logger: { ...silent, warn: (message) => warnings.push(message) }
  });

  assert.deepEqual(store.get(), { ok: true });
  assert.equal(warnings.length, 1);
  const backups = fs.readdirSync(dir).filter((name) => name.includes(".corrupt-"));
  assert.equal(backups.length, 1);
});

test("rejects non-object values", () => {
  const store = new JsonFileStore(path.join(tmpDir(), "config.json"), { defaults: {}, logger: silent });
  assert.throws(() => store.set([]), TypeError);
  assert.throws(() => store.set("nope"), TypeError);
});

test("writes owner-only files and leaves no temp file behind", () => {
  const dir = tmpDir();
  const file = path.join(dir, "config.json");
  const store = new JsonFileStore(file, { defaults: { a: 1 }, logger: silent });
  store.set({ a: 2 });

  if (process.platform !== "win32") {
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
  }
  assert.deepEqual(fs.readdirSync(dir), ["config.json"]);
});

test("get returns a defensive copy", () => {
  const store = new JsonFileStore(path.join(tmpDir(), "config.json"), {
    defaults: { nested: { a: 1 } },
    logger: silent
  });
  const value = store.get();
  value.nested.a = 99;
  assert.equal(store.get().nested.a, 1);
});

test("withDefaults keeps arrays and primitives intact", () => {
  assert.deepEqual(withDefaults([1, 2], [3]), [1, 2]);
  assert.equal(withDefaults(undefined, 7), 7);
  assert.deepEqual(withDefaults({ a: { b: 2 } }, { a: { b: 1, c: 3 } }), { a: { b: 2, c: 3 } });
});

test("checkWritable reports a usable directory", () => {
  const store = new JsonFileStore(path.join(tmpDir(), "config.json"), { defaults: {}, logger: silent });
  assert.equal(store.checkWritable(), true);
});
