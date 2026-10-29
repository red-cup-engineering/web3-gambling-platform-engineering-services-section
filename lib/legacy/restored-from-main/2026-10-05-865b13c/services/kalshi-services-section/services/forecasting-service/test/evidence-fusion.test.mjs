import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeReading } from "@red-cup-engineering/signcell/cell";
import { evidenceOfEstimate, fuseEvidenceToForecast } from "../src/evidence-fusion.mjs";

test("evidenceOfEstimate reads a supportive estimate as the positive-only FOUR value", () => {
  const evidence = evidenceOfEstimate({ probability: 0.8, confidence: 0.5, source: "groq" });
  assert.equal(knowledgeReading(evidence), "potential");
  assert.equal(evidence.for.length, 1);
  assert.equal(evidence.against.length, 0);
  assert.equal(evidence.for[0].source, "groq");
});

test("evidenceOfEstimate reads a refuting estimate as the negative-only FOUR value", () => {
  const evidence = evidenceOfEstimate({ probability: 0.2, confidence: 0.5, source: "gemini-direct" });
  assert.equal(knowledgeReading(evidence), "active");
  assert.equal(evidence.for.length, 0);
  assert.equal(evidence.against.length, 1);
});

test("evidenceOfEstimate reads an exactly-0.5 estimate as absurd (no assertion either side)", () => {
  const evidence = evidenceOfEstimate({ probability: 0.5, confidence: 0.9, source: "ollama-local" });
  assert.equal(knowledgeReading(evidence), "absurd");
});

test("evidenceOfEstimate rejects an out-of-range probability", () => {
  assert.throws(() => evidenceOfEstimate({ probability: 1.5, confidence: 0.5, source: "x" }), /must be a finite number in \[0,1\]/u);
});

test("fuseEvidenceToForecast rejects an empty evidence array", () => {
  assert.throws(() => fuseEvidenceToForecast([]), /non-empty array/u);
});

test("fuseEvidenceToForecast on two agreeing sources: confidence-weighted mean and no conflict", () => {
  const estimates = [
    { probability: 0.7, confidence: 0.8, source: "groq" },
    { probability: 0.9, confidence: 0.4, source: "gemini-direct" },
  ];
  const fusion = fuseEvidenceToForecast(estimates);
  const expectedMean = (0.7 * 0.8 + 0.9 * 0.4) / (0.8 + 0.4);
  assert.ok(Math.abs(fusion.probability - expectedMean) < 1e-12);
  assert.equal(knowledgeReading(fusion.evidence), "potential");
  assert.equal(fusion.conflicted, false);
  assert.equal(knowledgeReading(fusion.evidence) === "stable", false);
  assert.equal(fusion.evidence.for.length, 2);
  assert.equal(fusion.evidence.against.length, 0);
});

test("fuseEvidenceToForecast on disagreeing sources: evidence settles at top (told-both) and conflicted is true", () => {
  const estimates = [
    { probability: 0.8, confidence: 0.5, source: "groq" },
    { probability: 0.2, confidence: 0.5, source: "openrouter" },
  ];
  const fusion = fuseEvidenceToForecast(estimates);
  assert.equal(fusion.probability, 0.5);
  assert.equal(knowledgeReading(fusion.evidence), "stable");
  assert.equal(fusion.conflicted, true);
  assert.equal(knowledgeReading(fusion.evidence) === "stable", true);
  assert.equal(fusion.evidence.for.length, 1);
  assert.equal(fusion.evidence.against.length, 1);
});

test("fuseEvidenceToForecast falls back to a plain mean when every confidence is 0", () => {
  const estimates = [
    { probability: 0.3, confidence: 0, source: "a" },
    { probability: 0.7, confidence: 0, source: "b" },
  ];
  const fusion = fuseEvidenceToForecast(estimates);
  assert.equal(fusion.probability, 0.5);
});

test("fuseEvidenceToForecast rejects an estimate with an out-of-range confidence", () => {
  assert.throws(() => fuseEvidenceToForecast([{ probability: 0.5, confidence: 2, source: "a" }]), /confidence.*must be a finite number in \[0,1\]/u);
});
