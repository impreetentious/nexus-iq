// The ONLY sanctioned constructor path for adapters. Privacy modes are
// enforced here — before any key is read and before any object that could
// touch the network exists. Overrides return a ledgerEvent for the CALLER to
// append; this module never writes the ledger itself.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NexusIQError } from "../core/errors.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";
import { OpenRouterAdapter } from "./openrouter.js";
import { OllamaAdapter } from "./ollama.js";
import { MockAdapter } from "./mock.js";

// Module-private on purpose: exporting raw constructors would let callers
// bypass the privacy gates below. getAdapter() is the only way out.
const PROVIDERS = Object.freeze({
  anthropic: AnthropicAdapter,
  openai: OpenAIAdapter,
  openrouter: OpenRouterAdapter,
  ollama: OllamaAdapter,
  mock: MockAdapter,
});

const LOCAL = new Set(["mock", "ollama"]);
const NO_TRAINING_ALLOW = new Set(["anthropic", "openai"]);
const MODES = new Set(["open", "no-training", "strict"]);

// "strict" means ON-MACHINE, not "provider named ollama": keys.json may point
// the ollama adapter at any baseUrl, so the endpoint itself must prove local.
// Only literal loopback hosts qualify — a DNS name that happens to resolve to
// 127.0.0.1 today can be re-pointed off-machine tomorrow, so names other than
// "localhost" fail closed.
export function isLoopbackBaseUrl(baseUrl) {
  if (baseUrl === undefined || baseUrl === null || baseUrl === "") return true; // adapter default is localhost
  let host;
  try {
    host = new URL(String(baseUrl)).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false; // unparseable → fail closed
  }
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

// Adapter instances are memoized per (providerName, keysPath, resolved
// baseUrl): stateful adapters (mock's oracle/handlers) must survive across
// getAdapter calls, and reconstructing per call wastes work. Only
// CONSTRUCTION is cached — the privacy gates below run on every call, so a
// strict project is still blocked even if an open project already
// constructed the same adapter. clearAdapterCache() is for tests and for
// settings changes (e.g. rotated API keys, which the cache key cannot see).
const adapterCache = new Map();

export function clearAdapterCache() {
  adapterCache.clear();
}

// getAdapter(project, providerName, {justification?, keysPath?})
// → {adapter, ledgerEvent: null | {actor, type, refs, payload}}
export function getAdapter(project, providerName, { justification, keysPath } = {}) {
  const Ctor = PROVIDERS[providerName];
  if (!Ctor) {
    throw new NexusIQError("CONFIG_MISSING", `unknown provider "${providerName}"`, {
      provider: providerName, known: Object.keys(PROVIDERS),
    });
  }

  const mode = project?.privacyMode;
  if (mode === undefined || mode === null) {
    // Fail closed: a caller that omits the privacy mode gets no adapter, not
    // the most permissive one. Stored projects always carry a validated mode
    // (objects.js defaults to "open" at creation), so only malformed callers
    // land here.
    throw new NexusIQError("PRIVACY_BLOCKED", "privacy mode missing from project; refusing to construct an adapter", {
      mode: null, provider: providerName,
    });
  }
  if (!MODES.has(mode)) {
    // Fail closed: an unrecognized mode is config corruption, not permission.
    throw new NexusIQError("PRIVACY_BLOCKED", `unknown privacy mode "${mode}"`, { mode, provider: providerName });
  }

  let ledgerEvent = null;
  if (mode === "strict" && !LOCAL.has(providerName)) {
    throw new NexusIQError(
      "PRIVACY_BLOCKED",
      `privacy mode "strict" permits only local backends (mock, ollama); "${providerName}" sends data off-machine`,
      { mode, provider: providerName },
    );
  }
  if (mode === "no-training" && !LOCAL.has(providerName) && !NO_TRAINING_ALLOW.has(providerName)) {
    if (typeof justification !== "string" || justification.trim() === "") {
      throw new NexusIQError(
        "PRIVACY_BLOCKED",
        `privacy mode "no-training" blocks "${providerName}"; pass a written justification to override (it will be ledgered)`,
        { mode, provider: providerName },
      );
    }
    ledgerEvent = {
      actor: "human",
      type: "privacy.override",
      refs: { provider: providerName },
      payload: { justification },
    };
  }

  const path = keysPath ?? resolve(process.cwd(), "config", "keys.json");
  const entry = normalizeEntry(readKeys(path)[providerName]);
  if (mode === "strict" && providerName === "ollama" && !isLoopbackBaseUrl(entry.baseUrl)) {
    throw new NexusIQError(
      "PRIVACY_BLOCKED",
      `privacy mode "strict" permits only on-machine backends; the configured ollama baseUrl "${entry.baseUrl}" is not a loopback address`,
      { mode, provider: providerName, baseUrl: entry.baseUrl },
    );
  }
  const cacheKey = `${providerName}\x00${path}\x00${entry.baseUrl ?? ""}`;
  let adapter = adapterCache.get(cacheKey);
  if (!adapter) {
    adapter = new Ctor(entry);
    adapterCache.set(cacheKey, adapter);
  }
  return { adapter, ledgerEvent };
}

// keys.json may be absent (→ keyless adapter: complete() throws
// CONFIG_MISSING, catalog() still serves the static fallback). A present but
// malformed file is loud, never silently ignored.
function readKeys(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new NexusIQError("CONFIG_MISSING", `cannot read ${path}: ${err.message}`, { path });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new NexusIQError("CONFIG_MISSING", `keys file is not valid JSON: ${err.message}`, { path });
  }
}

// Entries may be a bare key string or {apiKey, baseUrl}.
function normalizeEntry(entry) {
  if (!entry) return {};
  if (typeof entry === "string") return { apiKey: entry };
  return { apiKey: entry.apiKey, baseUrl: entry.baseUrl };
}
