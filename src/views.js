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

  return function render(name, vars = {}) {
    return load(name).replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
      if (!(key in vars)) return "";
      return escapeHtml(vars[key]);
    });
  };
}

module.exports = { createRenderer, escapeHtml };
