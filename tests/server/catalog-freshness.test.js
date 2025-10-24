// Pricing / capability freshness stamps — pins the accepted design
// "estimate: true is fine; stale numbers are not".
//
// Contract under test:
//   - Each entry in the anthropic (and openai) STATIC_CATALOG carries an ISO
//     `pricingVerifiedAt` date — reachable via adapter.catalog() with no key,
//     which serves the static list unchanged.
//   - mergeCatalogPricing propagates that stamp onto a merged (live) entry.
//   - GET /api/catalog/models keeps `cachedAt`, adds `staleAfterDays: 90`
//     alongside a top-level `freshness: {cachedAt, staleAfterDays, policy}`
//     envelope, and each priced model retains its `pricingVerifiedAt`.
//
// Harness: reuse the shared server harness pattern so we exercise the real
// route wiring, not the buildCatalog function in isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startServer } from "../../server/index.js";
import { AnthropicAdapter } from "../../server/providers/anthropic.js";
import { OpenAIAdapter } from "../../server/providers/openai.js";
import { mergeCatalogPricing } from "../../server/providers/base.js";

let tmpProjects;
let tmpConfig;
let srv;
let base;

before(async () => {
  tmpProjects = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-fresh-"));
  tmpConfig = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-fresh-cfg-"));
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

test("adapter.catalog() carries pricingVerifiedAt on every anthropic static model", async () => {
  const adapter = new AnthropicAdapter({}); // keyless → the static list, no network
  const models = await adapter.catalog();
  assert.ok(models.length > 0, "anthropic ships a non-empty static catalog");
  for (const m of models) {
    assert.match(m.pricingVerifiedAt ?? "", ISO_DATE,
      `${m.id} should carry an ISO pricingVerifiedAt (got ${JSON.stringify(m.pricingVerifiedAt)})`);
    assert.equal(m.estimate, true, `${m.id} is a static estimate`);
  }
});

test("adapter.catalog() carries pricingVerifiedAt on every openai static model", async () => {
  const adapter = new OpenAIAdapter({}); // keyless → the static list
  const models = await adapter.catalog();
  assert.ok(models.length > 0);
  for (const m of models) {
    assert.match(m.pricingVerifiedAt ?? "", ISO_DATE,
      `${m.id} should carry an ISO pricingVerifiedAt (got ${JSON.stringify(m.pricingVerifiedAt)})`);
  }
});

test("mergeCatalogPricing propagates pricingVerifiedAt from the matched static entry", () => {
  const statics = [
    { id: "foo-1", name: "Foo 1", ctx: 100, pricing: { inUSDper1M: 1, outUSDper1M: 2 }, snapshot: "foo-1", estimate: true, pricingVerifiedAt: "2026-07-01" },
  ];
  // Prefix match on a dated snapshot inherits the bare entry's date.
  const merged = mergeCatalogPricing({ id: "foo-1-20260515", name: "Foo 1 (2026-05-15)", family: "test" }, statics);
  assert.equal(merged.pricingVerifiedAt, "2026-07-01", "the stamp rides the merged result");
  assert.equal(merged.pricing.inUSDper1M, 1);

  // No match → no fabricated date on the merged result (unpriced entries have
  // nothing to certify).
  const unpriced = mergeCatalogPricing({ id: "bar-2", name: "Bar", family: "test" }, statics);
  assert.equal(unpriced.pricingVerifiedAt, undefined);
  assert.equal(unpriced.estimate, true);
  assert.equal(unpriced.pricing.inUSDper1M, 0);
});

async function ok(url) {
  const r = await fetch(base + url);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j?.ok, true);
  return j.data;
}

test("GET /api/catalog/models exposes the freshness envelope and per-model stamps", async () => {
  const data = await ok("/api/catalog/models");
  assert.equal(typeof data.cachedAt, "string", "cachedAt is preserved");
  assert.equal(data.staleAfterDays, 90, "policy constant reaches the wire");
  assert.deepEqual(
    { cachedAt: data.freshness?.cachedAt, staleAfterDays: data.freshness?.staleAfterDays, policy: data.freshness?.policy },
    { cachedAt: data.cachedAt, staleAfterDays: 90, policy: "estimate-ok-stale-not" },
    "freshness envelope carries the policy + staleness budget",
  );
  // Every static-priced anthropic/openai model surfaces its pricingVerifiedAt.
  const providers = data.providers ?? {};
  assert.ok(Array.isArray(providers.anthropic) && providers.anthropic.length > 0);
  for (const m of providers.anthropic) {
    assert.match(m.pricingVerifiedAt ?? "", ISO_DATE, `anthropic model ${m.id} should carry pricingVerifiedAt`);
  }
  for (const m of providers.openai ?? []) {
    assert.match(m.pricingVerifiedAt ?? "", ISO_DATE, `openai model ${m.id} should carry pricingVerifiedAt`);
  }
});
