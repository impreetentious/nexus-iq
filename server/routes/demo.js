// One-click MockModel demo. Deterministic reset: nuke any prior demo bundle
// (containment-checked so the rm can never escape the projects tree), mint a
// fresh "TechCorp Exit Survey" project pinned to the mock director, then
// ingest demo/techcorp-exit-survey.csv via the SAME primitives the two-step
// import flow uses (parse → unitize → pii scan → junk scan → units.ndjson +
// corpus meta + corpus.imported / corpus.unitized ledger events).
//
// The mock provider is always keyless-available (server/providers/mock.js),
// so the demo hangs together without any Settings step.
//
// ?sample=N (or body.sampleRows) truncates the parsed rows to N before
// unitize — the test harness uses this to keep the full 2500-row ingest off
// the hot path; production leaves it unset and gets the whole file.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, rm } from "node:fs/promises";
import { NexusIQError } from "../core/errors.js";
import { newId } from "../core/ids.js";
import { createProject } from "../core/objects.js";
import {
  assertProjectSlug,
  createProjectIfAbsent,
  projectsDir,
  updateProject,
} from "../core/store.js";
import * as ledger from "../core/ledger.js";
import { parse as parseCsv } from "../ingest/csv.js";
import { unitize } from "../ingest/unitize.js";
import { scan as junkScan } from "../ingest/junk.js";
import { scan as piiScan } from "../ingest/pii.js";
import { corpusUnitsFile, pdirOf, writeTextAtomic } from "./_shared.js";
import { metaColumnsOf } from "./import.js";

const DEMO_SLUG = "techcorp-exit";
const DEMO_NAME = "TechCorp Exit Survey";
const DEMO_FILENAME = "techcorp-exit-survey.csv";

// Guided next-steps returned alongside the fresh project — the UI walks the
// researcher through the same happy-path a real study takes.
const DEMO_STEPS = [
  "Draft a construct from a corpus sample",
  "Compile an instrument from the drafted construct",
  "Preview the instrument against a handful of units",
  "Freeze the instrument once agreement stabilizes",
  "Kick off a MockModel run across the full corpus",
];

// Repo-root-relative path to the bundled CSV. Tests set NEXUS_IQ_PROJECTS_DIR
// to a tempdir but leave the repo layout alone, so this resolves the same on
// the dev box and inside a test process.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
function demoCsvPath() {
  return path.join(repoRoot, "demo", DEMO_FILENAME);
}

async function csvPresent() {
  try {
    await access(demoCsvPath());
    return true;
  } catch {
    return false;
  }
}

async function projectExists(slug) {
  try {
    await access(path.join(projectsDir(), slug, "project.json"));
    return true;
  } catch {
    return false;
  }
}

// Deterministic overwrite: assertProjectSlug re-runs the same slug guard AND
// containment check the store applies (resolved path must sit exactly one
// segment under projectsDir), so this rm can never escape the projects tree
// even if a hostile caller reached this helper directly.
async function deleteProjectIfPresent(slug) {
  const dir = projectsDir();
  assertProjectSlug(slug, dir);
  await rm(path.join(dir, slug), { recursive: true, force: true });
}

// Parse `?sample=N` / body.sampleRows into a positive integer, or undefined
// for "ingest every row". Anything malformed is a VALIDATION so the demo
// route mirrors the rest of the API surface.
function parseSampleRows(body, query) {
  const raw = body?.sampleRows ?? (query?.sample !== undefined ? query.sample : undefined);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new NexusIQError("VALIDATION", "sample/sampleRows must be a positive integer", { sample: raw });
  }
  return n;
}

// Ingest the bundled CSV following the confirm-time recipe verbatim, minus
// the staged-file dance (rows arrive inline from parseCsv, not off disk):
// unitize with the pinned text column so the demo never guesses; default
// "scan" pii mode; junk scan; atomic units.ndjson write; corpus meta pushed
// under updateProject's per-slug lock; ledger corpus.imported + corpus.unitized.
async function ingestDemoCsv(slug, { sampleRows } = {}) {
  const parsed = await parseCsv(demoCsvPath());
  if (sampleRows !== undefined) {
    parsed.rows = parsed.rows.slice(0, sampleRows);
  }
  const scheme = "response";
  const textColumn = "response";
  const corpusId = newId("corp");
  const units = unitize(corpusId, parsed, scheme, { textColumn });
  if (units.length === 0) {
    throw new NexusIQError(
      "VALIDATION",
      "demo CSV produced no units — the response column was empty for every sampled row",
      { textColumn, sampleRows: sampleRows ?? null },
    );
  }
  let skipped = 0;
  for (const r of parsed.rows) {
    if (!String(r[textColumn] ?? "").trim()) skipped += 1;
  }
  const { counts: piiCounts } = piiScan(units); // mutates unit.flags.pii in place
  const pii = { mode: "scan", counts: piiCounts };
  const junk = junkScan(units); // mutates unit.flags.junk in place

  await writeTextAtomic(
    corpusUnitsFile(slug, corpusId),
    units.map((u) => JSON.stringify(u)).join("\n") + "\n",
  );

  const rows = parsed.rows.length;
  const meta = {
    id: corpusId,
    name: DEMO_FILENAME,
    source: { filename: DEMO_FILENAME, format: "csv", rows },
    unitization: { scheme, textColumn },
    unitCount: units.length,
    createdAt: new Date().toISOString(),
    textColumn,
    scheme,
    junk: junk.counts,
    pii,
    metaColumns: metaColumnsOf(units),
    sourceName: DEMO_FILENAME,
  };
  await updateProject(slug, (p) => { p.corpora.push(meta); });

  const pdir = pdirOf(slug);
  await ledger.append(pdir, "human", "corpus.imported", { corpusId }, {
    filename: DEMO_FILENAME,
    format: "csv",
    rows,
    pii,
  });
  await ledger.append(pdir, "human", "corpus.unitized", { corpusId }, {
    scheme,
    unitCount: units.length,
    junk: junk.counts,
  });
  return { corpusId, unitCount: units.length, skipped };
}

export default [
  {
    method: "GET",
    pattern: "/api/demo/status",
    handler: async () => ({
      available: true,
      csvPresent: await csvPresent(),
      projectExists: await projectExists(DEMO_SLUG),
      slug: DEMO_SLUG,
    }),
  },
  {
    // POST /api/demo/reset — {slug, corpusId, unitCount, steps: [...]}
    // Body: {sampleRows?: N}. Query: ?sample=N. Both truncate the parsed rows
    // before unitize (tests use sampleRows: 5 to keep the ingest cheap).
    method: "POST",
    pattern: "/api/demo/reset",
    handler: async (req) => {
      if (!(await csvPresent())) {
        throw new NexusIQError(
          "NOT_FOUND",
          `demo CSV missing — expected demo/${DEMO_FILENAME} in the repo`,
          { path: demoCsvPath() },
        );
      }
      const sampleRows = parseSampleRows(req.body, req.query);

      // Overwrite via delete + create: the store's containment check guards
      // the rm, and createProjectIfAbsent's per-slug lock guarantees the
      // subsequent create is atomic (a concurrent reset loses to CONFLICT
      // rather than silently clobbering a half-written bundle).
      await deleteProjectIfPresent(DEMO_SLUG);
      const project = createProject({
        name: DEMO_NAME,
        slug: DEMO_SLUG,
        privacyMode: "open",
        director: { provider: "mock", model: "mock-1" },
      });
      await createProjectIfAbsent(project);
      await ledger.append(pdirOf(project.slug), "human", "project.created", { projectId: project.id }, {
        name: project.name,
        slug: project.slug,
        privacyMode: project.privacyMode,
      });

      const { corpusId, unitCount, skipped } = await ingestDemoCsv(project.slug, { sampleRows });
      return {
        slug: project.slug,
        corpusId,
        unitCount,
        skipped,
        steps: DEMO_STEPS,
      };
    },
  },
];
