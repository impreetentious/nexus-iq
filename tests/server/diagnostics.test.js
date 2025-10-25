// Diagnostics + support bundle:
//   GET /api/diagnostics                            — envelope + shape
//   GET /api/projects/:p/diagnostics/support-bundle — ZIP, MANIFEST, redaction
//
// The redaction contract under test: with a real-looking provider key planted
// in config/keys.json and a vault file planted under projects/<slug>/vault/,
// neither the key string nor the vault contents may appear in ANY member of
// the ZIP, and no member may live under vault/, .imports/, or be named
// keys.json. MANIFEST.json must carry bundleFormat: 1 and a per-member
// sha256 map. See docs/support-bundle.md for the policy this pins.
//
// Harness mirrors private-modes.test.js: tmp NEXUS_IQ_PROJECTS_DIR / _CONFIG_DIR,
// startServer({port:0}), tests share a running server through the module-level
// harness variables.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

import { startServer } from "../../server/index.js";

let tmpProjects, tmpConfig, srv, base;

before(async () => {
  tmpProjects = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-diag-"));
  tmpConfig = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-diag-cfg-"));
  process.env.NEXUS_IQ_PROJECTS_DIR = tmpProjects;
  process.env.NEXUS_IQ_CONFIG_DIR = tmpConfig;
  srv = await startServer({ port: 0 });
  base = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  await srv?.close?.();
  delete process.env.NEXUS_IQ_PROJECTS_DIR;
  delete process.env.NEXUS_IQ_CONFIG_DIR;
  await rm(tmpProjects, { recursive: true, force: true }).catch(() => {});
  await rm(tmpConfig, { recursive: true, force: true }).catch(() => {});
});

async function call(method, p, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + p, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body (ZIP, error text) */ }
  return { status: res.status, json, text };
}

test("GET /api/diagnostics returns the ok envelope with system fields + bundleFormat", async () => {
  const r = await call("GET", "/api/diagnostics");
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text?.slice(0, 200)}`);
  assert.equal(r.json?.ok, true, "envelope ok:true");
  const d = r.json.data;
  assert.equal(typeof d.version, "string", "version is a string");
  assert.equal(typeof d.node, "string", "node version present");
  assert.equal(typeof d.platform, "string");
  assert.equal(typeof d.uptimeMs, "number");
  assert.ok(d.uptimeMs >= 0);
  assert.equal(d.bundleFormat, 1, "bundleFormat is 1");
  assert.ok(d.providers && typeof d.providers === "object", "providers reachability map present");
  // provider values are pure booleans — no key material may leak here
  for (const [name, reach] of Object.entries(d.providers)) {
    assert.equal(typeof reach, "boolean", `providers.${name} is a boolean`);
  }
  assert.equal(typeof d.projectsCount, "number");
});

// The key we plant looks realistic enough that a substring search inside
// bundle members can catch even accidental echoing back through e.g. an
// error message or a ledger payload someday.
const PLANTED_KEY = "sk-live-plantedSUPERSECRETtoken9c8b7a5432";
const PLANTED_VAULT_SECRET = "leaked-original-string@example.com";

test("support bundle: MANIFEST + members present, redaction holds against a planted key + vault file", async () => {
  // 1. create a project through the real API
  const created = await call("POST", "/api/projects", { name: "Diagnostic Probe", privacyMode: "open" });
  assert.equal(created.status, 200, `create → ${created.status}: ${created.text?.slice(0, 200)}`);
  assert.equal(created.json?.ok, true);
  const slug = created.json.data.slug;

  // 2. plant a fake provider key in config/keys.json — the support bundle
  //    MUST NOT open this file
  await mkdir(tmpConfig, { recursive: true });
  await writeFile(
    path.join(tmpConfig, "keys.json"),
    JSON.stringify({ openrouter: PLANTED_KEY, openai: { apiKey: PLANTED_KEY } }),
    "utf8",
  );

  // 3. plant a vault file under projects/<slug>/vault/ — this path family is
  //    the same one the replication archive already refuses to include
  const vaultDir = path.join(tmpProjects, slug, "vault");
  await mkdir(vaultDir, { recursive: true });
  await writeFile(
    path.join(vaultDir, "cx_probe.json"),
    JSON.stringify({ tokens: { "[EMAIL_1]": PLANTED_VAULT_SECRET } }),
    "utf8",
  );

  // 4. plant a staged .imports file — must also stay out of the bundle
  const importsDir = path.join(tmpProjects, slug, ".imports");
  await mkdir(importsDir, { recursive: true });
  const importedSecret = "raw-uploaded-row-with-identifiers-should-not-ship";
  await writeFile(path.join(importsDir, "imp_stale.json"), JSON.stringify({ rows: [importedSecret] }), "utf8");

  // 5. GET the support bundle
  const res = await fetch(`${base}/api/projects/${slug}/diagnostics/support-bundle`);
  assert.equal(res.status, 200, `support-bundle → ${res.status}`);
  assert.equal(res.headers.get("content-type"), "application/zip", "ZIP content-type");
  assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename=".*support-bundle\.zip"/);

  const zipBytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(zipBytes.byteLength > 0, "bundle is non-empty");

  // 6. per-member content scan: the planted secrets must not appear inside
  //    ANY unzipped file. This is the meaningful redaction check — DEFLATE
  //    on the raw ZIP bytes could obscure a plaintext substring, so we
  //    unzip and look at each member's decoded content.
  const files = unzipSync(zipBytes);
  const names = Object.keys(files);
  for (const [name, u8] of Object.entries(files)) {
    const text = strFromU8(u8);
    assert.ok(!text.includes(PLANTED_KEY), `member ${name} must not contain the planted provider key`);
    assert.ok(!text.includes(PLANTED_VAULT_SECRET), `member ${name} must not contain vault contents`);
    assert.ok(!text.includes(importedSecret), `member ${name} must not contain .imports staging contents`);
  }

  // 7. no member LIVES under vault/, .imports/, or is named keys.json
  for (const n of names) {
    assert.ok(!/(^|\/)vault(\/|$)/i.test(n), `no vault/ member: ${n}`);
    assert.ok(!/(^|\/)\.imports(\/|$)/i.test(n), `no .imports/ member: ${n}`);
    assert.ok(!/(^|\/)keys\.json$/i.test(n), `no keys.json member: ${n}`);
  }

  // 8. expected members present
  assert.ok(names.includes("MANIFEST.json"), "MANIFEST.json present");
  assert.ok(names.includes("diagnostics.json"), "diagnostics.json present");
  assert.ok(names.includes("project.json"), "project.json present");
  assert.ok(names.includes("ledger-verify.json"), "ledger-verify.json present");
  assert.ok(names.includes("ledger-tail.ndjson"), "ledger-tail.ndjson present");
  assert.ok(names.includes("runs-summary.json"), "runs-summary.json present");
  assert.ok(names.includes("README.txt"), "README.txt present");

  // 9. MANIFEST format check — bundleFormat + per-member sha256 + policy
  const manifest = JSON.parse(strFromU8(files["MANIFEST.json"]));
  assert.equal(manifest.bundleFormat, 1, "bundleFormat is 1");
  assert.equal(typeof manifest.redactionPolicy, "number", "redactionPolicy version is a number");
  assert.equal(manifest.slug, slug, "manifest carries the project slug");
  assert.equal(typeof manifest.createdAt, "string");
  assert.equal(typeof manifest.generatorVersion, "string");
  assert.ok(manifest.files && typeof manifest.files === "object");
  // every non-MANIFEST member is listed with its hex sha256
  for (const n of names) {
    if (n === "MANIFEST.json") continue;
    assert.match(manifest.files[n] ?? "", /^[0-9a-f]{64}$/, `MANIFEST lists sha256 for ${n}`);
  }
  // MANIFEST does not list itself (it is the verifier, not a verified member)
  assert.equal(manifest.files["MANIFEST.json"], undefined);

  // 10. diagnostics.json shape — the same fields the /api/diagnostics route
  //     answers, plus the project rollup
  const diag = JSON.parse(strFromU8(files["diagnostics.json"]));
  assert.equal(diag.bundleFormat, 1);
  assert.equal(typeof diag.version, "string");
  assert.equal(diag.project.slug, slug);
  assert.equal(diag.project.privacyMode, "open");
  assert.ok(diag.project.counts && typeof diag.project.counts === "object");

  // 11. project.json inside the bundle is byte-consistent with the file the
  //     store persisted (no accidental fields leaked in through sanitize) —
  //     shape check on slug/privacyMode/id (the field-name scrub is a no-op
  //     on today's schema, so equality of these fields is expected)
  const bundledProject = JSON.parse(strFromU8(files["project.json"]));
  assert.equal(bundledProject.slug, slug);
  assert.equal(bundledProject.privacyMode, "open");
  assert.equal(typeof bundledProject.id, "string");

  // 12. ledger-verify.json is either {ok:true, length, ...} or ok:false
  const verify = JSON.parse(strFromU8(files["ledger-verify.json"]));
  assert.equal(verify.ok, true, "the freshly-created bundle has a clean ledger");
});

test("support bundle rejects an invalid project slug at the store boundary", async () => {
  // "..%2Fescape" decodes inside a segment to "../escape"; loadProject →
  // assertProjectSlug rejects that as NOT_FOUND (identical to any other
  // absent bundle — the exact wording the store guarantees).
  const res = await fetch(`${base}/api/projects/..%2Fescape/diagnostics/support-bundle`);
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error.code, "NOT_FOUND");
});
