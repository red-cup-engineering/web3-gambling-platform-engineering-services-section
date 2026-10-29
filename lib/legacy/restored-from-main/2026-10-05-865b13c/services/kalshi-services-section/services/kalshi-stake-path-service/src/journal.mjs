/**
 * The one factory every script in this package uses to open its own
 * semantic-record-journal category (jsnode_duplication flagged five
 * near-identical per-script `xJournalFor(dataRoot)` closures before this
 * consolidation).
 */

import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { resolve } from "node:path";

/**
 * Opens a semantic record journal rooted at `dataRoot` (or `nodeRoot` when
 * `dataRoot` is not given) for one objectKind.
 * @param {{dataRoot?: string, objectKind: string, nodeRoot: string}} input
 * @returns {ReturnType<typeof createSemanticRecordJournal>}
 */
export function journalFor({ dataRoot, objectKind, nodeRoot }) {
  return createSemanticRecordJournal({ root: resolve(dataRoot ?? nodeRoot), objectKind });
}
