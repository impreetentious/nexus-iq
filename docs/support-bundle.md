# Support-bundle redaction & compatibility

## Purpose

A support bundle is a **diagnostic snapshot** for debugging. It is **not** a backup or restore archive. Restoring a study means copying `projects/` and `config/` (see `docs/backup-restore.md`).

## Bundle format

- Field: `bundleFormat: 1` (integer major).
- Consumers **must reject** unknown major versions.
- Members are deterministic where practical (sorted paths, stable JSON key order when hand-built).
- Every archive includes `MANIFEST.json` with sha256 of every other member, plus `README.txt`.

## Redaction policy (enforced in `server/routes/diagnostics.js`)

**NEVER include:**

- Raw provider keys (`config/keys.json` contents, or any `apiKey` / `sk-` material).
- PII vault files (`projects/<slug>/vault/**`).
- Abandoned import staging blobs under `.imports/` when they embed upload bytes.
- Absolute home-directory paths; paths in the bundle are project-relative.

**MAY include:**

- Package / Node / platform versions, uptime, provider reachability booleans.
- `project.json` (no keys live there by design).
- Ledger verify result and a capped ledger tail (≤200 events).
- Run summaries (id, status, cost, checkpoint) without full outputs by default.
- Optional `?includeOutputs=1`: first ≤50 NDJSON output lines for at most one run — still never vault/keys.

**Privacy cues:** the archive README states that keys and vaults are excluded, and that the zip is not restore-capable.

Redaction policy version: `1` (embedded in `MANIFEST.json` as `redactionPolicy`).
