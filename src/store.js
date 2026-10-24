"use strict";

const fs = require("node:fs");
const path = require("node:path");

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value);

/**
 * Recursively merge `defaults` into `value` without mutating either argument.
 * Used so old config files automatically pick up newly added fields.
 */
function withDefaults(value, defaults) {
  if (!isPlainObject(defaults)) return value === undefined ? defaults : value;
  const base = isPlainObject(value) ? { ...value } : {};
  for (const [key, fallback] of Object.entries(defaults)) {
    base[key] = withDefaults(base[key], fallback);
  }
  return base;
}

/**
 * A tiny JSON-file store with atomic writes.
 *
 * - Writes go to `<file>.tmp` and are renamed into place, so a crash can never
 *   leave a half-written config behind.
 * - Files are created with mode 0600 because they may contain user metadata.
 * - A corrupt file is moved aside (never silently deleted) and defaults are used.
 */
class JsonFileStore {
  /**
   * @param {string} file absolute path of the JSON file
   * @param {{defaults?: object, logger?: Console}} [options]
   */
  constructor(file, options = {}) {
    this.file = file;
    this.defaults = options.defaults ?? {};
    this.logger = options.logger ?? console;
    this.lastSavedAt = null;
    this.data = this._load();
  }

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logger.warn?.(`[store] could not read ${this.file}: ${error.message}`);
      }
      return structuredClone(this.defaults);
    }

    try {
      const parsed = JSON.parse(raw);
      try {
        this.lastSavedAt = fs.statSync(this.file).mtime.toISOString();
      } catch {
        /* not fatal */
      }
      return withDefaults(parsed, this.defaults);
    } catch (error) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.file, backup);
        this.logger.warn?.(`[store] ${this.file} was invalid JSON (${error.message}); moved to ${backup}`);
      } catch {
        this.logger.warn?.(`[store] ${this.file} was invalid JSON (${error.message}); using defaults`);
      }
      return structuredClone(this.defaults);
    }
  }

  /** @returns {object} a defensive copy of the stored value */
  get() {
    return structuredClone(this.data);
  }

  /**
   * Replace the stored value.
   * @param {object} data
   * @returns {object} the saved, defaults-merged value
   */
  set(data) {
    if (!isPlainObject(data)) throw new TypeError("JsonFileStore.set expects a plain object");
    this.data = withDefaults(data, this.defaults);
    this._write(this.data);
    return this.get();
  }

  /**
   * Read-modify-write helper.
   * @param {(current: object) => object} mutator
   */
  update(mutator) {
    return this.set(mutator(this.get()));
  }

  _write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.lastSavedAt = new Date().toISOString();
  }

  /** Best-effort readiness check for the health endpoint. */
  checkWritable() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.accessSync(path.dirname(this.file), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { JsonFileStore, withDefaults };
