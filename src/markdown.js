"use strict";

/**
 * A deliberately small Markdown renderer for the in-app guide.
 *
 * The guide lives in `docs/setup.md` and is also served by the website at
 * `/guide`, so there is exactly one copy of the instructions. Only the subset
 * that document uses is supported:
 *
 *   headings, paragraphs, bold/italic, inline code, links and autolinks,
 *   ordered/unordered lists (one or more levels), tables, fenced code and rules.
 *
 * Everything is HTML-escaped before any tag is produced, and only http(s),
 * mailto, root-relative and anchor links survive, so the output is safe even if
 * the file is edited later.
 */

const { escapeHtml } = require("./views");

// Same-page anchors, site-absolute paths, absolute URLs, and links between the
// documentation files (`setup-local.md`, possibly with a `#anchor`). Nothing
// else - in particular no `javascript:` - ever becomes an href.
const SAFE_URL = /^(https?:\/\/|mailto:|\/|#|[\w.-]+\.md(#|$))/i;
const BLOCK_START = /^(#{1,6}\s|```|>|\||[-*]\s|\d+\.\s|---)/;

/** Heading anchor ids: "## 4. Path A — Render" -> "path-a-render". */
function slugify(text) {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "section";
}

/** Inline formatting for one line of text. */
function renderInline(text) {
  const codes = [];
  let out = escapeHtml(text);

  // Code spans first: their contents must not be touched by the other rules.
  out = out.replace(/`([^`]+)`/g, (match, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  // <https://example.com> autolinks (escaped to &lt;...&gt; above).
  out = out.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (match, url) => {
    return `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`;
  });

  // [label](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    if (!SAFE_URL.test(url)) return label;
    const external = /^https?:\/\//i.test(url);
    const attrs = external ? ' target="_blank" rel="noreferrer noopener"' : "";
    return `<a href="${url}"${attrs}>${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return out.replace(/\u0000(\d+)\u0000/g, (match, index) => `<code>${codes[Number(index)]}</code>`);
}

function renderTable(lines) {
  const cells = (row) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const header = cells(lines[0]);
  const rows = lines.slice(2).map(cells); // lines[1] is the | --- | separator
  const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/** Render a list block starting at `start`; returns [html, nextIndex]. */
function renderList(lines, start) {
  const html = [];
  const stack = [];
  let index = start;

  const closeDeeperThan = (indent) => {
    while (stack.length > 0 && indent < stack[stack.length - 1].indent) {
      const top = stack.pop();
      if (top.open) html.push("</li>");
      html.push(top.ordered ? "</ol>" : "</ul>");
    }
  };

  /**
   * Move blocks that are indented under the current item into that item.
   *
   * Without this, a fenced code block or a table between two numbered steps
   * ends the `<ol>`, and the following steps restart at 1. In Markdown they
   * belong to the item above them, so the list stays one list.
   */
  const absorbBlocks = (from, itemIndent, out) => {
    let index = from;
    let absorbed = 0;
    while (index < lines.length) {
      let probe = index;
      while (probe < lines.length && !lines[probe].trim()) probe += 1;
      if (probe >= lines.length) return absorbed ? probe : index;

      const lead = /^\s*/.exec(lines[probe])[0].replace(/\t/g, "  ").length;
      if (lead <= itemIndent) {
        // A sibling item continues this list only once we know the item had a
        // block under it; otherwise leave the caller the old behaviour of
        // ending the list at a blank line (so `<ul>` and `<ol>` never merge).
        return absorbed ? probe : index;
      }
      if (ITEM.test(lines[probe])) return probe; // a nested list: the loop below owns it

      const fence = /^\s*```(\w*)\s*$/.exec(lines[probe]);
      if (fence) {
        const dedent = new RegExp(`^[ \\t]{0,${lead}}`);
        const code = [];
        let cursor = probe + 1;
        while (cursor < lines.length && !/^\s*```\s*$/.test(lines[cursor])) {
          code.push(lines[cursor].replace(dedent, ""));
          cursor += 1;
        }
        const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
        out.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
        index = cursor + 1;
        absorbed += 1;
        continue;
      }

      if (/^\s*\|/.test(lines[probe]) && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[probe + 1] || "")) {
        const rows = [];
        let cursor = probe;
        while (cursor < lines.length && /^\s*\|/.test(lines[cursor])) {
          rows.push(lines[cursor]);
          cursor += 1;
        }
        out.push(renderTable(rows));
        index = cursor;
        absorbed += 1;
        continue;
      }

      return probe;
    }
    return index;
  };

  while (index < lines.length) {
    const match = ITEM.exec(lines[index]);
    if (!match) break;

    const indent = match[1].replace(/\t/g, "  ").length;
    const ordered = /\d/.test(match[2]);
    let text = match[3];
    index += 1;

    // Wrapped lines belong to the same item until a blank line or a new block.
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim() || ITEM.test(next) || BLOCK_START.test(next.trim())) break;
      text += ` ${next.trim()}`;
      index += 1;
    }

    closeDeeperThan(indent);
    let top = stack[stack.length - 1];
    if (!top || indent > top.indent) {
      html.push(ordered ? "<ol>" : "<ul>");
      top = { indent, ordered, open: false };
      stack.push(top);
    } else if (top.open) {
      html.push("</li>");
    }
    html.push(`<li>${renderInline(text)}`);
    top.open = true;

    // Blocks indented under this item belong to it (see absorbBlocks).
    index = absorbBlocks(index, indent, html);
  }

  closeDeeperThan(-1);
  return [html.join(""), index];
}

/**
 * Render a Markdown document.
 * @param {string} source
 * @returns {{html: string, headings: Array<{level: number, text: string, id: string}>}}
 */
function renderMarkdown(source) {
  const lines = String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const out = [];
  const headings = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Fences may be indented (a code block inside a list item).
    const fence = /^(\s*)```(\w*)\s*$/.exec(line);
    if (fence) {
      const dedent = new RegExp(`^ {0,${fence[1].length}}`);
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index].replace(dedent, ""));
        index += 1;
      }
      index += 1; // closing fence
      const language = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : "";
      out.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      out.push("<hr />");
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text);
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    // Tables may be indented (a table inside a list item), so allow leading space.
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[index + 1] || "")) {
      const table = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        table.push(lines[index]);
        index += 1;
      }
      out.push(renderTable(table));
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      const inner = renderMarkdown(quote.join("\n"));
      out.push(`<blockquote>\n${inner.html}\n</blockquote>`);
      continue;
    }

    if (ITEM.test(line)) {
      const [html, next] = renderList(lines, index);
      out.push(html);
      index = next;
      continue;
    }

    // Paragraph: consecutive plain lines, joined with a space.
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim() || BLOCK_START.test(next.trim())) break;
      paragraph.push(next.trim());
      index += 1;
    }
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return { html: out.join("\n"), headings };
}

module.exports = { renderMarkdown, renderInline, slugify };
