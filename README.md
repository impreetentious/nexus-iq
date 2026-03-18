# Nexus IQ

Nexus IQ is a local-first qualitative text measurement platform. Import a corpus of text, draft the constructs you want to measure, compile them into instruments, calibrate those instruments against human-coded gold data, run labeled analyses with cost metering, and export reproducible artifacts with clear provenance — without depending on a hosted service.

The product is built around two modes of work:

- Fast exploration: import text, inspect the corpus, generate briefs, draft constructs, and try instruments quickly.
- Honest publication: calibrate against human-coded gold data, inspect the evidence behind each result, and export reproducible artifacts with clear provenance.

## How it runs

Two processes start together:

- The **Next.js shell** on port `3000` is an iframe host and an `/api/*` proxy. It renders no application UI of its own.
- The **backend** on port `7341` (plain `node:http`, no framework) serves the real interface — vanilla JavaScript under `public/app/` — and every API. It binds loopback only.

Your work lives on disk in file-based project bundles under `projects/<slug>/`, which are gitignored and portable: copy the directory to move a project to another machine.

Supported corpus inputs: CSV, XLSX, DOCX, PDF, and transcript formats.

## Demo Flow

No API keys are required for a full local walkthrough.

1. Create a project.
2. Import `demo/techcorp-exit-survey.csv`.
3. Review the automatic mapping and initial corpus scan.
4. Generate a brief, draft constructs, and compile instruments.
5. Run calibration and analysis using the built-in mock provider.

`MockModel` exists to make the full workflow usable out of the box. It is deterministic, local, and clearly labeled as mock output.

## Model Providers

Nexus IQ supports:

- Anthropic
- OpenAI
- OpenRouter
- Ollama
- MockModel

Keys are stored in `config/keys.json`, which is gitignored and excluded from every export, diagnostic bundle and backup.

## Privacy & PII Handling

Before analysis, Nexus IQ can scan a corpus for emails, phone numbers, SSNs, URL-embedded credentials, and likely names, then reversibly pseudonymize them (`[EMAIL_1]`, `[NAME_2]`, …) with the re-identification map stored outside the project bundle. This covers both unit text and string metadata columns.

Name detection is a capitalized-bigram heuristic with a stoplist, not a trained NER model. It will miss single first names and non-"Firstname Lastname" name orders, and can occasionally mis-flag or miss unlisted proper nouns. Treat it as a strong first pass, not a guarantee — review a sample of masked output before sharing or exporting a corpus that contains real personal data.

## Repository Map

| Path          | Purpose                                                           |
| ------------- | ----------------------------------------------------------------- |
| `pages/`      | Next.js shell entrypoints                                         |
| `public/app/` | Browser UI assets and vanilla JS application code                 |
| `server/`     | Local backend, routing, analysis engine, reporting, and providers |
| `demo/`       | Seeded demo corpus and its reference results                      |
| `tests/`      | Unit, integration, server, simulation, and end-to-end coverage    |
| `tools/`      | Helper scripts for repo maintenance                               |

## Quick Start

Requires Node.js `>=20.19` and npm.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The shell starts the backend alongside it; the backend remains loopback-only on port `7341` by default.

Other commands:

```bash
npm run build
npm run start
npm test
npm run test:a11y
```

Useful targeted checks:

```bash
node --test tests/e2e/pipeline.test.js
node --test tests/e2e/perf.test.js
node --test tests/sim/dsl.sim.test.js
```

## Docker

```bash
docker compose up --build
```

Then open `http://localhost:3000`. The image includes `demo/` for the documented walkthrough. The Compose file mounts named volumes for `projects/` and `config/`, so project bundles, saved provider keys, and settings survive `docker compose down` and container rebuilds. Only port 3000 is published — the backend binds `127.0.0.1` inside the container and the Next.js shell proxies `/api` to it. To start clean, remove the volumes with `docker compose down -v`.

## Notes

- The app is designed to run locally on macOS or Windows with the same basic workflow.
- Project bundles are file-based and portable, optimized for practical local use rather than large-scale hosted deployment.
- Replication exports include machine-readable artifacts plus generated R and Python helpers for external verification.

## Changelog

### v2.7.0

- Weekly Dependabot watcher for npm dependencies and GitHub Actions, so Next.js and toolchain advisories surface as pull requests.

### v2.6.0

- README rewritten as a standalone public document: what the project is, how to run, verify, and deploy it, and its real limitations. Version tracking reduced to a single `Version:` line.
- Accessibility suite repaired: the four Playwright + axe specs now collect and pass, and axe waits for enter/leave transitions to settle so a toast caught mid-fade no longer reports a false color-contrast violation.

### v2.5.8

- `npm test` is now Node-version-agnostic — it passes explicit per-directory globs to `node --test`, which previously collected zero tests on Node 22 and above. Green on 20.x, 22.x, and 24.x. Node version pinned via `.nvmrc` and `engine-strict`.

### v2.5.7

- Release provenance and supply-chain hardening: version-coherence checks in CI, SHA-pinned GitHub Actions, a Docker smoke job, a vendored SheetJS tarball, and a release workflow.

### v2.5.6

- In-product diagnostics and a support-bundle ZIP with redaction and a bundle-compatibility policy, plus backup/restore guidance. Keys and PII vaults are never included.

### v2.5.5

- Browser accessibility acceptance suite (Playwright + axe) and responsive table card alternatives for narrow viewports.
- Provider setup wizard with validation, privacy cues, and pricing-freshness surfacing in Settings.

### v2.5.4

- Catalog pricing freshness stamps: `pricingVerifiedAt` on static provider rows and a freshness envelope on `GET /api/catalog/models`.

### v2.5.3

- One-click guided MockModel demo: deterministic `POST /api/demo/reset` over `techcorp-exit-survey.csv`, plus a Projects call-to-action and checklist sheet.

### v2.5.2

- Centralized job registry and persistent Operation Center; runs, imports, and exports register progress into a shared busy language.

### v2.5.1

- Responsive shell with a supported-viewport policy, collapsible rail, and inspector overlay; lazy screen loading.

### v2.4.3

- Atomic project-cap reservation: run admission records estimated remaining spend as a reservation under the per-project lock, so concurrent starts can no longer double-claim the same headroom.

### v2.4.2

- Iframe route/title bridge: copied URLs and reloads restore the inner screen and Back/Forward work; figure and SVG evidence doors are keyboard-focusable controls with a visible focus cue.

### v2.4.1

- Director analysis suggestions: a completed run can request next-analysis proposals via `POST /api/projects/:p/runs/:r/analysis-suggestions`. Every suggestion is opt-in — dismiss it or explicitly create the analysis; nothing is auto-created.

### v2.4.0

- Human coding beyond categories: the calibration sprint and the blind coder accept bounded numeric labels for `continuous` constructs, toggle-and-submit sets for `multilabel`, and one-verbatim-span-per-line submissions for `extraction`.

### v2.3.6

- Docker: named volumes persist `projects/` and `config/` across container recreation; production-only install; added a healthcheck.

### v2.3.5

- Frontend: idempotent sheet close, out-of-order-safe and keyboard-inert inspector, project-navigation race gated by the active route, theme button state seeded from the persisted choice, and an accessible name on the app iframe.

### v2.3.4

- Budget: the run engine enforces the project spending cap on every unit, so retries, escalation, or estimate error abort a run resumably instead of overrunning the cap.

### v2.3.3

- Security: cross-origin state changes are refused via an `Origin` guard on every mutating request, with the opt-in shared coder listener relaxed to match its intended LAN exposure.

### v2.3.2

- Filesystem hardening: project slugs validated at the store boundary with resolved-path containment; bundles, keys, and PII vaults written with private `0700`/`0600` modes; abandoned pending imports swept at startup.

### v2.3.1

- Providers: corrected provider pricing metadata, and strict privacy now refuses non-loopback Ollama endpoints.

## License

MIT © Sidakpreet Singh — see [LICENSE](LICENSE).

---

**Version:** v2.7.5
