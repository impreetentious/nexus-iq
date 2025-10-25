# Backup and restore

Nexus IQ is local-first. Durable state lives on disk:

| Path | Contents |
| --- | --- |
| `projects/<slug>/` | Portable study bundle (corpus, instruments, gold, runs, ledger, report). |
| `config/keys.json` | Provider keys only (mode 0600). Never commit; never put in support bundles. |
| `config/app.json` | Optional app defaults (e.g. port). |

## Backup

1. Stop the server (or pause active runs) so a single writer is idle.
2. Copy the entire `projects/` directory and the entire `config/` directory to cold storage.
3. Docker: back up the named volumes mapped to `/app/projects` and `/app/config`.

A **support bundle** (Settings → Diagnostics) is for triage only — it redacts keys/vaults and is not a restore archive.

## Restore

1. Stop Nexus IQ.
2. Replace `projects/` and `config/` with the backup copies (preserve modes: dirs `0700`, key files `0600` on POSIX).
3. Start the server. Open the project from the shelf.

## Compatibility

- Project bundles are forward-compatible within a major product line when `project.json` parses.
- Support-bundle `bundleFormat` is independent of project schema; do not feed a support zip back into `projects/`.
