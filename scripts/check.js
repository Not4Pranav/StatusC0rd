"use strict";

/**
 * Syntax-check every JavaScript file in the project.
 * `node --check` only accepts one file, hence this small driver.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
// `vendor` holds third-party builds (the Discord Embedded App SDK bundle), which
// are shipped as-is and not maintained here.
const SKIP = new Set(["node_modules", ".git", "coverage", "data", "vendor"]);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) files.push(full);
  }
}

walk(ROOT);

let failed = 0;
for (const file of files.sort()) {
  try {
    // `node --check` parses without running, and unlike `vm.Script` it
    // understands ESM (`import`/`export`), which the browser code now uses.
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failed += 1;
    const detail = String(error.stderr || error.message).split("\n").find((line) => line.trim());
    console.error(`✗ ${path.relative(ROOT, file)}: ${detail}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed to parse.`);
  process.exit(1);
}
console.log(`✓ ${files.length} JavaScript files parsed successfully.`);
