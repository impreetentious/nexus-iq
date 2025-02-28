# Nexus IQ

Nexus IQ is a local-first qualitative text measurement platform. It combines a Next.js shell with a Node backend so teams can move from exploratory reading to calibrated, evidence-linked analysis without depending on a hosted service by default.

The product is built around two modes of work:

- Fast exploration: import text, inspect the corpus, generate briefs, draft constructs, and try instruments quickly.
- Honest publication: calibrate against human-coded gold data, inspect the evidence behind each result, and export reproducible artifacts with clear provenance.

## Quick Start

Prerequisite: Node.js `20.10+`.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- The Next.js shell runs on port `3000`.
- The Nexus IQ backend runs on port `7341` by default.
- The shell proxies `/api/*` requests to the backend automatically.

For a production-style local run:

```bash
npm run build
npm run start
```

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

## Repository Map

| Path | Purpose |
| --- | --- |
| `pages/` | Next.js shell entrypoints |
| `public/app/` | Browser UI assets and vanilla JS application code |
| `server/` | Local backend, routing, analysis engine, reporting, and providers |
| `demo/` | Seeded demo corpus and oracle data |
| `tests/` | Unit, integration, server, simulation, and end-to-end coverage |
| `tools/` | Helper scripts for repo maintenance |

## Commands

```bash
npm run dev
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

## Notes

- The app is designed to run locally on macOS or Windows with the same basic workflow.
- Project bundles are file-based and portable, optimized for practical local use rather than large-scale hosted deployment.
- Replication exports include machine-readable artifacts plus generated R and Python helpers for external verification.

## License

MIT
