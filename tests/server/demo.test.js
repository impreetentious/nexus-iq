// One-click MockModel demo — pins the reset path server/routes/demo.js.
//
// Contract under test:
//   GET  /api/demo/status → {available, csvPresent, projectExists, slug};
//   POST /api/demo/reset ?sample=5 / {sampleRows: 5} →
//     - overwrites any prior "techcorp-exit" bundle (containment-checked);
//     - mints a fresh open-mode project pinned to the mock director;
//     - ingests demo/techcorp-exit-survey.csv using the same primitives the
//       two-step import flow uses (parse → unitize → pii scan → junk scan →
//       units.ndjson + corpus meta + corpus.imported/unitized ledger events);
//     - returns {slug, corpusId, unitCount, skipped, steps: [...]}.
//
// Uses sampleRows: 5 so the ingest touches only five rows — full-file
// ingestion is the product behavior but too heavy for the test hot path.
//
// Harness mirrors tests/server/import-roles.test.js: the real server on an
// ephemeral port over temp NEXUS_IQ_PROJECTS_DIR / NEXUS_IQ_CONFIG_DIR.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startServer } from "../../server/index.js";
import { projectDir, readNdjson } from "../../server/core/store.js";

// ---------------------------------------------------------------- harness

let tmpProjects;
let tmpConfig;
let srv;
let base;

before(async () => {
  tmpProjects = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-demo-"));
  tmpConfig = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-demo-cfg-"));
  process.env.NEXUS_IQ_PROJECTS_DIR = tmpProjects;
  process.env.NEXUS_IQ_CONFIG_DIR = tmpConfig;
  srv = await startServer({ port: 0 });
  base = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  await srv.close();
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
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, json, text };
}

async function ok(method, p, body) {
  const r = await call(method, p, body);
  assert.equal(r.status, 200, `${method} ${p} → ${r.status}: ${r.text?.slice(0, 300)}`);
  assert.equal(r.json?.ok, true, `${method} ${p} envelope not ok`);
  return r.json.data;
}

async function fail(method, p, body, status, code) {
  const r = await call(method, p, body);
  assert.equal(r.status, status, `${method} ${p} expected ${status}, got ${r.status}: ${r.text?.slice(0, 300)}`);
  assert.equal(r.json?.ok, false);
  if (code) assert.equal(r.json.error.code, code, `expected error code ${code}, got ${r.json.error.code}`);
}

const SLUG = "techcorp-exit";
const unitsFile = (slug, corpusId) => path.join(projectDir(slug), "corpora", corpusId, "units.ndjson");

// =========================================================================

test("status reports the CSV present and the demo project absent before reset", async () => {
  const s = await ok("GET", "/api/demo/status");
  assert.equal(s.available, true);
  assert.equal(s.slug, SLUG);
  assert.equal(s.csvPresent, true, "the bundled CSV should ship with the repo");
  assert.equal(s.projectExists, false, "no bundle yet on a fresh tempdir");
});

test("reset creates the demo project, ingests the sampled CSV, and returns the guided steps", async () => {
  const data = await ok("POST", "/api/demo/reset", { sampleRows: 5 });
  assert.equal(data.slug, SLUG);
  assert.match(data.corpusId, /^corp_/, `corpusId should be a store-minted id (got ${data.corpusId})`);
  assert.equal(data.unitCount, 5, "sampleRows: 5 → five units on disk (the CSV's response column is non-empty for these rows)");
  assert.equal(data.skipped, 0, "no empty response cells in the sampled slice");
  assert.ok(Array.isArray(data.steps) && data.steps.length > 0, "the guided walkthrough carries next steps");
  for (const step of data.steps) assert.equal(typeof step, "string");

  // The project bundle exists with the pinned director slot.
  const project = await ok("GET", `/api/projects/${SLUG}`);
  assert.equal(project.slug, SLUG);
  assert.equal(project.privacyMode, "open");
  assert.deepEqual({ provider: project.director?.provider, model: project.director?.model }, {
    provider: "mock", model: "mock-1",
  }, "the demo director slot is mock/mock-1");
  assert.equal(project.corpora.length, 1);
  const corpus = project.corpora[0];
  assert.equal(corpus.id, data.corpusId);
  assert.equal(corpus.unitCount, 5);
  assert.equal(corpus.textColumn, "response");
  assert.equal(corpus.scheme, "response");
  assert.equal(corpus.pii?.mode, "scan", "scan is the confirm-time default and the demo inherits it");
});

test("reset writes units.ndjson AND ledgers the same events a real confirm would", async () => {
  const project = await ok("GET", `/api/projects/${SLUG}`);
  const corpusId = project.corpora[0].id;

  const units = await readNdjson(unitsFile(SLUG, corpusId));
  assert.equal(units.length, 5);
  for (const u of units) {
    assert.equal(typeof u.id, "string");
    assert.ok(u.id.startsWith("u_"), "unit ids are the content-hashed store form");
    assert.ok(String(u.text ?? "").length > 0, "the response column carries the unit text");
  }

  // Ledger: project.created + corpus.imported + corpus.unitized, in order.
  const ledgerPath = path.join(projectDir(SLUG), "ledger.ndjson");
  await access(ledgerPath); // throws if missing — the ledger has to exist
  const events = (await readFile(ledgerPath, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const types = events.map((e) => e.type);
  assert.deepEqual(types.slice(-3), ["project.created", "corpus.imported", "corpus.unitized"],
    `demo reset ledgers project.created → corpus.imported → corpus.unitized (got ${types.join(", ")})`);
});

test("reset is idempotent — a second call overwrites the prior bundle deterministically", async () => {
  const first = await ok("POST", "/api/demo/reset", { sampleRows: 5 });
  const second = await ok("POST", "/api/demo/reset", { sampleRows: 5 });
  // Fresh corpusId minted each time — the store's newId() carries a random
  // suffix on top of the timestamp — but the project slug is stable and the
  // corpus count on disk stays 1 (the delete guarantees no drift).
  assert.equal(second.slug, first.slug);
  const project = await ok("GET", `/api/projects/${SLUG}`);
  assert.equal(project.corpora.length, 1, "old corpora do not accumulate — reset overwrites the whole bundle");
  assert.equal(project.corpora[0].id, second.corpusId);
});

test("?sample=3 (query) truncates the CSV rows the same way body.sampleRows does", async () => {
  const data = await ok("POST", "/api/demo/reset?sample=3");
  assert.equal(data.unitCount, 3, "?sample=3 → three units");
});

test("status after a reset flips projectExists to true", async () => {
  const s = await ok("GET", "/api/demo/status");
  assert.equal(s.projectExists, true, "the demo bundle exists after reset");
  assert.equal(s.available, true);
  assert.equal(s.slug, SLUG);
});

test("sample/sampleRows must be a positive integer — anything else is VALIDATION", async () => {
  await fail("POST", "/api/demo/reset", { sampleRows: 0 }, 400, "VALIDATION");
  await fail("POST", "/api/demo/reset", { sampleRows: -1 }, 400, "VALIDATION");
  await fail("POST", "/api/demo/reset", { sampleRows: "cats" }, 400, "VALIDATION");
});
