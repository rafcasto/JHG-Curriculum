/**
 * GET  /api/register?workspaceId=<id>
 *   Public. Returns { name, registrationEnabled } so the register page can
 *   display the workspace name and gate the form if registration is disabled.
 *
 * POST /api/register
 *   Public. Self-registers a new learner for demo access.
 *   Body: { workspaceId, name, email, password }
 *   - Validates that paywallConfig.registrationEnabled === true for the workspace
 *   - Creates a Firebase Auth account (emailVerified: false — user must verify)
 *   - Sets role: 'learner' custom claim
 *   - Upserts userProfiles/{uid} document
 *   - Adds uid to workspace.userIds via arrayUnion
 *   Returns { success: true } on success.
 */

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

const adminApp =
  getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount) })
    : getApp();

const adminAuth = getAuth(adminApp);
const db = getFirestore(adminApp);

export default async function handler(req, res) {
  // ── GET: return workspace info for the registration page header ──────────
  if (req.method === 'GET') {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    try {
      const snap = await db.collection('workspaces').doc(workspaceId).get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      const { name, paywallConfig } = snap.data();
      return res.json({
        name: name ?? 'Workspace',
        registrationEnabled: paywallConfig?.registrationEnabled === true,
      });
    } catch (e) {
      console.error('[api/register GET]', e.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── POST: create a new learner account ───────────────────────────────────
  if (req.method === 'POST') {
    const { workspaceId, name, email, password } = req.body ?? {};

    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Verify workspace exists and registration is enabled
    let wsSnap;
    try {
      wsSnap = await db.collection('workspaces').doc(workspaceId).get();
    } catch (e) {
      console.error('[api/register POST] workspace lookup:', e.message);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!wsSnap.exists) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (wsSnap.data().paywallConfig?.registrationEnabled !== true) {
      return res.status(403).json({ error: 'Registration is not enabled for this workspace' });
    }

    const displayName = name.trim();
    const normalizedEmail = email.toLowerCase().trim();

    // Create Firebase Auth user
    let uid;
    try {
      const userRecord = await adminAuth.createUser({
        email: normalizedEmail,
        password,
        displayName,
        emailVerified: false,
      });
      uid = userRecord.uid;
    } catch (e) {
      console.error('[api/register POST] createUser:', e.message);
      if (e.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      return res.status(400).json({ error: e.message });
    }

    // Set learner role claim
    try {
      await adminAuth.setCustomUserClaims(uid, { role: 'learner' });
    } catch (e) {
      console.error('[api/register POST] setCustomUserClaims:', e.message);
      // Non-fatal — user can still be provisioned
    }

    // Upsert userProfile and add uid to workspace
    try {
      const batch = db.batch();
      batch.set(
        db.collection('userProfiles').doc(uid),
        { email: normalizedEmail, displayName, paidWorkspaces: {} },
        { merge: true }
      );
      batch.update(db.collection('workspaces').doc(workspaceId), {
        userIds: FieldValue.arrayUnion(uid),
      });
      await batch.commit();
    } catch (e) {
      console.error('[api/register POST] Firestore batch:', e.message);
      // Auth user already created — return success so client can send verification email
    }

    return res.status(201).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
