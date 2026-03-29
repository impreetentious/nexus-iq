# Backup and restore

Nexus IQ is local-first. Durable state lives on disk:

| Path               | Contents                                                                      |
| ------------------ | ----------------------------------------------------------------------------- |
| `projects/<slug>/` | Portable study bundle (corpus, instruments, gold, runs, ledger, report).      |
| `vaults/<slug>/`   | Re-identification maps for pseudonymized corpora (mode 0700/0600 on POSIX).   |
| `config/keys.json` | Provider keys only (mode 0600). Gitignored and excluded from support bundles. |
| `config/app.json`  | Optional app defaults (e.g. port).                                            |

## Backup

1. Stop the server (or pause active runs) so a single writer is idle.
2. Copy the entire `projects/`, `vaults/`, and `config/` directories to cold storage.
3. Docker: back up the named volumes mapped to `/app/projects`, `/app/vaults`, and `/app/config`.

A **support bundle** (Settings → Diagnostics) is for triage only — it redacts keys/vaults and is not a restore archive.

## Restore

1. Stop Nexus IQ.
2. Replace `projects/`, `vaults/`, and `config/` with the backup copies (preserve modes: dirs `0700`, private files `0600` on POSIX).
3. Start the server. Open the project from the shelf.

## Compatibility

- Restore with the same Nexus IQ version that created the backup, then upgrade normally. Keep the original backup until the restored project has opened successfully.
- Support-bundle `bundleFormat` is independent of project schema; do not feed a support zip back into `projects/`.
