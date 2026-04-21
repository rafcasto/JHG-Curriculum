/**
 * GET    /api/users           — list all users (via Firebase Auth listUsers)
 * POST   /api/users           — create user  { email, password, role }
 * PATCH  /api/users?uid=<uid> — update role  { role }
 * DELETE /api/users?uid=<uid> — delete user
 *
 * Roles are stored as Firebase Auth custom claims { role: 'admin'|'editor'|'viewer' }.
 * No Firestore required.
 * All methods require Authorization: Bearer <firebase-id-token> from an admin.
 */

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

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

const adminApp = getApps().length === 0
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();

const adminAuth = getAuth(adminApp);

const VALID_ROLES = ['admin', 'editor', 'viewer'];

/**
 * Verify the Firebase ID token using the Firebase Auth REST API and return
 * the decoded claims (including custom claims like `role`).
 * This avoids the Admin SDK's verifyIdToken which triggers gRPC calls that
 * may fail if the project's Identity Platform isn't fully provisioned.
 */
async function verifyTokenClaims(token) {
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) throw Object.assign(new Error('VITE_FIREBASE_API_KEY not set'), { status: 500 });

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message ?? 'Token verification failed';
    throw Object.assign(new Error(msg), { status: 401 });
  }
  const user = data.users?.[0];
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

  const customClaims = user.customAttributes
    ? JSON.parse(user.customAttributes)
    : {};

  return { uid: user.localId, email: user.email, ...customClaims };
}

/** Verify the caller's token and confirm they have the admin custom claim. */
async function requireAdmin(req) {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const claims = await verifyTokenClaims(token);
  if (claims.role !== 'admin') {
    throw Object.assign(new Error('Forbidden — admin role required'), { status: 403 });
  }
  return claims;
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }

  // ── GET: list all users ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const result = await adminAuth.listUsers(1000);
      const users = result.users.map((u) => ({
        uid: u.uid,
        email: u.email ?? '',
        role: u.customClaims?.role ?? 'viewer',
        createdAt: u.metadata.creationTime,
      }));
      users.sort((a, b) => a.email.localeCompare(b.email));
      return res.json(users);
    } catch (e) {
      console.error('[api/users GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: create user ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { email, password, role } = req.body ?? {};
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, and role are required' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    try {
      const userRecord = await adminAuth.createUser({ email, password });
      await adminAuth.setCustomUserClaims(userRecord.uid, { role });
      return res.status(201).json({
        uid: userRecord.uid,
        email,
        role,
        createdAt: userRecord.metadata.creationTime,
      });
    } catch (e) {
      console.error('[api/users POST]', e.message);
      return res.status(400).json({ error: e.message });
    }
  }

  // ── PATCH: update role ─────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { uid } = req.query;
    const { role } = req.body ?? {};
    if (!uid) return res.status(400).json({ error: 'Missing ?uid parameter' });
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    try {
      await adminAuth.setCustomUserClaims(uid, { role });
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/users PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE: remove user ────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: 'Missing ?uid parameter' });
    try {
      await adminAuth.deleteUser(uid);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/users DELETE]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

