// Model catalog (aggregated across providers, cached 1 hour) and the provider
// health probe consumed by /api/health (configured keys present, local Ollama
// discovered, mock always true).
import { getAdapter } from "../providers/registry.js";
import { OllamaAdapter } from "../providers/ollama.js";
import { readKeysFile } from "./_shared.js";

const PROVIDERS = ["anthropic", "openai", "openrouter", "ollama", "mock"];
const CATALOG_TTL_MS = 60 * 60 * 1000; // 1 hour
const HEALTH_TTL_MS = 30 * 1000;
const CATALOG_TIMEOUT_MS = 1500; // network catalogs must not wedge the UI

// Freshness policy. Static estimates ride on top of live catalog ids, and
// the accepted design is "estimate: true is fine; stale numbers are not":
// a wizard/warn UI flags any pricingVerifiedAt older than STALE_AFTER_DAYS
// so the researcher knows to re-check the provider's public price sheet.
// The window matches the cadence at which providers meaningfully change
// list pricing (per model launch, ~quarterly). One knob for the whole app.
const STALE_AFTER_DAYS = 90;
const FRESHNESS_POLICY = "estimate-ok-stale-not";

let catalogCache = null; // {at, data}
let healthCache = null; // {at, data}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("catalog timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function buildCatalog({ force = false } = {}) {
  const providers = {};
  for (const name of PROVIDERS) {
    try {
      const { adapter } = getAdapter({ privacyMode: "open" }, name);
      const caps = adapter.capabilities();
      // `force` (from ?refresh=1) busts the in-adapter 1h cache too, so a manual
      // refresh re-fetches live lists instead of serving an adapter-cached page.
      const models = await withTimeout(adapter.catalog({ force }), CATALOG_TIMEOUT_MS);
      // Capability fields for the UI (warn + default-filter, never hard-block):
      // adapters that compute their own per-model flags (openrouter, from
      // supported_parameters) pass through untouched; static catalogs are
      // decorated from capabilities(). params null = no per-model list exists.
      // pricingVerifiedAt (set by mergeCatalogPricing off the static table)
      // rides through here — spreading the model entry LAST keeps the field
      // present on every model the static table priced.
      providers[name] = models.map((m) => ({
        structuredOutput: caps.structuredOutput ?? false,
        noTemperature: false,
        params: null,
        ...m,
      }));
    } catch {
      providers[name] = []; // unreachable/keyless catalog → empty, never an error
    }
  }
  const cachedAt = new Date().toISOString();
  return {
    providers,
    cachedAt,
    // Duplicated at the top level so a wizard can render one policy banner
    // per catalog snapshot without walking every provider.
    staleAfterDays: STALE_AFTER_DAYS,
    freshness: {
      cachedAt,
      staleAfterDays: STALE_AFTER_DAYS,
      policy: FRESHNESS_POLICY,
    },
  };
}

// Used by /api/health in server/index.js: configured keys present / ollama
// discovered / mock always true.
export async function providerHealth() {
  if (healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.data;
  const keys = await readKeysFile().catch(() => ({}));
  const has = (name) => {
    const entry = keys[name];
    if (!entry) return false;
    if (typeof entry === "string") return entry.length > 0;
    return Boolean(entry.apiKey) || Boolean(entry.baseUrl);
  };
  const data = {
    anthropic: has("anthropic"),
    openai: has("openai"),
    openrouter: has("openrouter"),
    ollama: (await OllamaAdapter.discover()) !== null,
    mock: true,
  };
  healthCache = { at: Date.now(), data };
  return data;
}

export default [
  {
    method: "GET",
    pattern: "/api/catalog/models",
    handler: async (req) => {
      const force = req.query.refresh === "1";
      if (force) catalogCache = null;
      if (!catalogCache || Date.now() - catalogCache.at >= CATALOG_TTL_MS) {
        catalogCache = { at: Date.now(), data: await buildCatalog({ force }) };
      }
      return catalogCache.data;
    },
  },
];
