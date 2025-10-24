// Centralized operation / job state. Runs, imports, exports, and Director
// calls register here so the Operation Center and busy language stay unified
// across navigation. DOM-free; the UI subscribes via store/bus.

import { bus } from "./bus.js";
import { store } from "./state.js";

const jobs = new Map(); // id → job

function seedStore() {
  store.set("ui.jobs", list());
}

/** @returns {Array<object>} newest-first active+recent jobs */
export function list() {
  return [...jobs.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function get(id) {
  return jobs.get(id) ?? null;
}

/**
 * register({ id, kind, label, detail?, href?, progress? })
 * kind: "run" | "import" | "export" | "director" | "demo" | "other"
 * progress: { done, total } | null for indeterminate
 */
export function register(spec) {
  const id = String(spec.id);
  const now = Date.now();
  const job = {
    id,
    kind: spec.kind ?? "other",
    label: spec.label ?? id,
    detail: spec.detail ?? "",
    href: spec.href ?? null,
    status: "running", // running | success | error | cancelled
    progress: spec.progress ?? null,
    createdAt: now,
    updatedAt: now,
    error: null,
  };
  jobs.set(id, job);
  seedStore();
  bus.emit("jobs:changed", { id, job });
  return job;
}

export function update(id, patch = {}) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  seedStore();
  bus.emit("jobs:changed", { id, job });
  return job;
}

export function tick(id, { done, total, detail } = {}) {
  const job = jobs.get(id);
  if (!job) return null;
  if (done != null || total != null) {
    job.progress = {
      done: done ?? job.progress?.done ?? 0,
      total: total ?? job.progress?.total ?? 0,
    };
  }
  if (detail != null) job.detail = detail;
  job.updatedAt = Date.now();
  seedStore();
  bus.emit("jobs:changed", { id, job });
  return job;
}

export function succeed(id, { detail } = {}) {
  return update(id, { status: "success", detail: detail ?? jobs.get(id)?.detail ?? "", progress: null });
}

export function fail(id, error) {
  return update(id, {
    status: "error",
    error: String(error?.message ?? error ?? "failed"),
    detail: String(error?.message ?? error ?? ""),
  });
}

export function cancel(id) {
  return update(id, { status: "cancelled" });
}

/** Drop finished jobs older than maxAgeMs (default 30 min). */
export function prune(maxAgeMs = 30 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, job] of jobs) {
    if (job.status === "running") continue;
    if ((job.updatedAt ?? 0) < cutoff) jobs.delete(id);
  }
  seedStore();
}

export function activeCount() {
  let n = 0;
  for (const j of jobs.values()) if (j.status === "running") n += 1;
  return n;
}

// Keep ui.jobs seeded even before first register.
seedStore();
