/**
 * Paywall access utilities.
 *
 * Access tiers for a lesson group:
 *   'open'   — no restriction, visible to all
 *   'demo'   — Level 1: free preview, accessible to all learners
 *   'level2' — Level 2: requires self-paced payment
 *   'level3' — Level 3: requires cohort (live-session) payment
 *              Note: Level 3 also grants access to Level 2 content.
 *
 * Workspace paywallConfig shape:
 *   {
 *     enabled:          boolean,
 *     level2PaymentUrl: string | null,  // payment page for self-paced
 *     level3PaymentUrl: string | null,  // payment page for cohort
 *     demoGroups:       string[],       // Level 1 — free preview groups
 *     level2Groups:     string[],       // Level 2 — self-paced groups
 *     level3Groups:     string[],       // Level 3 — cohort groups
 *   }
 *
 * userProfiles.paidWorkspaces shape:
 *   { [workspaceId]: 2 | 3 }  // highest access level purchased per workspace
 */

/**
 * Returns the required access tier for a given sidebar group.
 *
 * @param {string}      groupName     - Folder key (first path segment, or '__root__')
 * @param {object|null} paywallConfig - Workspace paywallConfig field
 * @returns {'open' | 'demo' | 'level2' | 'level3'}
 */
export function getGroupAccess(groupName, paywallConfig) {
  if (!paywallConfig?.enabled) return 'open';
  if ((paywallConfig.demoGroups ?? []).includes(groupName)) return 'demo';
  if ((paywallConfig.level2Groups ?? []).includes(groupName)) return 'level2';
  if ((paywallConfig.level3Groups ?? []).includes(groupName)) return 'level3';
  return 'open';
}

/**
 * Returns true if a learner can access content in this group.
 * Level 3 is a superset of Level 2 — purchasing cohort grants self-paced access too.
 *
 * @param {string}                  groupName      - Folder key
 * @param {object|null}             paywallConfig  - Workspace paywallConfig field
 * @param {Record<string,2|3>|null} paidWorkspaces - Map of workspaceId → access level
 * @param {string|null}             workspaceId    - The current workspace ID
 * @returns {boolean}
 */
export function canAccessGroup(groupName, paywallConfig, paidWorkspaces, workspaceId) {
  const access = getGroupAccess(groupName, paywallConfig);
  if (access === 'open' || access === 'demo') return true;
  const userLevel = workspaceId ? ((paidWorkspaces ?? {})[workspaceId] ?? 0) : 0;
  if (access === 'level2') return userLevel >= 2;
  if (access === 'level3') return userLevel >= 3;
  return false;
}
