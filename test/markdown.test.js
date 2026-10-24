"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderMarkdown, renderInline, slugify } = require("../src/markdown");

test("slugify builds github-style anchors", () => {
  assert.equal(slugify("4. Path A — Render"), "4-path-a-render");
  assert.equal(slugify("What you get"), "what-you-get");
  assert.equal(slugify("  Extra   spaces  "), "extra-spaces");
  assert.equal(slugify("Files: data/status.json"), "files-data-status-json");
});

test("headings get ids that match their slug", () => {
  const { html, headings } = renderMarkdown("# Title\n\n## 4. Path A — Render\n\ntext");
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<h2 id="4-path-a-render">4\. Path A — Render<\/h2>/);
  assert.deepEqual(headings, [
    { level: 1, text: "Title", id: "title" },
    { level: 2, text: "4. Path A — Render", id: "4-path-a-render" }
  ]);
});

test("html in the document is escaped, never executed", () => {
  const { html } = renderMarkdown('Hello <script>alert("x")</script> <img src=x onerror=alert(1)>');
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;script&gt;/);
});

test("inline formatting: bold, italic and code", () => {
  assert.equal(renderInline("**bold** and *italic* and `code`"), "<strong>bold</strong> and <em>italic</em> and <code>code</code>");
});

test("only safe link targets survive", () => {
  assert.match(renderInline("[docs](https://example.com/a)"), /href="https:\/\/example\.com\/a"/);
  assert.match(renderInline("<https://example.com>"), /href="https:\/\/example\.com"/);
  assert.match(renderInline("[local](/setup)"), /href="\/setup"/);

  for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox"]) {
    const html = renderInline(`[click](${url})`);
    assert.ok(!/href="/.test(html), `unsafe href rendered for ${url}: ${html}`);
    assert.match(html, /click/);
  }

  // Quote tricks inside the target must not break out of the attribute.
  const tricky = renderInline('[x](https://example.com/"onmouseover="alert(1))');
  assert.ok(!tricky.includes('onmouseover="alert(1)"'));
});

test("tables become an escaped, scrollable table", () => {
  const { html } = renderMarkdown(
    ["| Host | Cost |", "| --- | :--: |", "| Render | $0 |", "| Oracle <b> | $0 |"].join("\n")
  );
  assert.match(html, /<div class="md-table"><table><thead><tr><th>Host<\/th><th>Cost<\/th>/);
  assert.match(html, /<td>Render<\/td>/);
  assert.match(html, /<td>Oracle &lt;b&gt;<\/td>/);
  assert.match(html, /<\/tbody><\/table><\/div>/);
});

test("nested lists keep their structure", () => {
  const { html } = renderMarkdown(
    ["- one", "  - nested", "  - nested two", "- two", "", "1. first", "2. second"].join("\n")
  );
  assert.match(html, /<ul>\s*<li>one\s*<ul>\s*<li>nested<\/li>/);
  assert.match(html, /<ol>\s*<li>first<\/li>\s*<li>second<\/li>\s*<\/ol>/);
});

test("fenced code keeps whitespace and escapes markup", () => {
  const { html } = renderMarkdown("```bash\nnpm start && echo <ok>\n```");
  assert.match(html, /<pre><code class="language-bash">npm start &amp;&amp; echo &lt;ok&gt;<\/code><\/pre>/);
});

test("horizontal rules and blockquotes render", () => {
  const { html } = renderMarkdown("---\n\n> note **here**");
  assert.match(html, /<hr\s*\/?>/);
  assert.match(html, /<blockquote>[\s\S]*<strong>here<\/strong>/);
});

test("blocks indented under a list item still render", () => {
  // `docs/free-setup.md` places its variable table and invite URL this way.
  const table = renderMarkdown(
    ["3. Fill these in:", "", "   | Variable | Value |", "   | --- | --- |", "   | `CLIENT_ID` | 123 |"].join("\n")
  );
  assert.match(table.html, /<div class="md-table">/);
  assert.ok(!table.html.includes("| ---"));

  const code = renderMarkdown(["4. Invite the bot:", "", "   ```bash", "   npm start", "   ```"].join("\n"));
  assert.match(code.html, /<pre><code class="language-bash">npm start<\/code><\/pre>/);
});

test("empty input is empty output", () => {
  assert.deepEqual(renderMarkdown(""), { html: "", headings: [] });
});

test("the deployment guide renders with working anchors and no raw html", () => {
  const guide = require("../src/guide").loadGuide();
  assert.equal(guide.available, true);
  assert.ok(guide.html.length > 2000);
  assert.ok(guide.headings.length >= 5);

  // Every table of contents link points at a real heading id.
  const ids = new Set(guide.headings.map((heading) => heading.id));
  for (const match of guide.html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.has(match[1]), `dangling anchor #${match[1]}`);
  }

  // No raw html tags from the source leaked through.
  for (const tag of ["<script", "<iframe", "onerror="]) {
    assert.ok(!guide.html.includes(tag), `guide html contains ${tag}`);
  }
});
