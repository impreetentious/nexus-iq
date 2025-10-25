# Nexus IQ

Nexus IQ is a local-first qualitative text measurement platform. It combines a Next.js shell with a Node backend so teams can move from exploratory reading to calibrated, evidence-linked analysis without depending on a hosted service by default.

**Release version:** `v2.5.6`

The product is built around two modes of work:

- Fast exploration: import text, inspect the corpus, generate briefs, draft constructs, and try instruments quickly.
- Honest publication: calibrate against human-coded gold data, inspect the evidence behind each result, and export reproducible artifacts with clear provenance.
- The Next.js shell runs on port `3000`.
- The Nexus IQ backend runs on port `7341` by default.
- The shell proxies `/api/*` requests to the backend automatically.

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

Keys are stored in `config/keys.json`, which is gitignored and excluded from exports.

## Privacy & PII Handling

Before analysis, Nexus IQ can scan a corpus for emails, phone numbers, SSNs, URL-embedded credentials, and likely names, then reversibly pseudonymize them (`[EMAIL_1]`, `[NAME_2]`, …) with the re-identification map stored outside the project bundle. This covers both unit text and string metadata columns.

Name detection is a capitalized-bigram heuristic with a stoplist, not a trained NER model. It will miss single first names and non-"Firstname Lastname" name orders, and can occasionally mis-flag or miss unlisted proper nouns. Treat it as a strong first pass, not a guarantee — review a sample of masked output before sharing or exporting a corpus that contains real personal data.

## Repository Map

| Path | Purpose |
| --- | --- |
| `pages/` | Next.js shell entrypoints |
| `public/app/` | Browser UI assets and vanilla JS application code |
| `server/` | Local backend, routing, analysis engine, reporting, and providers |
| `demo/` | Seeded demo corpus and oracle data |
| `tests/` | Unit, integration, server, simulation, and end-to-end coverage |
| `tools/` | Helper scripts for repo maintenance |

## Quick Start

Requires Node.js `>=20.10` and npm.

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

## Changelog

### v2.5.6

- In-product diagnostics and support-bundle ZIP with redaction + bundle-compatibility policy; backup/restore guidance. Keys and PII vaults never included.

### v2.5.5

- Browser accessibility acceptance suite (Playwright + axe) and responsive table card alternatives for narrow viewports.
- Provider setup wizard with validation, privacy cues, and freshness/STALE surfacing in Settings (estimate: true ok; stale verified dates are not).

### v2.5.4

- Catalog pricing freshness stamps: pricingVerifiedAt on static provider rows, mergeCatalogPricing propagation, and freshness envelope on GET /api/catalog/models.

### v2.5.3

- One-click guided MockModel demo: deterministic POST /api/demo/reset over techcorp-exit-survey.csv plus Projects CTA and checklist sheet.

### v2.5.2

- Centralized job registry and persistent Operation Center; runs, imports, and exports register progress into a shared busy language.

### v2.5.1

- Responsive shell with supported viewport policy, collapsible rail, and inspector overlay; shell boot wires viewport + lazy screen loading + ops host mount points.

### v2.5.0

- Public-facing audit PF-A1: `README.md` casing normalized, `package.json` set `private: true` with OSS metadata, Docker image includes `demo/` for the documented walkthrough. No product-math change.

### v2.4.3

- External action sync: version marker bumped to 2.4.3 across `README.md`, `package.json`, and the root `package-lock.json` entries. No functional change.
- Version coherence + handoff: version marker aligned across `README.md`, `package.json`, and the root `package-lock.json` entries. No functional change.
- Atomic project-cap reservation: run admission records the estimated remaining spend as a `reservedUSD` reservation under the per-project lock, concurrent starts can no longer double-claim the same headroom, and settlement releases the reservation while booking actual spend in one mutation. Covered in the `metering` tests.

### v2.4.2

- Iframe route/title bridge: the Next host and the same-origin app exchange constrained route + title state, so copied URLs and reloads restore the inner screen and Back/Forward work; figure/SVG evidence doors are keyboard-focusable button-like controls with a visible focus cue.

### v2.4.1

- Director analysis suggestions: a completed run can request Director-backed next-analysis proposals via `POST /api/projects/:p/runs/:r/analysis-suggestions`. Every suggestion is opt-in in the run detail screen — dismiss it or explicitly create the analysis; nothing is auto-created.

### v2.4.0

- Human coding beyond categories: the calibration sprint and the blind coder accept bounded numeric labels for `continuous` constructs, toggle-and-submit sets for `multilabel`, and one-verbatim-span-per-line submissions for `extraction` (an explicit empty span array is valid). Server span handling is covered in the `gold-integrity` tests.

### v2.3.6

- State sync: version marker bumped to 2.3.6 across `README.md`, `package.json`, and the root `package-lock.json` entries. No functional change.
- Docker: named volumes persist `projects/` and `config/` across container recreation; production-only install (`npm ci --omit=dev`); dropped the unreachable `EXPOSE 7341`; removed the obsolete Compose `version` key; added a healthcheck.

### v2.3.5

- Frontend: idempotent sheet close, out-of-order-safe and keyboard-inert inspector (Space activation on evidence doors), project-navigation store race gated by the active route, theme button state seeded from the persisted choice, and an accessible name on the app iframe.

### v2.3.4

- Budget: the run engine now enforces the project spending cap on every unit (worker + Director escalation), so retries, escalation, or estimate error abort a run resumably instead of overrunning the cap the admission-only start gate allowed.

### v2.3.3

- Security: refuse cross-origin state changes — an `Origin` guard on every mutating request (CSRF), with the opt-in shared coder listener relaxed to match its intended LAN exposure.

### v2.3.2

- Filesystem hardening: validate project slugs at the store boundary with resolved-path containment, write bundles/keys/PII vaults with private `0700`/`0600` modes (plus a boot-time chmod migration), and sweep abandoned pending imports at startup.

### v2.3.1

- Providers: corrected the OpenAI fallback catalog (`gpt-5-mini`); strict privacy now refuses non-loopback Ollama endpoints.

### v2.3.0

- Release prep: bumped to `v2.3.0`, removed the unused `lint` devDependency (empty `devDependencies`), and refreshed the README quick-start.

## Notes

- The app is designed to run locally on macOS or Windows with the same basic workflow.
- Project bundles are file-based and portable, optimized for practical local use rather than large-scale hosted deployment.
- Replication exports include machine-readable artifacts plus generated R and Python helpers for external verification.

## License

MIT
