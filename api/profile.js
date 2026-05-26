/**
 * GET   /api/profile  — fetch the authenticated user's profile
 * PATCH /api/profile  — update the authenticated user's profile fields
 *
 * Firestore collection: userProfiles/{uid}
 * Schema: { firstName, lastName, dateOfBirth, company, photoURL, updatedAt }
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

const ALLOWED_FIELDS = ['firstName', 'lastName', 'dateOfBirth', 'company', 'photoURL'];

export default async function handler(req, res) {
  let claims;
  try {
    claims = await requireAuth(req);
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }

  const { uid } = claims;

  // ── GET: fetch own profile ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const snap = await db.collection('userProfiles').doc(uid).get();
      if (!snap.exists) {
        return res.json({ uid, firstName: '', lastName: '', dateOfBirth: '', company: '', photoURL: '' });
      }
      return res.json({ uid, ...snap.data() });
    } catch (e) {
      console.error('[api/profile GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH: update own profile ──────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const updates = {};

    for (const field of ALLOWED_FIELDS) {
      if (field in body) {
        if (typeof body[field] !== 'string') {
          return res.status(400).json({ error: `${field} must be a string` });
        }
        updates[field] = body[field].trim();
      }
    }

    if ('photoURL' in updates && updates.photoURL !== '') {
      try {
        new URL(updates.photoURL);
      } catch {
        return res.status(400).json({ error: 'photoURL must be a valid URL' });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.updatedAt = new Date().toISOString();

    try {
      await db.collection('userProfiles').doc(uid).set(updates, { merge: true });
      const snap = await db.collection('userProfiles').doc(uid).get();
      return res.json({ uid, ...snap.data() });
    } catch (e) {
      console.error('[api/profile PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
