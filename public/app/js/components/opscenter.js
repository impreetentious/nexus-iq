// Persistent Operation Center — unified busy/progress language for runs,
// imports, exports, and Director calls. Subscribes to jobs.js via the store.

import { el, clear } from "../dom.js";
import { store } from "../state.js";
import { bus } from "../bus.js";
import * as jobs from "../jobs.js";
import { fmtCount } from "../format.js";

let host = null;
let panel = null;
let listEl = null;
let open = false;

export function init({ mount } = {}) {
  host = mount ?? document.getElementById("opscenter-host");
  if (!host) return;

  const toggle = document.getElementById("ops-toggle");
  panel = el("div", {
    class: "opscenter",
    id: "opscenter",
    hidden: true,
    role: "dialog",
    aria: { label: "Operation center" },
  });
  panel.append(
    el("header", { class: "opscenter__head" },
      el("h2", { class: "opscenter__title" }, "Operations"),
      el("button", {
        class: "opscenter__close",
        type: "button",
        aria: { label: "Close operation center" },
        onclick: close,
      }, "×")),
    listEl = el("div", { class: "opscenter__list", role: "list" }),
    el("p", { class: "opscenter__foot faint" },
      "Runs, imports, exports, and Director calls share this queue. Leaving a screen does not cancel work."),
  );
  host.append(panel);

  toggle?.addEventListener("click", () => (open ? close() : show()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) close();
  });

  store.subscribe("ui.jobs", paint);
  bus.on("jobs:changed", paint);
  paint();
}

export function show() {
  if (!panel) return;
  open = true;
  panel.hidden = false;
  document.getElementById("ops-toggle")?.setAttribute("aria-expanded", "true");
  paint();
}

export function close() {
  if (!panel) return;
  open = false;
  panel.hidden = true;
  document.getElementById("ops-toggle")?.setAttribute("aria-expanded", "false");
}

function paint() {
  const items = jobs.list();
  const active = jobs.activeCount();
  const badge = document.getElementById("ops-badge");
  const toggle = document.getElementById("ops-toggle");
  if (badge) {
    badge.hidden = active === 0;
    badge.textContent = String(active);
  }
  if (toggle) {
    toggle.setAttribute(
      "aria-label",
      active ? `Operation center — ${fmtCount(active)} running` : "Operation center",
    );
    toggle.classList.toggle("ops-toggle--busy", active > 0);
  }
  if (!listEl) return;
  clear(listEl);
  if (!items.length) {
    listEl.append(el("p", { class: "opscenter__empty faint" }, "No operations yet."));
    return;
  }
  for (const job of items.slice(0, 40)) {
    listEl.append(row(job));
  }
}

function row(job) {
  const pct = job.progress && job.progress.total
    ? Math.min(100, Math.round((100 * (job.progress.done ?? 0)) / job.progress.total))
    : null;
  const statusLabel = {
    running: "Running",
    success: "Done",
    error: "Failed",
    cancelled: "Cancelled",
  }[job.status] ?? job.status;

  const body = el("div", { class: "opscenter__row", role: "listitem", dataset: { status: job.status } },
    el("div", { class: "opscenter__row-top" },
      el("span", { class: `opscenter__kind chip chip--${job.kind === "run" ? "machine" : "quiet"}` }, job.kind),
      el("span", { class: "opscenter__label" }, job.label),
      el("span", { class: "opscenter__status data faint" }, statusLabel)),
    job.detail ? el("p", { class: "opscenter__detail faint" }, job.detail) : null,
    pct != null
      ? el("div", { class: "opscenter__track", aria: { hidden: "true" } },
          el("div", { class: "opscenter__fill", style: { width: `${pct}%` } }))
      : job.status === "running"
        ? el("div", { class: "opscenter__indeterminate", role: "status", aria: { label: "In progress" } })
        : null,
  );

  if (job.href) {
    const link = el("a", { class: "opscenter__link", href: `#/${String(job.href).replace(/^#?\/?/, "")}` }, "Open");
    link.addEventListener("click", () => close());
    body.append(link);
  }
  return body;
}
