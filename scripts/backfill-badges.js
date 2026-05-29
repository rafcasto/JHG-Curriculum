/**
 * scripts/backfill-badges.js
 *
 * Re-runs the badge award logic for all users who have completed submissions,
 * awarding any badges they qualify for based on the current moduleKey configuration.
 *
 * Run AFTER setting moduleKey on all documents in the admin panel.
 *
 * Usage:
 *   node scripts/backfill-badges.js
 *   node scripts/backfill-badges.js --dry-run   (preview only, no writes)
 */

import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const serviceAccount = {
  type: process.env.GOOGLE_TYPE,
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
  universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
};

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes will be made\n' : '🚀 LIVE RUN — badges will be awarded\n');

  // ── 1. Load all documents that have a moduleKey set ──────────────────────
  const allDocsSnap = await db.collection('documents').get();
  const allDocs = allDocsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const docsWithModule = allDocs.filter((d) => d.moduleKey && d.driveFileId && d.workspaceId);

  if (docsWithModule.length === 0) {
    console.error('❌ No documents found with moduleKey set. Set moduleKey on documents in the admin panel first.');
    process.exit(1);
  }
  console.log(`📄 Found ${docsWithModule.length} document(s) with moduleKey set (out of ${allDocs.length} total)\n`);

  // ── 2. Group documents by workspaceId, then by moduleKey ─────────────────
  const workspaceModuleGroups = {};
  for (const doc of docsWithModule) {
    if (!workspaceModuleGroups[doc.workspaceId]) workspaceModuleGroups[doc.workspaceId] = {};
    const groups = workspaceModuleGroups[doc.workspaceId];
    if (!groups[doc.moduleKey]) groups[doc.moduleKey] = [];
    groups[doc.moduleKey].push(doc.driveFileId);
  }

  // ── 3. Load all active badges per workspace ──────────────────────────────
  const badgesSnap = await db.collection('badges').where('active', '==', true).get();
  const badgesByWorkspace = {};
  for (const badgeDoc of badgesSnap.docs) {
    const b = badgeDoc.data();
    if (!badgesByWorkspace[b.workspaceId]) badgesByWorkspace[b.workspaceId] = [];
    badgesByWorkspace[b.workspaceId].push({ id: badgeDoc.id, ...b });
  }

  const workspaceIds = Object.keys(workspaceModuleGroups);
  console.log(`🏢 Workspaces to process: ${workspaceIds.length}`);
  for (const wsId of workspaceIds) {
    const groups = workspaceModuleGroups[wsId];
    const badges = badgesByWorkspace[wsId] ?? [];
    console.log(`\n  Workspace ${wsId}: ${Object.keys(groups).length} module(s), ${badges.length} badge(s)`);
    for (const [mk, ids] of Object.entries(groups)) {
      console.log(`    Module "${mk}": ${ids.length} doc(s)`);
    }
    if (badges.length === 0) {
      console.log('    ⚠️  No active badges for this workspace — skipping.');
    }
  }

  // ── 4. Load all completed submissions ────────────────────────────────────
  console.log('\n📬 Loading all completed submissions…');
  const subsSnap = await db.collection('submissions').where('status', '==', 'complete').get();
  console.log(`   Found ${subsSnap.size} completed submission(s)`);

  // Group by userId
  const submissionsByUser = {};
  for (const subDoc of subsSnap.docs) {
    const sub = subDoc.data();
    if (!sub.userId || !sub.documentId) continue;
    if (!submissionsByUser[sub.userId]) submissionsByUser[sub.userId] = new Set();
    submissionsByUser[sub.userId].add(sub.documentId); // documentId === driveFileId
  }
  console.log(`   Unique users with completions: ${Object.keys(submissionsByUser).length}\n`);

  // ── 5. For each user × workspace, compute completed modules and award ────
  let totalAwarded = 0;
  let totalAlreadyHad = 0;
  let totalChecked = 0;

  for (const [userId, completedDriveIds] of Object.entries(submissionsByUser)) {
    for (const wsId of workspaceIds) {
      const moduleGroups = workspaceModuleGroups[wsId];
      const badges = badgesByWorkspace[wsId] ?? [];
      if (badges.length === 0) continue;

      // Determine which modules this user has fully completed
      const completedModules = new Set();
      for (const [mk, driveIds] of Object.entries(moduleGroups)) {
        if (driveIds.length > 0 && driveIds.every((fid) => completedDriveIds.has(fid))) {
          completedModules.add(mk);
        }
      }
      if (completedModules.size === 0) continue;

      // Check which badges they qualify for
      for (const badge of badges) {
        if (!Array.isArray(badge.requiredModules) || badge.requiredModules.length === 0) continue;
        const qualifies = badge.requiredModules.every((m) => completedModules.has(m));
        if (!qualifies) continue;

        totalChecked++;
        const userBadgeId = `${userId}_${badge.id}`;
        const userBadgeRef = db.collection('userBadges').doc(userBadgeId);
        const existing = await userBadgeRef.get();

        if (existing.exists) {
          totalAlreadyHad++;
          console.log(`  ✓ Already has badge "${badge.name}" → user ${userId}`);
        } else {
          totalAwarded++;
          console.log(`  🏅 ${DRY_RUN ? '[DRY RUN] Would award' : 'Awarding'} badge "${badge.name}" → user ${userId}`);
          if (!DRY_RUN) {
            await userBadgeRef.set({
              userId,
              badgeId: badge.id,
              workspaceId: wsId,
              awardedAt: FieldValue.serverTimestamp(),
            });
          }
        }
      }
    }
  }

  // ── 6. Summary ───────────────────────────────────────────────────────────
  console.log('\n── Summary ──────────────────────────────────────────────');
  console.log(`  Badge awards checked:     ${totalChecked}`);
  console.log(`  Already had badge:        ${totalAlreadyHad}`);
  console.log(`  ${DRY_RUN ? 'Would award (dry run):' : 'Newly awarded:'}        ${totalAwarded}`);
  if (DRY_RUN && totalAwarded > 0) {
    console.log('\n  Run without --dry-run to apply these awards.');
  }
  console.log('─────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
