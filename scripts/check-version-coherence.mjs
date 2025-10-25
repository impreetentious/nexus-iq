#!/usr/bin/env node
// Version coherence — package.json, package-lock.json root, and README.md
// Release version must agree. Fails CI when they drift.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const readme = readFileSync(path.join(root, "README.md"), "utf8");

const errors = [];
const version = pkg.version;
if (!version) errors.push("package.json missing version");

if (lock.version !== version) {
  errors.push(`package-lock.json version ${lock.version} ≠ package.json ${version}`);
}
if (lock.packages?.[""]?.version && lock.packages[""].version !== version) {
  errors.push(`package-lock packages[""].version ${lock.packages[""].version} ≠ ${version}`);
}

const m = readme.match(/\*\*Release version:\*\*\s*`v?([^`]+)`/);
if (!m) errors.push("README.md missing **Release version:** `vX.Y.Z` marker");
else if (m[1] !== version) {
  errors.push(`README.md Release version v${m[1]} ≠ package.json ${version}`);
}

// SheetJS must resolve from the vendored tarball (supply-chain).
const xlsx = pkg.dependencies?.xlsx ?? "";
if (!String(xlsx).startsWith("file:./vendor/xlsx-")) {
  errors.push(`xlsx dependency must be file:./vendor/xlsx-… (got ${xlsx})`);
}

if (errors.length) {
  console.error("version-coherence FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log(`version-coherence OK — ${version}`);
