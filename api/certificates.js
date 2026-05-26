/**
 * GET /api/certificates?workspaceId=<id>
 *   — Checks whether the authenticated user has completed all documents in the workspace.
 *   — If all complete, auto-awards (or refreshes) a certificate in Firestore at certificates/{uid}.
 *   — Returns: { completedCount, totalLessons, certificate: object|null }
 *
 * Firestore collection: certificates/{uid}
 * Schema: { userId, workspaceId, workspaceName, awardedAt, totalLessons }
 *
 * Requires Authorization: Bearer <firebase-id-token>
 */

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

const adminApp =
  getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount) })
    : getApp();

const db = getFirestore(adminApp);

async function verifyTokenClaims(token) {
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) throw Object.assign(new Error('VITE_FIREBASE_API_KEY not set'), { status: 500 });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
  );
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? 'Token verification failed'), { status: 401 });
  const user = data.users?.[0];
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });
  const customClaims = user.customAttributes ? JSON.parse(user.customAttributes) : {};
  return { uid: user.localId, email: user.email, ...customClaims };
}

async function requireAuth(req) {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return verifyTokenClaims(token);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Public (no auth): GET /api/certificates?uid=<uid> ────────────────────
  if (req.query.uid && !req.headers['authorization']) {
    const { uid: targetUid } = req.query;
    try {
      const [certSnap, profileSnap] = await Promise.all([
        db.collection('certificates').doc(targetUid).get(),
        db.collection('userProfiles').doc(targetUid).get(),
      ]);
      if (!certSnap.exists) return res.status(404).json({ error: 'Certificate not found' });
      const certData = certSnap.data();
      const profile = profileSnap.exists ? profileSnap.data() : {};
      const firstName = profile.firstName ?? '';
      const lastName = profile.lastName ?? '';
      const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : null;
      return res.json({
        displayName,
        workspaceName: certData.workspaceName,
        awardedAt: certData.awardedAt,
        totalLessons: certData.totalLessons,
      });
    } catch (e) {
      console.error('[api/certificates public GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  let claims;
  try {
    claims = await requireAuth(req);
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }

  const { uid } = claims;
  const { workspaceId } = req.query;
  if (!workspaceId) return res.status(400).json({ error: 'Missing ?workspaceId parameter' });

  try {
    // Fetch workspace to get its name
    const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
    if (!wsSnap.exists) return res.status(404).json({ error: 'Workspace not found' });
    const workspaceName = wsSnap.data().name ?? workspaceId;

    // Fetch all documents assigned to this workspace
    const docsSnap = await db.collection('documents')
      .where('workspaceId', '==', workspaceId)
      .get();
    const docs = docsSnap.docs.map((d) => ({ id: d.id, driveFileId: d.data().driveFileId }));
    const totalLessons = docs.length;

    if (totalLessons === 0) {
      return res.json({ completedCount: 0, totalLessons: 0, certificate: null });
    }

    // Batch-fetch submissions for this user across all docs.
    // Submissions are keyed as `${uid}_${driveFileId}` because ReviewerSidebar
    // navigates to /file/:driveFileId, which FilePage uses as documentId.
    const docsWithDriveId = docs.filter((d) => d.driveFileId);
    const subRefs = docsWithDriveId.map((d) => db.collection('submissions').doc(`${uid}_${d.driveFileId}`));
    const subSnaps = subRefs.length > 0 ? await db.getAll(...subRefs) : [];
    const completedCount = subSnaps.filter(
      (s) => s.exists && s.data().status === 'complete'
    ).length;

    // Check if a certificate already exists
    const certRef = db.collection('certificates').doc(uid);
    const certSnap = await certRef.get();
    const existingCert = certSnap.exists ? { uid, ...certSnap.data() } : null;

    // Award certificate when all lessons are complete
    if (completedCount === totalLessons) {
      const now = new Date().toISOString();
      const certData = {
        userId: uid,
        workspaceId,
        workspaceName,
        totalLessons,
        awardedAt: existingCert?.awardedAt ?? now,
        updatedAt: now,
      };
      await certRef.set(certData, { merge: true });
      return res.json({ completedCount, totalLessons, certificate: { uid, ...certData } });
    }

    return res.json({ completedCount, totalLessons, certificate: existingCert });
  } catch (e) {
    console.error('[api/certificates GET]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
