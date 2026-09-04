# Nexus IQ

Nexus IQ is a local-first qualitative text measurement platform. Import a corpus of text, draft the constructs you want to measure, compile them into instruments, calibrate those instruments against human-coded gold data, run labeled analyses with cost metering and export reproducible artifacts with clear provenance — without depending on a hosted service.

The product is built around two modes of work:

- Fast exploration: import text, inspect the corpus, generate briefs, draft constructs and try instruments quickly.
- Honest publication: calibrate against human-coded gold data, inspect the evidence behind each result and export reproducible artifacts with clear provenance.

## How it runs

Two processes start together:

- The **Next.js shell** on port `3000` is an iframe host and an `/api/*` proxy. It renders no application UI of its own.
- The **backend** on port `7341` (plain `node:http`, no framework) serves the real interface — vanilla JavaScript under `public/app/` — and every API. It binds loopback only.

Project data and provenance live in file-based bundles under `projects/<slug>/`, which are gitignored and portable. If a corpus was pseudonymized, copy the matching `vaults/<slug>/` directory separately when you need to preserve re-identification.

Supported corpus inputs: CSV/TSV, XLS/XLSX, DOCX, PDF, TXT/Markdown/HTML, VTT/SRT and transcript JSON.

## Demo flow

No API keys are required for a full local walkthrough. On the Projects screen, choose **Guided MockModel demo**, then **Reset & start demo**. This replaces the `techcorp-exit` demo project, imports the bundled corpus and selects MockModel as the project Director.

1. Open Instant Read and review the local corpus summary.
2. Generate a brief with the MockModel Director.
3. Draft constructs and compile an instrument.
4. Preview, calibrate and run the instrument.
5. Inspect the analysis and reproducibility artifacts.

`MockModel` exists to make the full workflow usable out of the box. It is deterministic, local and clearly labeled as mock output.

## Model providers

Nexus IQ supports:

- Anthropic
- OpenAI
- OpenRouter
- Ollama

Keys are stored in `config/keys.json`, which is gitignored and excluded from project exports and diagnostic bundles. Include `config/` only in a private backup you control.

## Privacy and PII handling

Before analysis, Nexus IQ can scan a corpus for emails, phone numbers, SSNs, URL-embedded credentials and likely names, then reversibly pseudonymize them (`[EMAIL_1]`, `[NAME_2]`, …) with the re-identification map stored outside the project bundle at `vaults/<project-slug>/<corpus-id>.json`. This covers both unit text and string metadata columns.

Name detection is a capitalized-bigram heuristic with a stoplist, not a trained NER model. Known limits:

- It skips capitalized bigrams at the start of a sentence, where ordinary prose also capitalizes. A name in that position ("Maria Gonzalez never listened.") is therefore not flagged, while the same name mid-sentence is.
- It misses single first names and non-"Firstname Lastname" name orders.
- It can mis-flag or miss unlisted proper nouns.

Treat it as a strong first pass, not a guarantee — review a sample of masked output before sharing or exporting a corpus that contains real personal data.

Operational documentation:

- [Backup and restore](docs/backup-restore.md) — what is durable on disk and how to copy it safely.
- [Support-bundle redaction](docs/support-bundle.md) — what a diagnostic bundle contains and what it never contains.
- [Supported viewport policy](docs/viewport-policy.md) — the layout classes the UI targets.

## Quick start

Requires Node.js `>=20.19` and npm.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The shell starts the backend alongside it; the backend remains loopback-only on port `7341` by default.

To move the backend off `7341`, set `NXQ_PORT` for both processes (`NXQ_PORT=7500 npm run dev`) — the Next shell reads it when building its `/api` proxy target. For `npm run start`, set it at `npm run build` time too, because Next bakes rewrites into the build. Setting `port` in `config/app.json` moves only the backend, so the shell on `3000` would keep proxying to the old port; the backend serves the same UI directly on its own port if you prefer that route.

Other commands:

```bash
npm run build
npm run start
npm test
npm run test:a11y
```

Run the repository checks with:

```bash
npm run check:version
npm run format:check
npm run lint
npm run build
npm test
npm run test:a11y
npm audit --audit-level=high
npm run docker:smoke
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

Then open `http://localhost:3000`. The image includes `demo/` for the documented walkthrough. The Compose file mounts named volumes for `projects/`, `vaults/` and `config/`, so project bundles, PII re-identification maps, saved provider keys and settings survive `docker compose down` and container rebuilds. Only port 3000 is published — the backend binds `127.0.0.1` inside the container and the Next.js shell proxies `/api` to it. To start clean, remove the volumes with `docker compose down -v`.

## Notes

- The app runs locally on macOS, Windows and Linux with the same basic workflow; CI exercises the full suite on Linux and the Docker image is Linux-based.
- Project bundles are file-based and portable, optimized for practical local use rather than large-scale hosted deployment.
- Replication exports include machine-readable artifacts plus generated R and Python helpers for external verification.
- The Next.js shell and local UI send a same-origin Content Security Policy, plus `nosniff`, `SAMEORIGIN`, strict referrer policy and a restricted permissions policy.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/impreetentious/nexus-iq). Open an issue before anything substantial, keep changes focused and leave the checks under [Quick start](#quick-start) green.

## License

AGPL-3.0-only © 2024-2026 Sidakpreet Singh — see [LICENSE](LICENSE). Version 3 only, not any later version.

---

**Version:** v2.11.1
