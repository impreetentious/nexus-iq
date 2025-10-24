// One-click guided MockModel demo. Drives /api/demo/reset then walks the
// researcher through the TechCorp exit-survey path with a deterministic
// checklist. Reset is idempotent on the server.

import { el, clear } from "../dom.js";
import api from "../api.js";
import * as router from "../router.js";
import * as toast from "./toast.js";
import * as jobs from "../jobs.js";
import { openSheet, buttonBusy } from "../screens/_shared.js";

const DEMO_SLUG = "techcorp-exit";

const STEPS = [
  { id: "import", title: "Corpus imported", body: "TechCorp Exit Survey is on disk under MockModel — $0, deterministic." },
  { id: "instant", title: "Instant Read", href: () => `p/${DEMO_SLUG}/corpus/{cid}/instant`, body: "Skim columns and unit counts." },
  { id: "brief", title: "Generate a Brief", body: "Director = MockModel. Ask for a reading of the corpus." },
  { id: "constructs", title: "Draft constructs", href: () => `p/${DEMO_SLUG}/constructs`, body: "Name what you want to measure." },
  { id: "instruments", title: "Compile an instrument", href: () => `p/${DEMO_SLUG}/instruments`, body: "Turn a construct into a labeled reader." },
  { id: "run", title: "Run on MockModel", href: () => `p/${DEMO_SLUG}/runs`, body: "Preflight stays at $0.00 with mock." },
];

/** Launch the guided demo sheet. sampleRows optional (tests / fast path). */
export async function startGuidedDemo({ sampleRows } = {}) {
  const s = openSheet({ title: "Guided MockModel demo", overline: "Keyless walkthrough" });
  const status = el("p", { class: "demo-sheet__status" }, "Checking demo assets…");
  const list = el("ol", { class: "demo-sheet__steps", role: "list" });
  s.body.append(
    el("p", {},
      "Resets the ", el("code", {}, DEMO_SLUG),
      " project from ", el("code", {}, "demo/techcorp-exit-survey.csv"),
      ", pins the Director to MockModel, and leaves a checklist you can follow."),
    status,
    list,
  );

  const startBtn = el("button", { class: "btn btn--primary", type: "button" }, "Reset & start demo");
  const cancelBtn = el("button", { class: "btn btn--quiet", type: "button", onclick: () => s.close() }, "Cancel");
  s.foot.append(cancelBtn, startBtn);

  let corpusId = null;
  try {
    const st = await api.demo.status();
    status.textContent = st.csvPresent
      ? (st.projectExists
        ? "A previous demo project exists — reset replaces it deterministically."
        : "Demo CSV is present. Ready to create the project.")
      : "Demo CSV missing from demo/ — cannot start.";
    if (!st.csvPresent) startBtn.disabled = true;
  } catch (err) {
    status.textContent = `Demo status unreachable: ${err.message ?? err}`;
  }

  startBtn.addEventListener("click", async () => {
    const stopBusy = buttonBusy(startBtn, (sec) => `Resetting… ${sec}s`);
    const jobId = `demo:${Date.now()}`;
    jobs.register({ id: jobId, kind: "demo", label: "Guided MockModel demo", detail: "resetting techcorp-exit" });
    try {
      const result = await api.demo.reset({ sampleRows });
      corpusId = result.corpusId;
      jobs.succeed(jobId, { detail: `project ${result.slug} ready` });
      toast.success("Demo project ready.", { detail: "Director is MockModel — no keys required" });
      paintSteps(list, corpusId, result.steps);
      status.textContent = "Demo reset complete. Follow the steps, or jump into Instant Read.";
      stopBusy();
      clear(s.foot).append(
        el("button", { class: "btn btn--quiet", type: "button", onclick: () => s.close() }, "Stay here"),
        el("button", {
          class: "btn btn--primary", type: "button",
          onclick: () => {
            s.close();
            const cid = corpusId;
            router.navigate(cid ? `p/${DEMO_SLUG}/corpus/${cid}/instant` : `p/${DEMO_SLUG}`);
          },
        }, "Open Instant Read →"),
      );
    } catch (err) {
      jobs.fail(jobId, err);
      stopBusy();
      toast.error("Demo reset failed.", { detail: String(err.message ?? err) });
      status.textContent = String(err.message ?? err);
    }
  });
}

function paintSteps(list, corpusId, serverSteps) {
  clear(list);
  // Server returns plain strings; the local STEPS carry hrefs for jumping.
  if (Array.isArray(serverSteps) && serverSteps.length && typeof serverSteps[0] === "string") {
    for (let i = 0; i < serverSteps.length; i++) {
      const local = STEPS[i];
      let href = null;
      if (local && typeof local.href === "function") {
        href = local.href().replace("{cid}", corpusId ?? "");
      }
      list.append(
        el("li", { class: "demo-sheet__step" },
          el("strong", {}, local?.title ?? `Step ${i + 1}`),
          el("span", { class: "faint" }, ` — ${serverSteps[i]}`),
          href ? el("a", { class: "demo-sheet__jump", href: `#/${href}` }, "Open") : null),
      );
    }
    return;
  }
  const steps = Array.isArray(serverSteps) && serverSteps.length ? serverSteps : STEPS;
  for (const step of steps) {
    let href = null;
    if (typeof step.href === "function") href = step.href().replace("{cid}", corpusId ?? "");
    else if (step.href) href = String(step.href).replace("{cid}", corpusId ?? "");
    list.append(
      el("li", { class: "demo-sheet__step" },
        el("strong", {}, step.title ?? step.id),
        el("span", { class: "faint" }, ` — ${step.body ?? ""}`),
        href ? el("a", { class: "demo-sheet__jump", href: `#/${href}` }, "Open") : null),
    );
  }
}

export function demoSlug() {
  return DEMO_SLUG;
}
