import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  gatherQuestionEvidence,
  parseConfidenceFromCompletion,
  parseProbabilityFromCompletion,
} from "../scripts/gather-question-evidence.mjs";

function writeCatalog(dir, rows, freeFirstOrder) {
  const path = join(dir, "catalog.json");
  writeFileSync(path, JSON.stringify({ rows, routingPolicy: { freeFirstOrder } }));
  return path;
}

test("parseProbabilityFromCompletion extracts the PROBABILITY line", () => {
  assert.equal(parseProbabilityFromCompletion("some reasoning\nPROBABILITY: 0.42\nCONFIDENCE: 0.7"), 0.42);
});

test("parseProbabilityFromCompletion throws when no PROBABILITY line is present", () => {
  assert.throws(() => parseProbabilityFromCompletion("no structured answer here"), /no parseable PROBABILITY/u);
});

test("parseConfidenceFromCompletion defaults to 0.5 when no CONFIDENCE line is present", () => {
  assert.equal(parseConfidenceFromCompletion("PROBABILITY: 0.3"), 0.5);
});

test("parseConfidenceFromCompletion extracts a present CONFIDENCE line", () => {
  assert.equal(parseConfidenceFromCompletion("PROBABILITY: 0.3\nCONFIDENCE: 0.9"), 0.9);
});

test("gatherQuestionEvidence dispatches through an injected request and makes no real fetch call", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "forecasting-gather-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = writeCatalog(
    dir,
    [{ providerId: "fake-provider", chatCompletionsUrl: "http://example.invalid/chat", apiKeyEnvVar: "FAKE_KEY", keyed: true, defaultModel: "fake-model" }],
    ["fake-provider"],
  );

  let callCount = 0;
  const request = async (url, init) => {
    callCount += 1;
    assert.equal(url, "http://example.invalid/chat");
    assert.equal(JSON.parse(init.body).model, "fake-model");
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({
        model: "fake-model",
        choices: [{ message: { content: "Base rate reasoning here.\nPROBABILITY: 0.7\nCONFIDENCE: 0.6" }, finish_reason: "stop" }],
      }),
    };
  };

  const estimate = await gatherQuestionEvidence("Will X happen?", {
    catalogPath,
    request,
    apiKeyByEnvVar: { FAKE_KEY: "test-key-not-real" },
  });

  assert.equal(callCount, 1, "the injected request must be the only dispatch, never a real fetch");
  assert.equal(estimate.source, "fake-provider");
  assert.equal(estimate.probability, 0.7);
  assert.equal(estimate.confidence, 0.6);
});

test("gatherQuestionEvidence retries the next free-first row on a rate-limit refusal", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "forecasting-gather-retry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = writeCatalog(
    dir,
    [
      { providerId: "rate-limited-provider", chatCompletionsUrl: "http://example.invalid/limited", apiKeyEnvVar: "LIMITED_KEY", keyed: true, defaultModel: "limited-model" },
      { providerId: "second-provider", chatCompletionsUrl: "http://example.invalid/second", apiKeyEnvVar: "SECOND_KEY", keyed: true, defaultModel: "second-model" },
    ],
    ["rate-limited-provider", "second-provider"],
  );

  const calledUrls = [];
  const request = async (url) => {
    calledUrls.push(url);
    if (url === "http://example.invalid/limited") {
      return { ok: false, status: 429, statusText: "Too Many Requests", text: async () => "rate limited" };
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ model: "second-model", choices: [{ message: { content: "PROBABILITY: 0.4\nCONFIDENCE: 0.5" }, finish_reason: "stop" }] }),
    };
  };

  const estimate = await gatherQuestionEvidence("Will Y happen?", {
    catalogPath,
    request,
    apiKeyByEnvVar: { LIMITED_KEY: "k1", SECOND_KEY: "k2" },
  });

  assert.deepEqual(calledUrls, ["http://example.invalid/limited", "http://example.invalid/second"]);
  assert.equal(estimate.source, "second-provider");
  assert.equal(estimate.probability, 0.4);
});

test("gatherQuestionEvidence throws when every free-first row is unarmed", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "forecasting-gather-unarmed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = writeCatalog(
    dir,
    [{ providerId: "unarmed-provider", chatCompletionsUrl: "http://example.invalid/unarmed", apiKeyEnvVar: "UNARMED_KEY", keyed: true }],
    ["unarmed-provider"],
  );
  await assert.rejects(
    () => gatherQuestionEvidence("Will Z happen?", { catalogPath, request: async () => { throw new Error("must not be called"); }, apiKeyByEnvVar: {} }),
    /every free-first provider is unarmed or excluded/u,
  );
});
