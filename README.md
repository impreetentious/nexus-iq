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

Before analysis, Nexus IQ can scan a corpus for emails, phone numbers, SSNs, URL-embedded credentials, and likely names, then reversibly pseudonymize them (`[EMAIL_1]`, `[NAME_2]`, …) with the re-identification map stored outside the project bundle at `vaults/<project-slug>/<corpus-id>.json`. This covers both unit text and string metadata columns.

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
- The Next.js shell and local UI send a same-origin Content Security Policy, plus `nosniff`, `SAMEORIGIN`, strict referrer policy, and a restricted permissions policy.

## License

MIT © Sidakpreet Singh — see [LICENSE](LICENSE).

---

**Version:** v2.9.0
