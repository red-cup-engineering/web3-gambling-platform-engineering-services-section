#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  validateChatCompletionPacket,
  runOpenAiCompatibleChatExchange,
  selectFreeFirstProvider,
  resolveFreeFirstAttemptPacket,
  isRateLimitRefusal,
} from "@red-cup-engineering/computer-inference-engine/openai";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { resolve } from "node:path";

/**
 * Default location of the house-verified free-inference provider catalog
 * this script dispatches against. Owned by
 * @red-cup-engineering/openai-compatible-chat-completion-service --
 * catalog rows are per-deployment configuration, not a primitive to copy
 * into this section; callers may override with their own catalog path.
 * @type {string}
 */
export const DEFAULT_CATALOG_PATH = "/home/emsenn/info/lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-inference-system-services-section/services/openai-compatible-chat-completion-service/content/providers/catalog.json";

function buildEvidencePacket(questionPrompt) {
  return {
    model: "unset-overridden-per-provider-row",
    messages: [
      {
        role: "system",
        content: "You are a calibrated forecaster gathering evidence for one forecasting question. Respond with 2-4 sentences of evidence/reasoning, then on their own final two lines exactly:\nPROBABILITY: <a decimal between 0 and 1>\nCONFIDENCE: <a decimal between 0 and 1, your own confidence in that probability>",
      },
      { role: "user", content: questionPrompt },
    ],
    "max-tokens": 400,
  };
}

/**
 * Parses a model completion's final "PROBABILITY: <0..1>" line.
 * @param {string} text
 * @returns {number}
 * @throws {Error} when no parseable PROBABILITY line is present or it is out of [0,1].
 */
export function parseProbabilityFromCompletion(text) {
  const match = /PROBABILITY:\s*([01](?:\.\d+)?)/iu.exec(text ?? "");
  if (!match) throw new Error("gather-question-evidence: completion carried no parseable PROBABILITY: <0..1> line");
  const probability = Number(match[1]);
  if (!(probability >= 0 && probability <= 1)) throw new Error(`gather-question-evidence: parsed probability ${probability} is out of [0,1]`);
  return probability;
}

/**
 * Parses a model completion's final "CONFIDENCE: <0..1>" line, defaulting
 * to 0.5 (neutral) when absent -- not every provider reliably follows the
 * two-line instruction, and a missing self-reported confidence is not
 * itself an error condition worth failing the whole gather on.
 * @param {string} text
 * @returns {number}
 */
export function parseConfidenceFromCompletion(text) {
  const match = /CONFIDENCE:\s*([01](?:\.\d+)?)/iu.exec(text ?? "");
  if (!match) return 0.5;
  const confidence = Number(match[1]);
  return confidence >= 0 && confidence <= 1 ? confidence : 0.5;
}

/**
 * Gathers one evidence estimate for a forecasting question prompt by
 * dispatching through the free-first provider order -- mirrors
 * dispatch-free-first-chat-completion.mjs's own loop (that script's file
 * is reached only via its package's `bin` entry, not an importable
 * export, so this composes the same public functions directly); it never
 * falls back to a paid or frontier provider.
 * @param {string} questionPrompt
 * @param {{catalogPath?: string, request?: typeof fetch, apiKeyByEnvVar?: Record<string,string>}} [options] - `request` is the injectable seam threaded straight through to runOpenAiCompatibleChatExchange for testing.
 * @returns {Promise<{source: string, probability: number, confidence: number, rawCompletion: string, exchangeId: string}>}
 * @throws {Error} when every free-first provider is unarmed/excluded, or a non-rate-limit refusal occurs.
 */
export async function gatherQuestionEvidence(questionPrompt, options = {}) {
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const request = options.request ?? fetch;
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), "utf8"));
  const packet = buildEvidencePacket(questionPrompt);
  const errors = validateChatCompletionPacket(packet);
  if (errors.length) throw new Error(`gather-question-evidence: built an invalid packet:\n  - ${errors.join("\n  - ")}`);
  const excluded = [];
  for (;;) {
    const row = selectFreeFirstProvider(catalog.rows, catalog.routingPolicy, { excludeProviderIds: excluded });
    if (!row) throw new Error("gather-question-evidence: every free-first provider is unarmed or excluded; this script never falls back to a paid or frontier provider");
    const apiKey = options.apiKeyByEnvVar?.[row.apiKeyEnvVar] ?? process.env[row.apiKeyEnvVar];
    if (!apiKey) {
      excluded.push(row.providerId);
      continue;
    }
    const exchange = await runOpenAiCompatibleChatExchange(
      resolveFreeFirstAttemptPacket(packet, row),
      { providerId: row.providerId, chatCompletionsUrl: row.chatCompletionsUrl, apiKey },
      request,
    );
    if (exchange.outcome === "completion") {
      return {
        source: row.providerId,
        probability: parseProbabilityFromCompletion(exchange.completion.text),
        confidence: parseConfidenceFromCompletion(exchange.completion.text),
        rawCompletion: exchange.completion.text,
        exchangeId: exchange.id,
      };
    }
    if (isRateLimitRefusal(exchange.refusal)) {
      excluded.push(row.providerId);
      continue;
    }
    throw new Error(`gather-question-evidence: ${row.providerId} refused (non-rate-limit): ${exchange.refusal.grounds}`);
  }
}

async function main({ argv, stderr }) {
  const [questionPrompt] = argv;
  const catalogFlagAt = argv.indexOf("--catalog");
  const catalogPath = catalogFlagAt === -1 ? undefined : argv[catalogFlagAt + 1];
  if (!questionPrompt) {
    stderr.write('usage: gather-question-evidence.mjs "<question prompt>" [--catalog <path>]\n');
    process.exitCode = 2;
    return undefined;
  }
  return gatherQuestionEvidence(questionPrompt, { catalogPath });
}

runMain(main, {
  moduleUrl: import.meta.url,
  formatResult: (result) => (result === undefined ? "" : `${JSON.stringify(result, null, 2)}\n`),
  formatError: (error) => `${error.message}\n`,
  exitCode: 1,
});
