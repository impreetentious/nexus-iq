// Anthropic Messages API adapter. Structured output via forced tool use:
// the schema becomes the lone "emit" tool and tool_choice pins it.
import { NexusIQError } from "../core/errors.js";
import {
  Adapter,
  httpJSON,
  malformedResponse,
  mergeCatalogPricing,
  validateSchema,
} from "./base.js";

const API_VERSION = "2023-06-01";
const CATALOG_TTL_MS = 60 * 60 * 1000; // 1h, matches routes/catalog.js
const CATALOG_PAGE_CAP = 20; // /v1/models pages are ≤1000 ids; this is a runaway guard

// Pricing is a static estimate (per 1M tokens) used for preflight cost math
// when no live source exists; every entry is marked `estimate: true`.
// Figures verified against platform.claude.com/docs/en/about-claude/pricing,
// 2026-08-16 (Fable 5 and Mythos 5 $10/$50; Opus 5 and Opus 4.8 $5/$25;
// Sonnet 5 $2/$10 — the launch introductory rate is now the standard rate;
// Sonnet 4.6 $3/$15; Haiku 4.5 $1/$5). Context: Claude 4.6 and later carry the
// full 1M window at standard pricing, so only Haiku 4.5 keeps 200K. Re-check
// on the next model launch — stale numbers here feed BOTH preflight estimates
// and the live budget meter.
//
// A model MISSING from this table prices at $0 (mergeCatalogPricing's honest
// unknown), which silently zeroes the budget meter and the cap for anyone
// running it — so the current flagships must stay listed.
//
// `pricingVerifiedAt` is the ISO date of the last human check against the
// provider's public price sheet. It rides the merged catalog entry to the
// UI so a wizard can flag anything older than the staleness budget (see
// routes/catalog.js `freshness.staleAfterDays`). Bump the date whenever
// you re-verify these numbers.
const PRICING_VERIFIED_AT = "2026-08-16";
const STATIC_CATALOG = [
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    family: "anthropic",
    ctx: 1_000_000,
    pricing: { inUSDper1M: 5, outUSDper1M: 25 },
    snapshot: "claude-opus-5",
    estimate: true,
    pricingVerifiedAt: PRICING_VERIFIED_AT,
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    family: "anthropic",
    ctx: 1_000_000,
    pricing: { inUSDper1M: 2, outUSDper1M: 10 },
    snapshot: "claude-sonnet-5",
    estimate: true,
    pricingVerifiedAt: PRICING_VERIFIED_AT,
  },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    family: "anthropic",
    ctx: 1_000_000,
    pricing: { inUSDper1M: 10, outUSDper1M: 50 },
    snapshot: "claude-fable-5",
    estimate: true,
    pricingVerifiedAt: PRICING_VERIFIED_AT,
  },
  {
    // Limited availability; listed so a key that CAN reach it still meters.
    id: "claude-mythos-5",
    name: "Claude Mythos 5",
    family: "anthropic",
    ctx: 1_000_000,
    pricing: { inUSDper1M: 10, outUSDper1M: 50 },
    snapshot: "claude-mythos-5",
    estimate: true,
    pricingVerifiedAt: PRICING_VERIFIED_AT,
  },
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    family: "anthropic",
    ctx: 1_000_000,
    pricing: { inUSDper1M: 5, outUSDper1M: 25 },
    snapshot: "claude-opus-4-8",
    estimate: true,
    pricingVerifiedAt: PRICING_VERIFIED_AT,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    family: "anthropic",
    ctx: 1_000_000,
    pricing: { inUSDper1M: 3, outUSDper1M: 15 },
    snapshot: "claude-sonnet-4-6",
    estimate: true,
    pricingVerifiedAt: PRICING_VERIFIED_AT,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    family: "anthropic",
    ctx: 200_000,
    pricing: { inUSDper1M: 1, outUSDper1M: 5 },
    snapshot: "claude-haiku-4-5",
    estimate: true,
    pricingVerifiedAt: PRICING_VERIFIED_AT,
  },
];

// Current-generation Anthropic models REMOVED the sampling knobs: sending a
// NON-DEFAULT temperature/top_p/top_k to Opus 4.7+ or any Claude 5 model is a
// hard 400 (non-retryable — the affected unit would quarantine). Judges always
// request temperature 0, which is non-default everywhere, so every one of
// these must take the omit path. Steering is by prompt instead. Prefix match
// so dated snapshots inherit. This is the fast path; the parameter-rejection
// 400 retry in complete() is the backstop for any model released after this
// list (or a snapshot the prefix misses).
const NO_SAMPLING_PREFIXES = [
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-mythos-5",
];
export function rejectsSampling(model) {
  const id = String(model ?? "");
  return NO_SAMPLING_PREFIXES.some((p) => id.startsWith(p));
}

// A 400 whose message names a sampling parameter — the signal to retry without
// it. Anthropic phrases these as "temperature: ... unexpected" / "not
// supported"; match the param names defensively rather than the exact prose.
function isSamplingParamError(err) {
  if (err?.code !== "PROVIDER_HTTP" || err?.details?.status !== 400) return false;
  const body = err.details.body;
  const msg = (typeof body === "string" ? body : JSON.stringify(body ?? "")).toLowerCase();
  return /temperature|top_p|top_k|sampling/.test(msg);
}

export class AnthropicAdapter extends Adapter {
  constructor(cfg = {}) {
    super({
      name: "anthropic",
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl ?? "https://api.anthropic.com",
    });
  }

  capabilities() {
    return {
      structuredOutput: true,
      pinning: true,
      batch: false,
      local: false,
      family: "anthropic",
    };
  }

  async complete(req) {
    if (!this.apiKey) {
      throw new NexusIQError(
        "CONFIG_MISSING",
        "anthropic: no API key configured (Settings → Providers)",
        { provider: "anthropic" },
      );
    }
    // Anthropic takes the system prompt as a top-level field, not a message.
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const body = {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      messages: req.messages.filter((m) => m.role !== "system"),
    };
    // Only send temperature to models that accept it (default 0 for judge
    // determinism); omit it entirely for the current-gen models that reject
    // it. Callers always request 0 — omitting means the model runs at its own
    // default, which for these reasoning models is the only supported setting.
    if (system) body.system = system;
    if (req.schema) {
      body.tools = [
        { name: "emit", description: "Emit the structured judgment.", input_schema: req.schema },
      ];
      body.tool_choice = { type: "tool", name: "emit" };
    }
    const post = (sampling) => {
      const b = sampling ? { ...body, temperature: req.temperature ?? 0 } : body;
      return httpJSON("POST", `${this.baseUrl}/v1/messages`, {
        headers: { "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
        body: b,
      });
    };
    let raw;
    if (rejectsSampling(req.model)) {
      raw = await post(false);
    } else {
      try {
        raw = await post(true);
      } catch (err) {
        // Backstop for a rejecter the prefix list doesn't know yet: one retry
        // without the sampling param. A 400 is non-retryable at the Pool, so
        // this is the only place it can self-heal.
        if (!isSamplingParamError(err)) throw err;
        raw = await post(false);
      }
    }
    // A 200 with an empty/HTML/shapeless body must not TypeError downstream.
    if (!raw || !Array.isArray(raw.content)) throw malformedResponse("anthropic", raw);
    const blocks = raw.content;
    const tool = blocks.find((b) => b.type === "tool_use");
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    // Truncation fast-fail (mirrors openai.js finish_reason==="length"): a
    // structured call that hit max_tokens before the forced tool_use block
    // landed — or that shipped only a PARTIAL block whose input fails the
    // schema — is a token-budget overflow, not a fixable schema error. Throwing
    // SCHEMA_INVALID here (via the repair loop) would mask it; TRUNCATED lets
    // withTruncationRetry double the budget and retry. A complete, schema-valid
    // tool block passes through even when stop_reason is max_tokens (the limit
    // was simply generous). Reasoning-class Claude bills thinking against
    // max_tokens, so this fires far more than the plain max-length case.
    if (
      req.schema &&
      raw.stop_reason === "max_tokens" &&
      (!tool || validateSchema(tool.input, req.schema).length > 0)
    ) {
      throw new NexusIQError(
        "TRUNCATED",
        `anthropic: structured output truncated at the token limit; raise maxTokens (currently ${req.maxTokens ?? "default"}) and retry`,
        { provider: "anthropic", maxTokens: req.maxTokens ?? null, advice: "raise maxTokens" },
      );
    }
    return {
      text: text || undefined,
      json: tool ? tool.input : undefined,
      usage: {
        inputTokens: raw.usage?.input_tokens ?? 0,
        outputTokens: raw.usage?.output_tokens ?? 0,
      },
      finishReason: raw.stop_reason ?? "stop",
      raw,
    };
  }

  // `noTemperature` is derived from rejectsSampling(), never hand-listed, so
  // the wire behaviour and the UI can never disagree: routes/catalog.js
  // defaults static catalogs to noTemperature:false and spreads the entry
  // LAST, so without this the model picker offered a temperature control for
  // models whose temperature complete() deliberately drops on the wire.
  staticCatalog() {
    return STATIC_CATALOG.map((m) => ({
      ...m,
      pricing: m.pricing ? { ...m.pricing } : null,
      noTemperature: rejectsSampling(m.id),
    }));
  }

  // Keyless → static list (and NO network call: a missing key must never fetch).
  // Keyed → live GET /v1/models, paginated, with pricing/ctx merged from the
  // static table by id-prefix; any fetch failure degrades to the static list.
  // Cached in-adapter for 1h; `force` (set by the catalog route on ?refresh=1)
  // bypasses the cache so both layers refresh together.
  async catalog({ force = false } = {}) {
    if (!this.apiKey) return this.staticCatalog();
    if (!force && this._catalogCache && Date.now() - this._catalogCache.at < CATALOG_TTL_MS) {
      return this._catalogCache.data.map((m) => ({
        ...m,
        pricing: m.pricing ? { ...m.pricing } : null,
      }));
    }
    let live;
    try {
      live = await this.#fetchModels();
    } catch {
      return this.staticCatalog(); // fetch failure → unchanged static behavior
    }
    const structuredOutput = this.capabilities().structuredOutput;
    const data = live.map((m) =>
      mergeCatalogPricing(
        {
          id: m.id,
          name: m.display_name ?? m.id,
          family: "anthropic",
          structuredOutput,
          noTemperature: rejectsSampling(m.id),
        },
        STATIC_CATALOG,
      ),
    );
    this._catalogCache = { at: Date.now(), data };
    return data.map((m) => ({ ...m, pricing: m.pricing ? { ...m.pricing } : null }));
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
