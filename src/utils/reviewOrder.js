/**
 * Shared utilities for sequential review ordering and locking.
 *
 * Order is the same as what ReviewerSidebar and ReviewerPage display:
 *   - Group documents by top-level Drive folder
 *   - Sort documents alphabetically within each group
 *   - Sort groups alphabetically, keeping "Other" last
 *
 * Locking:
 *   - Iterate the ordered list from the top.
 *   - The first document whose submission is NOT "complete" is the "frontier"
 *     (the one the reviewer should be working on now).
 *   - All documents AFTER the frontier are locked.
 *   - Documents before (or at) the frontier are accessible.
 */

/** Extract top-level folder from a Drive path like "1. focus/Lesson Name". */
function getFolder(drivePath) {
  if (!drivePath) return 'Other';
  const segment = (drivePath ?? '').split('/')[0].trim();
  return segment || 'Other';
}

/**
 * Return the full reviewer document list in the canonical display order:
 * folders alphabetical (Other last), documents alphabetical within each folder.
 *
 * @param {Array<{driveFileId: string, title?: string, drivePath?: string}>} documents
 * @returns {Array} ordered flat list
 */
export function getOrderedDocuments(documents) {
  const groups = {};
  documents.forEach((d) => {
    const folder = getFolder(d.drivePath);
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(d);
  });

  // Sort docs within each group alphabetically
  Object.values(groups).forEach((arr) =>
    arr.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
  );

  // Sort group keys alphabetically, 'Other' always last
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b);
  });

  return sortedKeys.flatMap((key) => groups[key]);
}

/**
 * Return the Set of driveFileIds that are locked under sequential review.
 *
 * A document is locked when a document earlier in the order is not yet complete.
 * The very first document is always accessible (never locked).
 *
 * @param {Array} orderedDocs  — output of getOrderedDocuments()
 * @param {Object} submissions — map of driveFileId → submission object
 * @returns {Set<string>} set of locked driveFileIds
 */
export function getLockedDocumentIds(orderedDocs, submissions) {
  const locked = new Set();
  let frontierPassed = false;

  for (const doc of orderedDocs) {
    if (frontierPassed) {
      locked.add(doc.driveFileId);
    } else {
      const sub = submissions[doc.driveFileId];
      const isComplete = sub?.status === 'complete';
      if (!isComplete) {
        // This doc IS the frontier — accessible, but everything after is locked
        frontierPassed = true;
      }
    }
  }

  return locked;
}
