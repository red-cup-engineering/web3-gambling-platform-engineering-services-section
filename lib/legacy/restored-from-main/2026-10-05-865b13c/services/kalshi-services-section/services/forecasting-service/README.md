# Forecasting Services Section

`@red-cup-engineering/forecasting` — a forecasting capability intended for
skill-for-fee work and for the separate Kalshi stake path when calibration
supports it. This package does not establish a buyer or a profitable stake.
It provides question ingestion, SignChain claim
fusion, proper scoring rules, and calibration tracking.
Stakes go through `kalshi-stake-path-service` inside its capped envelope.

## Pipeline

1. **Ingest** (`scripts/ingest-forecasting-question.mjs`) — validates and
   normalizes a raw question definition into a canonical
   `ForecastingQuestion` (`src/forecasting.mjs`'s `normalizeQuestion`).
2. **Supply estimates** — give the run command a JSON array of estimates.
   Each row has `source`, `probability`, `confidence`, and either a source
   `url` or a `note` identifying the material or judgment used. A question
   alone supplies no evidence or probability. The caller is responsible for
   the claims and the cited material; admission here validates their shape.
3. **Fuse** (`scripts/fuse-forecast.mjs`, `src/evidence-fusion.mjs`) —
   combines one or more evidence estimates into a single forecast: the
   probability point-estimate is a confidence-weighted mean (ordinary numeric
   aggregation); the qualitative support/refutation charge uses SignCell and
   SignChain's `knowledgeJoin`,
   kept honestly separate from the numeric mean rather than one dressed up
   as the other.
4. **Record** (`scripts/record-forecast.mjs`) — writes the canonical
   `ForecastRecord` via `@red-cup-engineering/semantic-record-journal-service`
   (`createSemanticRecordJournal`), landing at this section's own
   `data/journals/`.
5. **Score** (`scripts/score-forecast.mjs`) — once a question resolves,
   scores the recorded forecast with the Brier score (always) and the log
   score (whenever the stated probability isn't exactly 0 or 1 — `logScore`
   is undefined at those boundaries), and journals a calibration-tracking
   record.

`apps/forecasting-cli.mjs` composes the full pipeline as two commands: `run
<question.json> <estimates.json>` (ingest → fuse → record) and
`score <forecastId> <outcome 0|1>`.

## Exports

- `@red-cup-engineering/forecasting/forecasting` — `src/forecasting.mjs`:
  `normalizeQuestion`, `createForecast`, `brierScore`, `logScore`,
  `calibrationBuckets`.
- `@red-cup-engineering/forecasting/evidence-fusion` — `src/evidence-fusion.mjs`:
  `evidenceOfEstimate`, `fuseEvidenceToForecast`.

## Thread

Forecasting research—including economic context, scoring theory, and the
obsmetrologic reading of gathered evidence—remains in Science. This package
is its engineering realization: it accepts bounded question and evidence
carriers, produces forecast and calibration records, and composes with the
Kalshi market-read and stake-guard services without taking a market position.
It does not claim theory ownership or an operations/public product boundary.

## Entanglement

Checked against the house primitives named in the 2026-09-01 five-custody
ruling:

- SignCell and SignChain — `src/evidence-fusion.mjs` carries each supplied
  estimate as an attributable claim and joins conflicting claims without
  silently resolving their disagreement. Proper scoring remains in
  `src/forecasting.mjs`.
- `@red-cup-engineering/semantic-record-journal-service` — already the sole
  writer in `scripts/record-forecast.mjs` and `scripts/score-forecast.mjs`
  (`createSemanticRecordJournal`); no hand-rolled record/receipt writing.
- Inference — the old question-only free-first loop has been retired. An
  inference-generated estimate can be supplied with its source material, but
  this forecasting pipeline currently has no admitted inference customer or
  model execution contract. A source note is an attribution claim, not
  independent verification of its contents.
- `@red-cup-engineering/eavt` — no hand-rolled EAVT-shaped rows anywhere in
  `src/` or `scripts/`; none needed.
- `@red-cup-engineering/image-generation-inference-team` — this package does
  no image generation anywhere; none needed.

The question-only free-first inference loop was removed from this pipeline.
