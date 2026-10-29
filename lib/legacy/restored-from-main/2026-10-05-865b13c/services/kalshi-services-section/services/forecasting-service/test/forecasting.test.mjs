import assert from "node:assert/strict";
import test from "node:test";
import { brierScore, calibrationBuckets, createForecast, logScore, normalizeQuestion } from "../src/forecasting.mjs";

const VALID_QUESTION = Object.freeze({
  id: "will-x-happen",
  title: "Will X happen?",
  resolutionCriteria: "Resolves YES if X happens by the close date.",
  openAt: "2026-08-31T00:00:00.000Z",
  closeAt: "2026-09-14T00:00:00.000Z",
  resolveAt: "2026-09-17T00:00:00.000Z",
  sourcePlatform: "metaculus-aib-minibench",
});

test("normalizeQuestion accepts a well-formed question and freezes it", () => {
  const question = normalizeQuestion(VALID_QUESTION);
  assert.equal(question.id, "will-x-happen");
  assert.throws(() => { question.id = "mutated"; });
});

test("normalizeQuestion rejects a non-lowercase-hyphen id", () => {
  assert.throws(() => normalizeQuestion({ ...VALID_QUESTION, id: "Will_X" }), /lowercase-hyphen/u);
});

test("normalizeQuestion rejects closeAt before openAt", () => {
  assert.throws(
    () => normalizeQuestion({ ...VALID_QUESTION, closeAt: "2026-08-01T00:00:00.000Z" }),
    /closeAt must not precede/u,
  );
});

test("normalizeQuestion rejects resolveAt before closeAt", () => {
  assert.throws(
    () => normalizeQuestion({ ...VALID_QUESTION, resolveAt: "2026-08-01T00:00:00.000Z" }),
    /resolveAt must not precede/u,
  );
});

const VALID_FORECAST = Object.freeze({
  questionId: "will-x-happen",
  probability: 0.65,
  rationale: "Base rate plus one confirming evidence source.",
  evidenceCitations: [{ source: "groq" }],
  timestamp: "2026-09-01T00:00:00.000Z",
});

test("createForecast accepts a well-formed forecast", () => {
  const forecast = createForecast(VALID_FORECAST);
  assert.equal(forecast.probability, 0.65);
  assert.equal(forecast.evidenceCitations.length, 1);
});

test("createForecast requires a non-empty rationale", () => {
  assert.throws(() => createForecast({ ...VALID_FORECAST, rationale: "" }), /rationale must be a non-empty string/u);
});

test("createForecast requires at least one evidence citation", () => {
  assert.throws(() => createForecast({ ...VALID_FORECAST, evidenceCitations: [] }), /evidenceCitations must be a non-empty array/u);
});

test("createForecast rejects an out-of-range probability", () => {
  assert.throws(() => createForecast({ ...VALID_FORECAST, probability: 1.5 }), /must be a finite number in \[0,1\]/u);
});

test("brierScore(0.8, 1) matches the worked value 0.04", () => {
  assert.equal(brierScore(0.8, 1), (0.8 - 1) ** 2);
  assert.ok(Math.abs(brierScore(0.8, 1) - 0.04) < 1e-9);
});

test("brierScore(0.5, 1) matches the worked value 0.25", () => {
  assert.equal(brierScore(0.5, 1), 0.25);
});

test("brierScore is a perfect 0 for a certain correct forecast", () => {
  assert.equal(brierScore(1, 1), 0);
  assert.equal(brierScore(0, 0), 0);
});

test("brierScore rejects an outcome that is not exactly 0 or 1", () => {
  assert.throws(() => brierScore(0.5, 0.5), /outcome must be exactly 0 or 1/u);
});

test("logScore(0.5, 1) matches the worked value -ln(0.5)", () => {
  assert.equal(logScore(0.5, 1), -Math.log(0.5));
  assert.ok(Math.abs(logScore(0.5, 1) - 0.6931471805599453) < 1e-12);
});

test("logScore(0.2, 0) matches -ln(1 - 0.2)", () => {
  assert.equal(logScore(0.2, 0), -Math.log(0.8));
});

test("logScore throws at probability=0 (log(0) undefined)", () => {
  assert.throws(() => logScore(0, 1), /log\(0\) is undefined/u);
});

test("logScore throws at probability=1 (log(0) undefined on the mirrored side)", () => {
  assert.throws(() => logScore(1, 0), /log\(0\) is undefined/u);
});

test("calibrationBuckets groups a synthetic dataset into deciles and computes realized frequency", () => {
  const observations = [
    { probability: 0.05, outcome: 0 },
    { probability: 0.05, outcome: 0 },
    { probability: 0.45, outcome: 0 },
    { probability: 0.45, outcome: 1 },
    { probability: 0.95, outcome: 1 },
  ];
  const buckets = calibrationBuckets(observations, { bucketCount: 10 });
  assert.equal(buckets.length, 10);

  const bucket0 = buckets[0];
  assert.equal(bucket0.rangeLow, 0);
  assert.equal(bucket0.rangeHigh, 0.1);
  assert.equal(bucket0.count, 2);
  assert.equal(bucket0.meanStatedProbability, 0.05);
  assert.equal(bucket0.realizedFrequency, 0);

  const bucket4 = buckets[4];
  assert.equal(bucket4.rangeLow, 0.4);
  assert.equal(bucket4.count, 2);
  assert.equal(bucket4.meanStatedProbability, 0.45);
  assert.equal(bucket4.realizedFrequency, 0.5);

  const bucket9 = buckets[9];
  assert.equal(bucket9.count, 1);
  assert.equal(bucket9.realizedFrequency, 1);

  const emptyBucket = buckets[7];
  assert.equal(emptyBucket.count, 0);
  assert.equal(emptyBucket.meanStatedProbability, null);
  assert.equal(emptyBucket.realizedFrequency, null);
});

test("calibrationBuckets rejects a non-integer bucketCount", () => {
  assert.throws(() => calibrationBuckets([], { bucketCount: 2.5 }), /integer bucketCount/u);
});
