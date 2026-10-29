#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fuseEvidenceToForecast } from "../src/evidence-fusion.mjs";
import { createForecast } from "../src/forecasting.mjs";
import { resolve } from "node:path";

function defaultRationale(evidenceEstimates, fusion) {
  const sources = evidenceEstimates.map((estimate) => estimate.source).join(", ");
  const conflictNote = fusion.conflicted
    ? " Supplied estimates disagreed in direction (the joined claims are told both ways); the fused probability is a confidence-weighted mean over that conflict, not a resolution of it."
    : " Supplied estimates agreed in direction.";
  return `Fused from ${evidenceEstimates.length} supplied estimate(s) (${sources}) via confidence-weighted mean probability and SignChain support/refutation aggregation.${conflictNote}`;
}

/**
 * Fuses gathered evidence estimates into one canonical, journal-ready
 * forecast record.
 * @param {{questionId: string, evidenceEstimates: import("../src/evidence-fusion.mjs").EvidenceEstimate[], rationale?: string}} input
 * @param {{at?: string}} [options] - `at` overrides the forecast timestamp (defaults to now).
 * @returns {{forecast: Readonly<import("../src/forecasting.mjs").ForecastRecord>, fusion: {probability: number, evidence: object, conflicted: boolean}}}
 */
export function fuseForecast({ questionId, evidenceEstimates, rationale }, options = {}) {
  if (!Array.isArray(evidenceEstimates) || evidenceEstimates.length === 0) {
    throw new TypeError("forecasting: supply a non-empty array of sourced estimates");
  }
  for (const [index, estimate] of evidenceEstimates.entries()) {
    if (typeof estimate?.source !== "string" || estimate.source.trim() === ""
      || ![estimate.url, estimate.note].some((value) => typeof value === "string" && value.trim() !== "")) {
      throw new TypeError(`forecasting: estimate ${index} needs a named source and a URL or source note`);
    }
  }
  const fusion = fuseEvidenceToForecast(evidenceEstimates);
  const timestamp = options.at ?? new Date().toISOString();
  const forecast = createForecast({
    questionId,
    probability: fusion.probability,
    rationale: rationale ?? defaultRationale(evidenceEstimates, fusion),
    evidenceCitations: evidenceEstimates.map((estimate) => ({
      source: estimate.source,
      ...(estimate.url === undefined ? {} : { url: estimate.url }),
      note: `stated probability ${estimate.probability}, confidence ${estimate.confidence}${estimate.note ? `; source note: ${estimate.note}` : ""}`,
    })),
    timestamp,
  });
  return { forecast, fusion };
}

if (import.meta.main) {
  const [path] = process.argv.slice(2);
  if (!path) {
    process.stderr.write("usage: fuse-forecast.mjs <gathered-evidence.json>\n");
    process.exitCode = 2;
  } else {
    const input = JSON.parse(readFileSync(resolve(path), "utf8"));
    process.stdout.write(`${JSON.stringify(fuseForecast(input), null, 2)}\n`);
  }
}
