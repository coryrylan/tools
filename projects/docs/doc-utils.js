// Shared helpers for the rule-docs.js / surface-docs.js doc loaders: both
// pull a one-line summary from a heading-validated markdown doc and both
// guard against drift between a source-of-truth id list and the doc files
// on disk.

/**
 * Pulls the one-line summary that follows the doc's opening heading, which
 * must exactly match `expectedHeading`. Throws (failing the docs build) on a
 * missing/mismatched heading or a missing summary line - `docLabel` names
 * the offending doc in the error.
 */
export function extractSummary(markdown, { expectedHeading, docLabel }) {
  const lines = markdown.split('\n').map(line => line.trim());
  const headingIndex = lines.findIndex(line => line.length > 0);
  const heading = headingIndex === -1 ? undefined : lines[headingIndex];
  if (heading !== expectedHeading) {
    throw new Error(`Expected ${docLabel} to start with "${expectedHeading}", got: ${heading ?? '<empty file>'}`);
  }
  const summary = lines.slice(headingIndex + 1).find(line => line.length > 0);
  if (!summary) {
    throw new Error(`${docLabel} has no summary line after its heading.`);
  }
  return summary;
}

/**
 * Bidirectional drift guard between a source-of-truth id list and derived
 * doc ids: throws when either side has entries the other lacks, with
 * per-direction messages so the build error names the exact fix.
 */
export function validateIdsMatch(expectedIds, actualIds, { missingMessage, orphanedMessage }) {
  const expectedSet = new Set(expectedIds);
  const actualSet = new Set(actualIds);
  const orphaned = [...actualSet].filter(id => !expectedSet.has(id));
  if (orphaned.length > 0) {
    throw new Error(orphanedMessage(orphaned));
  }
  const missing = [...expectedSet].filter(id => !actualSet.has(id));
  if (missing.length > 0) {
    throw new Error(missingMessage(missing));
  }
}
