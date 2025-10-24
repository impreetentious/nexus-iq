// Anthropic Messages API adapter. Structured output via forced tool use:
// the schema becomes the lone "emit" tool and tool_choice pins it.
import { NexusIQError } from "../core/errors.js";
import { Adapter, httpJSON, malformedResponse, mergeCatalogPricing, validateSchema } from "./base.js";

const API_VERSION = "2023-06-01";
const CATALOG_TTL_MS = 60 * 60 * 1000; // 1h, matches routes/catalog.js
const CATALOG_PAGE_CAP = 20; // /v1/models pages are ≤1000 ids; this is a runaway guard

// Pricing is a static estimate (per 1M tokens) used for preflight cost math
// when no live source exists; every entry is marked `estimate: true`.
// Figures verified against docs.anthropic.com pricing + model overview,
// 2025-09 (Claude 3 Opus $15/$75 · 200K ctx; Claude 3.5 Sonnet $3/$15 · 200K ctx; Claude 3.5 Haiku
// $1/$5 · 200K ctx). Re-check on the next model launch — stale numbers here
// feed BOTH preflight estimates and the live budget meter.
//
// `pricingVerifiedAt` is the ISO date of the last human check against the
// provider's public price sheet. It rides the merged catalog entry to the
// UI so a wizard can flag anything older than the staleness budget (see
// routes/catalog.js `freshness.staleAfterDays`). Bump the date whenever
// you re-verify these numbers.
const PRICING_VERIFIED_AT = "2025-09-13";
const STATIC_CATALOG = [
  { id: "claude-3-opus", name: "Claude 3 Opus", family: "anthropic", ctx: 200_000, pricing: { inUSDper1M: 15, outUSDper1M: 75 }, snapshot: "claude-3-opus", estimate: true, pricingVerifiedAt: PRICING_VERIFIED_AT },
  { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", family: "anthropic", ctx: 200_000, pricing: { inUSDper1M: 3, outUSDper1M: 15 }, snapshot: "claude-3-5-sonnet", estimate: true, pricingVerifiedAt: PRICING_VERIFIED_AT },
  { id: "claude-3-5-haiku", name: "Claude 3.5 Haiku", family: "anthropic", ctx: 200_000, pricing: { inUSDper1M: 1, outUSDper1M: 5 }, snapshot: "claude-3-5-haiku", estimate: true, pricingVerifiedAt: PRICING_VERIFIED_AT },
];

export class AnthropicAdapter extends Adapter {
  constructor(cfg = {}) {
    super({ name: "anthropic", apiKey: cfg.apiKey, baseUrl: cfg.baseUrl ?? "https://api.anthropic.com" });
  }

  capabilities() {
    return { structuredOutput: true, pinning: true, batch: false, local: false, family: "anthropic" };
  }

  async complete(req) {
    if (!this.apiKey) {
      throw new NexusIQError("CONFIG_MISSING", "anthropic: no API key configured (Settings → Providers)", { provider: "anthropic" });
    }
    // Anthropic takes the system prompt as a top-level field, not a message.
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const body = {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0,
      messages: req.messages.filter((m) => m.role !== "system"),
    };
    if (system) body.system = system;
    if (req.schema) {
      body.tools = [{ name: "emit", description: "Emit the structured judgment.", input_schema: req.schema }];
      body.tool_choice = { type: "tool", name: "emit" };
    }
    const raw = await httpJSON("POST", `${this.baseUrl}/v1/messages`, {
      headers: { "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
      body,
    });
    // A 200 with an empty/HTML/shapeless body must not TypeError downstream.
    if (!raw || !Array.isArray(raw.content)) throw malformedResponse("anthropic", raw);
    const blocks = raw.content;
    const tool = blocks.find((b) => b.type === "tool_use");
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    // Truncation fast-fail (mirrors openai.js finish_reason==="length"): a
    // structured call that hit max_tokens before the forced tool_use block
    // landed — or that shipped only a PARTIAL block whose input fails the
    // schema — is a token-budget overflow, not a fixable schema error. Throwing
    // SCHEMA_INVALID here (via the repair loop) would mask it; TRUNCATED lets
    // withTruncationRetry double the budget and retry. A complete, schema-valid
    // tool block passes through even when stop_reason is max_tokens (the limit
    // was simply generous). Reasoning-class Claude bills thinking against
    // max_tokens, so this fires far more than the plain max-length case.
    if (req.schema && raw.stop_reason === "max_tokens"
      && (!tool || validateSchema(tool.input, req.schema).length > 0)) {
      throw new NexusIQError(
        "TRUNCATED",
        `anthropic: structured output truncated at the token limit; raise maxTokens (currently ${req.maxTokens ?? "default"}) and retry`,
        { provider: "anthropic", maxTokens: req.maxTokens ?? null, advice: "raise maxTokens" },
      );
    }
    return {
      text: text || undefined,
      json: tool ? tool.input : undefined,
      usage: { inputTokens: raw.usage?.input_tokens ?? 0, outputTokens: raw.usage?.output_tokens ?? 0 },
      finishReason: raw.stop_reason ?? "stop",
      raw,
    };
  }

  staticCatalog() {
    return STATIC_CATALOG.map((m) => ({ ...m, pricing: { ...m.pricing } }));
  }

  // Keyless → static list (and NO network call: a missing key must never fetch).
  // Keyed → live GET /v1/models, paginated, with pricing/ctx merged from the
  // static table by id-prefix; any fetch failure degrades to the static list.
  // Cached in-adapter for 1h; `force` (set by the catalog route on ?refresh=1)
  // bypasses the cache so both layers refresh together.
  async catalog({ force = false } = {}) {
    if (!this.apiKey) return this.staticCatalog();
    if (!force && this._catalogCache && Date.now() - this._catalogCache.at < CATALOG_TTL_MS) {
      return this._catalogCache.data.map((m) => ({ ...m, pricing: { ...m.pricing } }));
    }
    let live;
    try {
      live = await this.#fetchModels();
    } catch {
      return this.staticCatalog(); // fetch failure → unchanged static behavior
    }
    const structuredOutput = this.capabilities().structuredOutput;
    const data = live.map((m) => mergeCatalogPricing(
      { id: m.id, name: m.display_name ?? m.id, family: "anthropic", structuredOutput },
      STATIC_CATALOG,
    ));
    this._catalogCache = { at: Date.now(), data };
    return data.map((m) => ({ ...m, pricing: { ...m.pricing } }));
  }

  async #fetchModels() {
    const out = [];
    let afterId = null;
    for (let page = 0; page < CATALOG_PAGE_CAP; page++) {
      const url = new URL(`${this.baseUrl}/v1/models`);
      url.searchParams.set("limit", "1000");
      if (afterId) url.searchParams.set("after_id", afterId);
      const raw = await httpJSON("GET", url.toString(), {
        headers: { "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
      });
      if (!raw || !Array.isArray(raw.data)) throw malformedResponse("anthropic", raw);
      out.push(...raw.data.filter((m) => m && typeof m.id === "string"));
      if (!raw.has_more) break;
      afterId = raw.last_id ?? out.at(-1)?.id ?? null;
      if (!afterId) break; // can't advance the cursor → stop rather than loop
    }
    return out;
  }
}
