// Diagnostics + support bundle. Two READ-ONLY surfaces:
//   GET /api/diagnostics                            — system JSON
//   GET /api/projects/:p/diagnostics/support-bundle — ZIP download
//
// The support bundle is a diagnostic snapshot, NOT a restore archive; the
// redaction policy and format-compatibility rule are documented in
// docs/support-bundle.md, and the restore procedure lives in
// docs/backup-restore.md.
//
// Neither route writes to a project bundle. The ZIP is assembled in-memory
// from loadProject, ledger.verify, and streamed NDJSON reads, then serialized
// with the same fflate.zipSync used by server/reporting/replication.js. Path
// ids are validated at the lowest boundary (loadProject → assertProjectSlug;
// runOutputsFile → safeId).
//
// The bundle NEVER contains config/keys.json, projects/<slug>/vault/*,
// projects/<slug>/.imports/*, or absolute filesystem paths. A field-name
// scrub over the loaded project graph replaces any accidental key-looking
// leaf ("apiKey", "secret", "token", …) with "[REDACTED]" as defense in
// depth — project.json today has no such fields.
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { sha256 } from "../core/ids.js";
import * as ledger from "../core/ledger.js";
import { loadProject, listProjects, readNdjson } from "../core/store.js";
import { pdirOf, runOutputsFile, safeId } from "./_shared.js";
import { providerHealth } from "./catalog.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Bundle format version. Consumers MUST reject bundles whose bundleFormat
// major version is unknown to them (see docs/support-bundle.md).
export const BUNDLE_FORMAT = 1;

// Redaction policy version — bump when the field-name scrub, the never-
// included list, or the includeOutputs cap changes semantics.
const REDACTION_POLICY_VERSION = 1;

// Cap on ledger-tail.ndjson: last N events, chain-verified by
// ledger-verify.json.
const LEDGER_TAIL_MAX = 200;

// Cap on the optional per-run outputs sample (?includeOutputs=1).
const OUTPUTS_SAMPLE_MAX = 50;

// Field names whose leaf values MUST NOT appear in a support bundle even if
// they somehow rode into project.json. Matched case-insensitively against
// object keys during a recursive walk (see sanitize below).
const SENSITIVE_KEY_RE =
  /(apikey|api_key|secret|password|passwd|token|credential|bearer|authorization|private[_-]?key)/i;

// Recursive scrub — arrays are mapped, objects have every sensitive-keyed
// leaf replaced by "[REDACTED]" (the whole subtree is dropped, not just
// stringified), scalars pass through. Idempotent.
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : sanitize(v);
    }
    return out;
  }
  return value;
}

let cachedVersion = null;
async function packageVersion() {
  if (cachedVersion) return cachedVersion;
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  cachedVersion = pkg.version;
  return cachedVersion;
}

function systemDiagnostics(version, providers, projectsCount) {
  return {
    version,
    node: process.version,
    platform: process.platform,
    uptimeMs: Math.round(process.uptime() * 1000),
    providers,
    projectsCount,
    bundleFormat: BUNDLE_FORMAT,
  };
}

// Per-run: enough to triage a stuck/failed/expensive run without exposing
// any labels or unit text. The full outputs stream (opt-in, capped) rides in
// a separate ndjson member so a consumer that receives a bundle without
// the ?includeOutputs=1 opt-in cannot reconstruct the run.
function runSummary(r) {
  return {
    id: r.id,
    name: r.name ?? null,
    status: r.status ?? null,
    corpusId: r.corpusId ?? null,
    instrumentId: r.instrumentId ?? null,
    createdAt: r.createdAt ?? null,
    finishedAt: r.finishedAt ?? null,
    cost: r.cost ?? r.costUSD ?? null,
    checkpoint: r.checkpoint ?? null,
    counts: r.counts ?? null,
    error: r.error ?? null,
  };
}

async function readLedgerTail(projectDir, limit) {
  const file = path.join(projectDir, "ledger.ndjson");
  try {
    await stat(file);
  } catch {
    return [];
  }
  // Ledgers are small on this product; read whole and slice. The append path
  // is torn-tail tolerant, so readNdjson may skip one trailing partial line —
  // which is exactly what we want to report.
  const events = await readNdjson(file);
  return events.slice(Math.max(0, events.length - limit));
}

function ndjsonBody(rows) {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

const README_TXT = `Nexus IQ support bundle
=======================

This ZIP is a DIAGNOSTIC SNAPSHOT for troubleshooting one Nexus IQ project
on one machine. It is NOT a backup, NOT a restore archive, and NOT
reproducible provenance for exports of record.

WHAT IS INCLUDED
  MANIFEST.json        sha256 of every other member + bundleFormat +
                       redactionPolicy version + generator version
  diagnostics.json     package/node/platform, provider REACHABILITY
                       (boolean only), project rollup counts
  project.json         the project graph (already free of provider keys;
                       still scrubbed for any accidental key-looking fields)
  ledger-verify.json   result of ledger.verify() at bundle time
  ledger-tail.ndjson   last <=200 ledger events (chain-verified above)
  runs-summary.json    per-run status/cost/checkpoint/counts (no outputs)
  README.txt           this file
  outputs-sample-<runId>.ndjson  ONLY present when ?includeOutputs=1 —
                       first 50 lines of one run's outputs.ndjson

WHAT IS NEVER INCLUDED
  - config/keys.json (raw provider API keys)
  - projects/<slug>/vault/ (PII re-identification vault)
  - projects/<slug>/.imports/ staging with raw uploads
  - absolute filesystem paths (would leak $HOME on this machine)
  - full run outputs beyond the optional 50-line sample above

BUNDLE COMPATIBILITY
  MANIFEST.json carries bundleFormat: <integer>. Consumers MUST reject
  bundles whose major format is unknown to them. See docs/support-bundle.md.

RESTORE
  This bundle CANNOT restore a project. To back up or restore Nexus IQ,
  copy the projects/ and config/ directories verbatim while the server is
  stopped. See docs/backup-restore.md.
`;

export default [
  {
    // System-scoped diagnostics — no project required. Same JSON envelope as
    // every other GET route (router wraps {ok:true, data}).
    method: "GET",
    pattern: "/api/diagnostics",
    handler: async () => {
      const version = await packageVersion();
      const providers = await providerHealth().catch(() => ({}));
      // listProjects skips damaged bundles silently; counting all entries
      // (including corrupt: true stubs) matches what the projects list UI
      // shows, and never opens a bundle's contents for the count.
      const projects = await listProjects().catch(() => []);
      return systemDiagnostics(version, providers, projects.length);
    },
  },
  {
    // Support bundle — binary ZIP download. Writes its own headers (like
    // exports/replication) and NEVER writes back into the project bundle.
    method: "GET",
    pattern: "/api/projects/:p/diagnostics/support-bundle",
    handler: async (req, res, params) => {
      // loadProject → assertProjectSlug validates the slug at the store
      // boundary before any path is built from it; a hostile "..%2F…" reads
      // exactly like a missing project (NOT_FOUND).
      const project = await loadProject(params.p);
      const pdir = pdirOf(params.p);

      const version = await packageVersion();
      const providers = await providerHealth().catch(() => ({}));
      const allProjects = await listProjects().catch(() => []);

      const diagnostics = {
        ...systemDiagnostics(version, providers, allProjects.length),
        project: {
          id: project.id,
          slug: project.slug,
          name: project.name,
          privacyMode: project.privacyMode,
          createdAt: project.createdAt,
          budget: project.budget ?? null,
          counts: {
            corpora: project.corpora?.length ?? 0,
            constructs: project.constructs?.length ?? 0,
            instruments: project.instruments?.length ?? 0,
            goldsets: project.goldsets?.length ?? 0,
            runs: project.runs?.length ?? 0,
            analyses: project.analyses?.length ?? 0,
            briefs: project.briefs?.length ?? 0,
          },
        },
      };

      const sanitizedProject = sanitize(project);
      const ledgerVerify = await ledger.verify(pdir);
      const ledgerTail = await readLedgerTail(pdir, LEDGER_TAIL_MAX);
      const runsSummary = (project.runs ?? []).map(runSummary);

      // members map: relative path → utf8 string content
      const members = new Map();
      members.set("README.txt", README_TXT);
      members.set("diagnostics.json", JSON.stringify(diagnostics, null, 2) + "\n");
      members.set("project.json", JSON.stringify(sanitizedProject, null, 2) + "\n");
      members.set("ledger-verify.json", JSON.stringify(ledgerVerify, null, 2) + "\n");
      members.set("ledger-tail.ndjson", ndjsonBody(ledgerTail));
      members.set("runs-summary.json", JSON.stringify(runsSummary, null, 2) + "\n");

      // Optional capped outputs sample — first 50 lines of ONE run's
      // outputs.ndjson. Defaults to the most recent run; ?runId=<id> selects
      // another. Still NEVER vault content, NEVER keys — outputs.ndjson lives
      // under projects/<slug>/runs/<runId>/ and the route only ever reads it.
      const includeOutputs = ["1", "true"].includes(
        String(req.query.includeOutputs ?? "").toLowerCase(),
      );
      if (includeOutputs) {
        const runs = project.runs ?? [];
        const wanted = req.query.runId ? safeId(String(req.query.runId), "run") : null;
        const pick = wanted
          ? runs.find((r) => r.id === wanted)
          : runs[runs.length - 1];
        if (pick) {
          // runOutputsFile calls safeId(runId, "run") itself — belt + braces
          // against a future caller passing an unvalidated id.
          const outputsFile = runOutputsFile(project.slug, pick.id);
          try {
            const rows = await readNdjson(outputsFile, { limit: OUTPUTS_SAMPLE_MAX });
            members.set(`outputs-sample-${pick.id}.ndjson`, ndjsonBody(rows));
          } catch {
            // no outputs on disk yet (pending run, aborted before first
            // write, foreign bundle) — silently skip the sample rather than
            // fail the whole diagnostic
          }
        }
      }

      // MANIFEST last: sha256 of every OTHER member (itself excluded).
      const files = {};
      for (const p of [...members.keys()].sort()) files[p] = sha256(members.get(p));
      const manifest = {
        bundleFormat: BUNDLE_FORMAT,
        redactionPolicy: REDACTION_POLICY_VERSION,
        generator: "nexus-iq",
        generatorVersion: version,
        projectId: project.id,
        slug: project.slug,
        createdAt: new Date().toISOString(),
        includesOutputsSample: includeOutputs,
        files,
      };
      members.set("MANIFEST.json", JSON.stringify(manifest, null, 2) + "\n");

      const zippable = {};
      for (const p of [...members.keys()].sort()) zippable[p] = strToU8(members.get(p));
      const zipBuffer = Buffer.from(zipSync(zippable, { level: 6 }));

      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${project.slug}-support-bundle.zip"`,
        "content-length": zipBuffer.length,
      });
      res.end(zipBuffer);
    },
  },
];
