"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Very small `{{TOKEN}}` template renderer.
 *
 * Values are always HTML-escaped: templates only ever receive scalars from the
 * server, so this removes a whole class of injection bugs.
 */
function createRenderer(viewsDir, { cache = true } = {}) {
  const cacheStore = new Map();

  function load(name) {
    const file = path.join(viewsDir, name);
    if (cache && cacheStore.has(file)) return cacheStore.get(file);
    const text = fs.readFileSync(file, "utf8");
    if (cache) cacheStore.set(file, text);
    return text;
  }

  /**
   * `{{TOKEN}}` is HTML-escaped, `{{{TOKEN}}}` is inserted verbatim.
   *
   * Only pass already-safe HTML (for example a rendered snippet) to the triple
   * form: everything else in the templates comes from server-side scalars.
   */
  return function render(name, vars = {}) {
    const raw = [];
    let output = load(name).replace(/\{\{\{\s*([A-Z0-9_]+)\s*\}\}\}/g, (match, key) => {
      const index = raw.push(key in vars ? String(vars[key] ?? "") : "") - 1;
      return `\u0000raw-${index}\u0000`;
    });

    output = output.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => (key in vars ? escapeHtml(vars[key]) : ""));

    return output.replace(/\u0000raw-(\d+)\u0000/g, (match, index) => raw[Number(index)]);
  };
}

module.exports = { createRenderer, escapeHtml };
