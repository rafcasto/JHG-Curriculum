/**
 * POST /api/webhooks/payment
 *
 * Called by Zapier (or any HTTP webhook) after a successful payment on your
 * external payment site. Automatically provisions the learner:
 *   1. Creates a Firebase Auth account for the email if one doesn't exist yet
 *   2. Sets the 'learner' role claim (skipped if the user already has a role)
 *   3. Creates / merges the userProfiles Firestore document
 *   4. Adds the user to the workspace's userIds list
 *   5. Grants the appropriate access tier (upgrade-only, never downgrades)
 *
 * ── Zapier setup ──────────────────────────────────────────────────────────
 *   Trigger : Payment received in your payment platform
 *   Action  : Webhooks by Zapier → POST
 *   URL     : https://your-app.vercel.app/api/webhooks/payment
 *   Headers : Content-Type: application/json
 *   Body    : {
 *               "email":       "{{customer_email}}",
 *               "name":        "{{customer_name}}",       ← optional
 *               "workspaceId": "YOUR_FIRESTORE_WS_ID",
 *               "accessLevel": 2,                         ← 2 = self-paced, 3 = cohort
 *               "secret":      "YOUR_WORKSPACE_SECRET"
 *             }
 *
 * ── New-user login ────────────────────────────────────────────────────────
 *   Newly created accounts have no password. The learner must use the
 *   "Forgot password" link on your login page to set one, or sign in with
 *   Google using the same email address.
 *   You can optionally send a Firebase password-reset link via your email
 *   provider by calling auth.generatePasswordResetLink(email) here.
 *
 * ── Payload reference ─────────────────────────────────────────────────────
 *   email       string   learner's email address
 *   name        string?  optional display name
 *   workspaceId string   Firestore workspace document ID
 *   accessLevel 2 | 3   2 = self-paced, 3 = cohort (also grants level-2 content)
 *   secret      string   must match paywallConfig.webhookSecret for this workspace
 * ─────────────────────────────────────────────────────────────────────────
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

const auth = getAuth(adminApp);
const db = getFirestore(adminApp);

/**
 * Looks up a Firebase Auth user by email, creating them if they don't exist.
 * Sets the 'learner' role claim only if the user has no existing role claim
 * (preserves admin / editor / reviewer roles).
 * Returns { uid, created }.
 */
async function getOrCreateUser(email, displayName) {
  let firebaseUser;
  let created = false;

  try {
    firebaseUser = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    firebaseUser = await auth.createUser({
      email,
      emailVerified: false,
      ...(displayName ? { displayName } : {}),
    });
    created = true;
  }

  // Only assign 'learner' if the user has no role yet — never overwrite admin/editor/etc.
  if (!firebaseUser.customClaims?.role) {
    await auth.setCustomUserClaims(firebaseUser.uid, { role: 'learner' });
  }

  return { uid: firebaseUser.uid, created };
}

/**
 * Provisions workspace access in Firestore.
 * - Creates / merges the userProfiles document
 * - Adds the user to the workspace's userIds array
 * - Upgrades paidWorkspaces[workspaceId] if the new level is higher
 */
async function grantAccess(workspaceId, userId, email, displayName, accessLevel) {
  const userRef = db.collection('userProfiles').doc(userId);
  const wsRef = db.collection('workspaces').doc(workspaceId);

  const snap = await userRef.get();
  const currentLevel = (snap.data()?.paidWorkspaces ?? {})[workspaceId] ?? 0;

  const profileData = {
    email,
    ...(displayName ? { displayName } : {}),
    ...(accessLevel > currentLevel ? { paidWorkspaces: { [workspaceId]: accessLevel } } : {}),
  };

  const batch = db.batch();
  batch.set(userRef, profileData, { merge: true });
  batch.update(wsRef, { userIds: FieldValue.arrayUnion(userId) });
  await batch.commit();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name, workspaceId, accessLevel, secret } = req.body ?? {};

  // Validate required fields
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'email is required and must be a valid address' });
  }
  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  if (accessLevel !== 2 && accessLevel !== 3) {
    return res.status(400).json({ error: 'accessLevel must be 2 or 3' });
  }
  if (!secret || typeof secret !== 'string') {
    return res.status(400).json({ error: 'secret is required' });
  }

  // Look up the workspace and its per-workspace webhook secret
  let wsData;
  try {
    const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
    if (!wsSnap.exists) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    wsData = wsSnap.data();
  } catch (e) {
    console.error('[api/webhooks/payment] Workspace lookup failed:', e.message);
    return res.status(500).json({ error: 'Database error' });
  }

  const webhookSecret = wsData?.paywallConfig?.webhookSecret;
  if (!webhookSecret) {
    console.error(`[api/webhooks/payment] No webhookSecret configured for workspace ${workspaceId}`);
    return res.status(500).json({ error: 'Webhook secret not configured for this workspace' });
  }

  // Constant-time comparison to prevent timing attacks
  if (secret.length !== webhookSecret.length || !timingSafeEqual(secret, webhookSecret)) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  const displayName = typeof name === 'string' ? name.trim() || undefined : undefined;

  // Provision Firebase Auth user
  let uid, created;
  try {
    ({ uid, created } = await getOrCreateUser(email, displayName));
  } catch (e) {
    console.error('[api/webhooks/payment] User provisioning failed:', e.message);
    return res.status(500).json({ error: 'Failed to provision user' });
  }

  // Grant workspace access
  try {
    await grantAccess(workspaceId, uid, email, displayName, accessLevel);
    console.log(`[api/webhooks/payment] Granted level ${accessLevel}: user=${uid} (${email}) workspace=${workspaceId} created=${created}`);
    return res.status(200).json({ ok: true, userId: uid, created });
  } catch (e) {
    console.error('[api/webhooks/payment] grantAccess failed:', e.message);
    return res.status(500).json({ error: 'Failed to grant access' });
  }
}

/** Simple constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
