// Settings — #/p/:slug/settings (project) and #/settings (global). Provider
// cards with key entry (masked after save) and a reachability dot, the model
// catalog browser, the Director slot, the privacy-mode selector whose
// downgrade path demands an explicit confirmation (and says it is ledgered),
// the budget cap, theme, and a v1 danger zone that is honestly empty.

import { el, clear } from "../dom.js";
import api from "../api.js";
import * as toast from "../components/toast.js";
import * as modelpicker from "../components/modelpicker.js";
import { store } from "../state.js";
import { fmtCost } from "../format.js";
import { screenHead, section, asyncMount, ensureProject, openSheet, emptyState, buttonBusy } from "./_shared.js";

export const route = "settings";
export const routes = ["settings", "p/:slug/settings"];
export const title = "Settings";

const PRIVACY_ORDER = { open: 0, "no-training": 1, strict: 2 };
// Copy states exactly what the adapter gate enforces. The registry carries a
// justification-override capability for no-training, but no product surface
// reaches it in v1 (roadmap) — so the copy must not promise an override path.
// Strict mode gates PROJECT TEXT, not all network: provider model-catalog
// fetches (model lists, no project data) still happen.
const PRIVACY_DESC = {
  open: "Any configured backend may read project text.",
  "no-training": "Only backends with contractual no-training terms, plus local models.",
  strict: "Only local backends (Ollama, mock) can receive this project's text — including the Director. Provider model-catalog fetches (model lists, no project data) still occur.",
};

// Mirror of the server registry's privacy gates (server/providers/registry.js)
// so Settings can WARN at save time about a Director that will be blocked at
// use time. The server stays the enforcer; this is the courtesy copy.
const LOCAL_PROVIDERS = new Set(["mock", "ollama"]);
const NO_TRAINING_ALLOWED = new Set(["anthropic", "openai", "mock", "ollama"]);
function privacyBlocks(mode, provider) {
  if (mode === "strict" && !LOCAL_PROVIDERS.has(provider)) {
    return `strict mode only allows local models (mock, ollama), not ${provider}.`;
  }
  if (mode === "no-training" && !NO_TRAINING_ALLOWED.has(provider)) {
    // (the registry's logged-justification override is unreachable in v1
    // product code — do not advertise it; roadmap)
    return `no-training mode blocks ${provider} (no contractual no-training terms). Switch the project to open, or use anthropic/openai/local.`;
  }
  return null;
}

export function render(mount, params) {
  const projectScoped = Boolean(params.slug);
  asyncMount(mount, async () => {
    const project = projectScoped ? await ensureProject(params.slug) : null;
    const [settings, catalogRes, health, diag] = await Promise.all([
      api.settings.get().catch(() => null),          // live: {keys, port}
      api.catalog.models().catch(() => ({ providers: {} })), // live: {providers, cachedAt, freshness}
      api.health().catch(() => null),                // live: {ok, version, providers: {name: bool}}
      api.diagnostics.system().catch(() => null),
    ]);
    return { project, settings, catalogRes, catalog: catalogRes?.providers ?? {}, health, diag };
  }, ({ project, settings, catalogRes, catalog, health, diag }) => {
    mount.append(screenHead({
      overline: projectScoped ? `Settings · ${project?.name ?? params.slug}` : "Settings",
      title: projectScoped ? "This project's rules." : "Nexus IQ's defaults.",
      lede: "Keys live in config/, outside every project bundle and every archive. Privacy is enforced at the adapter, not promised by the UI.",
      actions: [
        el("button", {
          class: "btn btn--quiet", type: "button",
          onclick: () => openProviderWizard({ settings, health, catalog, catalogRes, project, slug: params.slug }),
        }, "Provider setup wizard"),
      ],
    }));

    if (!settings) {
      mount.append(emptyState({
        title: "Settings are unreachable.",
        body: "The server holds keys and defaults; static preview cannot read them.",
      }));
      return;
    }

    /* ---- provider cards: names from health (the canonical list), key
       state from settings.keys ({configured, apiKey: masked, baseUrl?}) ---- */
    const providerNames = [...new Set([
      ...Object.keys(health?.providers ?? {}),
      ...Object.keys(settings.keys ?? {}),
    ])];
    const provGrid = el("div", { class: "provgrid" });
    for (const name of providerNames) {
      provGrid.append(providerCard(name, settings.keys?.[name] ?? {}, health?.providers?.[name]));
    }
    mount.append(section("Providers", provGrid));

    /* ---- model catalog + freshness stamps ---- */
    const freshness = catalogRes?.freshness ?? {
      cachedAt: catalogRes?.cachedAt,
      staleAfterDays: catalogRes?.staleAfterDays ?? 90,
      policy: "estimate-ok-stale-not",
    };
    mount.append(section("Model catalog",
      freshnessBanner(freshness, catalog),
      catalogTable(catalog),
      el("p", { class: "screen__hint faint" },
        "Estimates are fine (", el("code", {}, "estimate: true"),
        "); stale verified dates are not. Parameter support varies by model — a rejected call pauses the run with the provider's error.")));

    /* ---- Director slot — a PROJECT field, saved via PUT /api/settings
       {project: {slug, director}} (no global Director exists) ---- */
    if (projectScoped && project) {
      const director = { ...(project.director ?? {}) };
      const providers = Object.keys(catalog ?? {});
      // No slot configured yet: seed the working copy from what the picker
      // will DISPLAY, so "Save" saves what the researcher sees. Mock first —
      // it is the honest keyless default.
      if (!director.provider) director.provider = providers.includes("mock") ? "mock" : providers[0];
      if (!director.model) director.model = (catalog?.[director.provider] ?? [])[0]?.id ?? null;
      const dirPicker = modelpicker.render({
        catalog,
        value: { provider: director.provider, model: director.model },
        structuredFilter: true,
        label: "Director model",
        onPick: ({ provider, entry }) => { director.provider = provider; director.model = entry.id; },
      });

      mount.append(section("The Director's slot",
        el("p", { class: "screen__hint faint" },
          "The Director drafts, compiles, tunes, escalates — and is metered like any other model. In strict mode it must be local."),
        el("div", { class: "controlrow" },
          el("div", { class: "controlrow__item controlrow__item--grow" },
            el("span", { class: "overline" }, "model"), dirPicker.el),
          el("button", {
            class: "btn", type: "button",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                await api.settings.update({ project: { slug: params.slug, director } });
                toast.success("Director updated.", { detail: `${director.provider} · ${director.model}`, data: true });
                // The save is project policy; the privacy gate fires at USE.
                // Warn now if this combination will be blocked then — the
                // silent version of this trap cost a researcher an afternoon.
                const blockedBy = privacyBlocks(project.privacyMode, director.provider);
                if (blockedBy) toast.warn(`This Director will be blocked at use: ${blockedBy}`, { duration: 9000 });
              } catch (err) {
                toast.error("Could not update the Director.", { detail: String(err.message ?? err) });
              }
              e.target.disabled = false;
            },
          }, "Save")),
        el("label", { class: "field" },
          el("span", { class: "field__label overline" }, "system suffix — appended to every Director prompt"),
          el("textarea", {
            class: "input textarea", rows: 2, "aria-label": "Director system suffix",
            oninput: (e) => { director.systemSuffix = e.target.value; },
          }, director.systemSuffix ?? ""))));
    }

    /* ---- project-scoped: privacy + budget ---- */
    if (projectScoped && project) {
      mount.append(section("Privacy mode", privacyEditor(params, project)));
      mount.append(section("Budget", budgetEditor(params, project)));
    }

    /* ---- theme ---- */
    mount.append(section("Theme",
      el("div", { class: "controlrow" },
        ...["auto", "light", "dark"].map((t) =>
          el("button", {
            class: "btn", type: "button",
            "aria-pressed": (store.get("ui.theme") ?? "auto") === t ? "true" : "false",
            onclick: () => {
              if (t === "auto") {
                try { localStorage.removeItem("nexus-iq-theme"); } catch { /* private mode */ }
                document.documentElement.toggleAttribute("data-theme", false);
                if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.setAttribute("data-theme", "dark");
                store.set("ui.theme", "auto");
              } else {
                if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
                else document.documentElement.removeAttribute("data-theme");
                try { localStorage.setItem("nexus-iq-theme", t); } catch { /* private mode */ }
                store.set("ui.theme", t);
              }
              toast.info(`Theme: ${t}.`, { duration: 1500 });
            },
          }, t)))));

    /* ---- diagnostics / support bundle ---- */
    mount.append(section("Diagnostics & backup",
      el("div", { class: "diag-panel" },
        el("p", { class: "screen__hint" },
          "Support bundles are diagnostic snapshots — keys and PII vaults are never included. ",
          "They are ", el("strong", {}, "not"), " restore archives. See ",
          el("code", {}, "docs/support-bundle.md"), " and ",
          el("code", {}, "docs/backup-restore.md"), "."),
        diag
          ? el("p", { class: "data faint" },
              `v${diag.version} · ${diag.node} · ${diag.platform} · bundleFormat ${diag.bundleFormat} · ${diag.projectsCount} projects`)
          : el("p", { class: "faint" }, "System diagnostics unavailable."),
        el("div", { class: "diag-actions" },
          projectScoped
            ? el("button", {
                class: "btn", type: "button",
                onclick: () => {
                  api.diagnostics.downloadSupportBundle(params.slug);
                  toast.info("Downloading support bundle…", { detail: "keys and vaults excluded" });
                },
              }, "Download support bundle")
            : el("p", { class: "faint" }, "Open a project’s settings to download its support bundle."),
          el("button", {
            class: "btn btn--quiet", type: "button",
            onclick: async () => {
              try {
                const d = await api.diagnostics.system();
                toast.success("Diagnostics refreshed.", {
                  detail: `v${d.version} · ${d.projectsCount} projects · format ${d.bundleFormat}`,
                });
              } catch (err) {
                toast.error("Diagnostics failed.", { detail: String(err.message ?? err) });
              }
            },
          }, "Refresh system diagnostics")))));

    /* ---- danger zone ---- */
    mount.append(section("Danger zone",
      el("p", { class: "faint" },
        "Nothing dangerous lives here in v1. Project bundles are plain folders under ",
        el("code", {}, "projects/"),
        " — copy, back up, or delete them in your file manager. The ledger inside each bundle keeps its own history.")));
  }, "Reading the configuration…");
}

/* ================= pieces ================================================================ */

// Live key entry (GET /api/settings → keys[name]): {configured, apiKey:
// <masked>, baseUrl?}. Reachability is the health probe's boolean. Keys save
// via PUT /api/settings {keys: {name: <key>}} → response keys[name].apiKey.
function providerCard(name, entry, reachable) {
  const local = LOCAL_PROVIDERS.has(name);
  // three states, matching the visual: ok dot = reachable, down dot = a
  // definite refusal, no dot = the probe could not answer (status unknown) —
  // the aria text must never claim "not reachable" for an unanswered probe
  const dot = el("span", {
    class: `status-dot ${reachable === true ? "status-dot--ok" : reachable === false ? "status-dot--down" : ""}`,
    role: "img",
    aria: { label: `${name} ${reachable === true ? "reachable" : reachable === false ? "not reachable" : "status unknown"}` },
  });
  const keyHost = el("div", { class: "provcard__key" });

  const paintMasked = (masked) => {
    clear(keyHost).append(
      el("span", { class: "data provcard__masked" }, masked ?? "no key"),
      el("button", {
        class: "btn btn--quiet", type: "button",
        onclick: () => paintInput(),
      }, masked ? "replace" : "add key"));
  };
  const paintInput = () => {
    const input = el("input", { class: "input", type: "password", placeholder: `${name} API key`, "aria-label": `${name} API key` });
    clear(keyHost).append(input,
      el("button", {
        class: "btn", type: "button",
        onclick: async (e) => {
          if (!input.value.trim()) { input.focus(); return; }
          e.target.disabled = true;
          try {
            const updated = await api.settings.update({ keys: { [name]: input.value.trim() } });
            const masked = updated?.keys?.[name]?.apiKey ?? maskKey(input.value.trim());
            toast.success(`${name} key saved.`, { detail: "stored in config/keys.json — outside every bundle", data: false });
            paintMasked(masked);
          } catch (err) {
            e.target.disabled = false;
            toast.error("Key not saved.", { detail: String(err.message ?? err) });
          }
        },
      }, "Save"));
    input.focus();
  };

  if (local) {
    keyHost.append(el("span", { class: "faint" }, entry.baseUrl ?? "local — no key needed"));
  } else {
    paintMasked(entry.configured ? entry.apiKey ?? "•••• saved" : null);
  }

  return el("div", { class: "provcard" },
    el("div", { class: "provcard__head" },
      dot,
      el("h3", { class: "provcard__name" }, name),
      local ? el("span", { class: "chip chip--ghost" }, "local") : null),
    keyHost,
    name === "mock" ? el("p", { class: "faint provcard__note" }, "deterministic, $0 — powers the keyless demo and tests") : null,
  );
}

function maskKey(key) {
  return key.length > 8 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "•••• saved";
}

function privacyEditor(params, project) {
  let mode = project.privacyMode ?? "open";
  const wrap = el("div", {});
  const radios = el("div", { class: "choicelist", role: "radiogroup", aria: { label: "Privacy mode" } },
    ...Object.keys(PRIVACY_DESC).map((m) =>
      el("label", { class: "choice" },
        el("input", {
          type: "radio", name: "privacymode", value: m, checked: m === mode,
          onchange: () => requestChange(m),
        }),
        el("span", { class: "choice__text" },
          el("span", { class: "choice__label" }, m),
          el("span", { class: "choice__hint" }, PRIVACY_DESC[m])))));
  wrap.append(radios);

  function resetRadios() {
    for (const input of radios.querySelectorAll("input")) input.checked = input.value === mode;
  }

  function requestChange(next) {
    if (next === mode) return;
    const downgrade = PRIVACY_ORDER[next] < PRIVACY_ORDER[mode];
    if (!downgrade) {
      applyChange(next, false);
      return;
    }
    // downgrade: explicit confirmation, ledgered
    const s = openSheet({ title: "Loosen the privacy mode?", overline: "This is ledgered" });
    let confirmed = false;
    const checkbox = el("input", { type: "checkbox", onchange: (e) => { confirmed = e.target.checked; goBtn.disabled = !confirmed; } });
    const goBtn = el("button", {
      class: "btn btn--primary", type: "button", disabled: true,
      onclick: () => { s.close(); applyChange(next, true); },
    }, `Change to ${next}`);
    s.body.append(
      el("p", {}, `From `, el("strong", {}, mode), ` to `, el("strong", {}, next), `. ${PRIVACY_DESC[next]}`),
      el("p", { class: "screen__hint" }, "Loosening privacy means backends that could not see this corpus now can. The change is written to the project ledger (privacy.mode_changed) with your confirmation."),
      el("label", { class: "switch" }, checkbox, el("span", {}, "I understand what this exposes, and I want the change recorded.")),
    );
    s.foot.append(
      el("button", { class: "btn btn--quiet", type: "button", onclick: () => { s.close(); resetRadios(); } }, "Keep " + mode),
      goBtn);
  }

  async function applyChange(next, confirmDowngrade) {
    try {
      // PUT /api/projects/:p — the same downgrade guard + privacy.mode_changed
      // ledger as the settings route (one shared server helper)
      await api.projects.update(params.slug, {
        privacyMode: next,
        ...(confirmDowngrade ? { confirmDowngrade: true } : {}),
      });
      mode = next;
      store.set("ui.privacyMode", next);
      const project2 = store.get("project");
      if (project2) { project2.privacyMode = next; store.set("project", project2); }
      resetRadios();
      toast.success(`Privacy mode: ${next}.`, { detail: "privacy.mode_changed written to the ledger", data: true });
    } catch (err) {
      resetRadios();
      toast.error("Privacy change failed.", { detail: String(err.message ?? err) });
    }
  }

  return wrap;
}

function budgetEditor(params, project) {
  const budget = project.budget ?? { capUSD: null, spentUSD: 0 };
  const input = el("input", {
    class: "input input--num", type: "number", min: 0, step: "1",
    value: budget.capUSD ?? "", placeholder: "none",
    "aria-label": "Project budget cap in USD",
  });
  return el("div", { class: "controlrow" },
    el("label", { class: "controlrow__item" },
      el("span", { class: "overline" }, "hard cap"), input, el("span", { class: "faint" }, "USD")),
    el("span", { class: "controlrow__item data" }, `spent so far: ${fmtCost(budget.spentUSD ?? 0)}`),
    el("button", {
      class: "btn", type: "button",
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await api.projects.update(params.slug, { budget: { capUSD: input.value === "" ? null : Number(input.value) } });
          toast.success("Budget cap saved.", { detail: input.value === "" ? "no cap" : fmtCost(Number(input.value)), data: true });
        } catch (err) {
          toast.error("Budget not saved.", { detail: String(err.message ?? err) });
        }
        e.target.disabled = false;
      },
    }, "Save"));
}
