"use strict";

/**
 * Syntax-check every JavaScript file in the project.
 * `node --check` only accepts one file, hence this small driver.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", "coverage", "data"]);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
}

walk(ROOT);

let failed = 0;
for (const file of files.sort()) {
  const code = fs.readFileSync(file, "utf8");
  try {
    // Compiling without running catches syntax errors only.
    new vm.Script(code, { filename: file });
  } catch (error) {
    failed += 1;
    console.error(`✗ ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed to parse.`);
  process.exit(1);
}
console.log(`✓ ${files.length} JavaScript files parsed successfully.`);
