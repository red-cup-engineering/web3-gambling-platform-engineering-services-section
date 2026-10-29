/**
 * Fuses several forecasting evidence estimates using the real
 * SignChain `knowledgeJoin`
 * operation for the qualitative support/refutation evidence, and an
 * ordinary confidence-weighted mean for the probability point-estimate --
 * see fuseEvidenceToForecast for why those two steps are kept honestly
 * separate rather than one dressed up as the other.
 */

import { evidence, sidesOf } from "@red-cup-engineering/signcell/cell";
import { knowledgeJoin } from "@red-cup-engineering/signchain/bilattice";

/** @typedef {{probability: number, confidence: number, source: string}} EvidenceEstimate One source's stated probability estimate (in [0,1]) and its self-reported confidence (in [0,1]). */

const SUPPORT_THRESHOLD = 0.5;
const REFUTATION_THRESHOLD = 0.5;

function requireUnitInterval(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`evidence-fusion: ${label} must be a finite number in [0,1], got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateEstimate(estimate, index = 0) {
  if (typeof estimate !== "object" || estimate === null) throw new TypeError(`evidence-fusion: evidenceEstimates[${index}] must be an object`);
  requireUnitInterval(estimate.probability, `evidenceEstimates[${index}].probability`);
  requireUnitInterval(estimate.confidence, `evidenceEstimates[${index}].confidence`);
  if (typeof estimate.source !== "string" || estimate.source.length === 0) {
    throw new TypeError(`evidence-fusion: evidenceEstimates[${index}].source must be a non-empty string`);
  }
  return estimate;
}

/**
 * Encodes one evidence estimate as a SignCell evidence pair. THIS IS
 * OUR ENCODING CHOICE, not metrologic's: a probability strictly above 0.5
 * asserts the positive (support) side; strictly below 0.5 asserts the
 * negative (refutation) side; exactly 0.5 asserts neither (the FOUR value
 * "absurd" -- no witness on either side). The estimate itself becomes a
 * witness object placed in the evidence array on whichever side(s) it
 * asserts, so nothing is lost when tellings are later joined.
 * @param {EvidenceEstimate} estimate
 * @returns {{for: unknown[], against: unknown[]}} a SignCell evidence pair.
 */
export function evidenceOfEstimate(estimate) {
  validateEstimate(estimate);
  const { probability, confidence, source } = estimate;
  const witness = Object.freeze({ source, probability, confidence });
  const supports = probability > SUPPORT_THRESHOLD;
  const refutes = probability < REFUTATION_THRESHOLD;
  return evidence({ for: supports ? [witness] : [], against: refutes ? [witness] : [] });
}

/**
 * Fuses several evidence estimates for one forecasting question into a
 * single probability point-estimate and one bilattice-typed support/
 * refutation evidence. Two genuinely different operations happen here, kept
 * separate rather than one pretending to be the other: (1) the
 * probability POINT-ESTIMATE is a confidence-weighted mean of the
 * individual probabilities -- ordinary numeric aggregation, not
 * metrologic's job; (2) the qualitative EVIDENCE is SignChain's
 * bilattice fusion (`knowledgeJoin`, the knowledge-order join from
 * SignChain): each estimate's evidence (see
 * {@link evidenceOfEstimate}) is joined pairwise, so the fused
 * evidence is told on a side iff at least one source asserted
 * that side, and its evidence arrays lose no witness. A fused evidence
 * told both ways ( i.e. "told both" in the knowledge order) means the
 * evidence base is in genuine CONFLICT -- some sources support, some
 * refute -- and the probability mean should be read with that in mind
 * rather than as a settled consensus.
 * @param {EvidenceEstimate[]} evidenceEstimates
 * @returns {{probability: number, evidence: {for: unknown[], against: unknown[]}, conflicted: boolean}}
 * @throws {TypeError} when evidenceEstimates is not a non-empty array of valid estimates.
 */
export function fuseEvidenceToForecast(evidenceEstimates) {
  if (!Array.isArray(evidenceEstimates) || evidenceEstimates.length === 0) {
    throw new TypeError("evidence-fusion: fuseEvidenceToForecast requires a non-empty array of evidence estimates");
  }
  evidenceEstimates.forEach(validateEstimate);
  const tellings = evidenceEstimates.map(evidenceOfEstimate);
  const fused = tellings.reduce((left, right) => knowledgeJoin(left, right));
  const totalConfidence = evidenceEstimates.reduce((sum, estimate) => sum + estimate.confidence, 0);
  const probability = totalConfidence > 0
    ? evidenceEstimates.reduce((sum, estimate) => sum + estimate.probability * estimate.confidence, 0) / totalConfidence
    : evidenceEstimates.reduce((sum, estimate) => sum + estimate.probability, 0) / evidenceEstimates.length;
  return { probability, evidence: fused, conflicted: sidesOf(fused)[0] && sidesOf(fused)[1] };
}
