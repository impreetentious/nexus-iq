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
const read = (file) => readFileSync(path.join(root, file), "utf8");

const errors = [];
const version = pkg.version;
if (!version) errors.push("package.json missing version");

if (lock.version !== version) {
  errors.push(`package-lock.json version ${lock.version} ≠ package.json ${version}`);
}
if (lock.packages?.[""]?.version && lock.packages[""].version !== version) {
  errors.push(`package-lock packages[""].version ${lock.packages[""].version} ≠ ${version}`);
}

const m = readme.match(/\*\*(?:Release version|Version):\*\*\s*`?v?([0-9][^`\s]*)`?/);
if (!m) errors.push("README.md missing **Version:** vX.Y.Z marker");
else if (m[1] !== version) {
  errors.push(`README.md Version v${m[1]} ≠ package.json ${version}`);
}

const EXPECTED = {
  nvmrc: "20.20.1",
  engines: ">=20.19",
  workflows: [".github/workflows/ci.yml", ".github/workflows/release.yml"],
};
const nvm = read(".nvmrc").trim();
if (nvm !== EXPECTED.nvmrc) errors.push(`.nvmrc ${nvm} ≠ ${EXPECTED.nvmrc}`);
if (pkg.engines?.node !== EXPECTED.engines) {
  errors.push(`package.json engines.node ${pkg.engines?.node} ≠ ${EXPECTED.engines}`);
}
for (const workflowPath of EXPECTED.workflows) {
  const workflow = read(workflowPath);
  const setupNodeCount = [...workflow.matchAll(/uses:\s+actions\/setup-node@/g)].length;
  const nodeVersionFileCount = [
    ...workflow.matchAll(/^\s*node-version-file:\s*['"]?\.nvmrc['"]?\s*$/gm),
  ].length;
  if (setupNodeCount !== nodeVersionFileCount) {
    errors.push(`${workflowPath} must configure every setup-node action from .nvmrc`);
  }
  if (/^\s*node-version:\s+/m.test(workflow)) {
    errors.push(`${workflowPath} uses node-version instead of .nvmrc`);
  }
}

const dockerfile = read("Dockerfile");
const dockerNodeTags = [...dockerfile.matchAll(/^FROM\s+node:([^\s]+)(?:\s+AS\s+\S+)?$/gim)].map(
  (match) => match[1],
);
if (dockerNodeTags.length === 0) errors.push("Dockerfile has no Node base image");
for (const tag of dockerNodeTags) {
  if (tag !== `${nvm}-alpine`) {
    errors.push(`Dockerfile node:${tag} ≠ .nvmrc ${nvm} (expected node:${nvm}-alpine)`);
  }
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
