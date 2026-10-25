"use strict";

/**
 * The free-setup guide, served by the website.
 *
 * `docs/free-setup.md` is the only copy of the instructions: the README links to
 * it, GitHub renders it, and `/guide` renders the same file for people who are
 * already on a deployment. Parsing is cached and invalidated by mtime.
 */

const fs = require("node:fs");
const path = require("node:path");

const { renderMarkdown } = require("./markdown");

const GUIDE_FILE = path.join(__dirname, "..", "docs", "free-setup.md");

let cache = null;

/**
 * @param {string} [file]
 * @returns {{available: boolean, title: string, html: string,
 *            headings: Array<{level: number, text: string, id: string}>,
 *            updatedAt: string | null}}
 */
function loadGuide(file = GUIDE_FILE) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return {
      available: false,
      title: "Setup guide",
      html:
        "<p>The guide file is missing from this deployment. It normally lives in " +
        "<code>docs/free-setup.md</code> - rebuild the image from the repository, " +
        "or read it on GitHub.</p>",
      headings: [],
      updatedAt: null
    };
  }

  if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs) return cache.value;

  const rendered = renderMarkdown(fs.readFileSync(file, "utf8"));
  const value = {
    available: true,
    title: (rendered.headings.find((heading) => heading.level === 1) || {}).text || "Setup guide",
    html: rendered.html,
    headings: rendered.headings,
    updatedAt: stat.mtime.toISOString()
  };

  cache = { file, mtimeMs: stat.mtimeMs, value };
  return value;
}

module.exports = { loadGuide, GUIDE_FILE };
