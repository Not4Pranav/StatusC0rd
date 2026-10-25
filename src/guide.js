"use strict";

/**
 * The setup documentation, served by the website.
 *
 * The instructions are split by *where the server runs*, because that is the
 * only part that differs between installs:
 *
 *   docs/setup.md             the shared steps (Discord app, wizard, dashboard)
 *   docs/setup-local.md       your own computer, Mac or Raspberry Pi
 *   docs/setup-cloud.md       a cloud server or platform you pay for
 *   docs/setup-free-cloud.md  Render free tier, Oracle Always Free, GCP free tier
 *
 * The Markdown files are the only copies: the README links to them, GitHub
 * renders them, and `/guide` (plus `/guide/local`, `/guide/cloud`,
 * `/guide/free-cloud`) renders the same files for people already on a
 * deployment. Parsing is cached and invalidated by mtime.
 */

const fs = require("node:fs");
const path = require("node:path");

const { renderMarkdown } = require("./markdown");

const DOCS_DIR = path.join(__dirname, "..", "docs");

/**
 * Every document, in the order the guide navigation shows them.
 *
 * `slug` is the `/guide/<slug>` segment; the first entry is the default and
 * therefore has none. `file` is relative to `docs/`.
 */
const DOCS = Object.freeze([
  {
    slug: "",
    file: "setup.md",
    label: "Overview",
    blurb: "what you get, the Discord app, the wizard, the dashboard"
  },
  {
    slug: "local",
    file: "setup-local.md",
    label: "Your own computer",
    blurb: "run it on a PC, a Mac or a Raspberry Pi"
  },
  {
    slug: "cloud",
    file: "setup-cloud.md",
    label: "Cloud server",
    blurb: "a VPS or a managed platform you pay for"
  },
  {
    slug: "free-cloud",
    file: "setup-free-cloud.md",
    label: "Free cloud",
    blurb: "Render free tier, Oracle Always Free, GCP free tier"
  }
]);

/** `/guide` href for a document slug. */
function hrefFor(slug) {
  return slug ? `/guide/${slug}` : "/guide";
}

/** The document a `/guide/<slug>` request asks for, or null. */
function findDoc(slug) {
  const wanted = String(slug || "").replace(/^\/+|\/+$/g, "");
  return DOCS.find((doc) => doc.slug === wanted) || null;
}

const cache = new Map();

function fallback(availableAt) {
  return {
    available: false,
    title: "Setup guide",
    html:
      "<p>The guide file is missing from this deployment. It normally lives in " +
      `<code>${availableAt}</code> - rebuild the image from the repository, ` +
      "or read it on GitHub.</p>",
    headings: [],
    updatedAt: null
  };
}

/**
 * Point links between the Markdown files at their `/guide` routes, so a reader
 * on the website is never dropped onto a raw `.md` path. Same-page anchors are
 * left alone.
 */
function rewriteDocLinks(html) {
  return html.replace(/href="([\w.-]+\.md)(#[^"]*)?"/g, (match, file, hash) => {
    const doc = DOCS.find((entry) => entry.file === file);
    if (!doc) return match;
    return `href="${hrefFor(doc.slug)}${hash || ""}"`;
  });
}

/**
 * Render one document.
 *
 * Accepts a slug (`"local"`), nothing (the overview), or an explicit file path
 * (anything containing a slash or ending in `.md`) which is mostly for tests.
 *
 * @returns {{available: boolean, title: string, html: string,
 *            headings: Array<{level: number, text: string, id: string}>,
 *            updatedAt: string | null, slug: string, file: string, label: string}}
 */
function loadGuide(target = "") {
  const asked = String(target ?? "");
  const looksLikePath = /[\\/]/.test(asked) || asked.endsWith(".md");
  const doc = looksLikePath ? null : findDoc(asked);
  const file = looksLikePath ? asked : path.join(DOCS_DIR, (doc || DOCS[0]).file);
  const slug = doc ? doc.slug : "";
  const fileLabel = path.relative(DOCS_DIR, file).split(path.sep).join("/");

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { ...fallback(`docs/${fileLabel}`), slug, file: fileLabel, label: doc ? doc.label : "Overview" };
  }

  const key = `${file}:${stat.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rendered = renderMarkdown(fs.readFileSync(file, "utf8"));
  const value = {
    available: true,
    title: (rendered.headings.find((heading) => heading.level === 1) || {}).text || "Setup guide",
    html: rewriteDocLinks(rendered.html),
    headings: rendered.headings,
    updatedAt: stat.mtime.toISOString(),
    slug,
    file: fileLabel,
    label: doc ? doc.label : "Overview"
  };

  // Keep one entry per file so the cache cannot grow with every edit.
  for (const existing of cache.keys()) {
    if (existing.startsWith(`${file}:`)) cache.delete(existing);
  }
  cache.set(key, value);
  return value;
}

/** The navigation model: every document plus the one that is open. */
function guideNav(activeSlug = "") {
  return DOCS.map((doc) => ({
    slug: doc.slug,
    href: hrefFor(doc.slug),
    label: doc.label,
    blurb: doc.blurb,
    file: `docs/${doc.file}`,
    active: doc.slug === activeSlug
  }));
}

module.exports = { loadGuide, guideNav, findDoc };
