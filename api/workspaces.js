/**
 * GET    /api/workspaces           — list workspaces
 *                                     admin: all workspaces
 *                                     user:  only workspaces they are assigned to
 * POST   /api/workspaces           — create workspace { name, driveFolderId }  (admin)
 * PATCH  /api/workspaces?id=<id>   — update { name?, driveFolderId?, addUser?, removeUser? } (admin)
 * DELETE /api/workspaces?id=<id>   — delete workspace  (admin)
 *
 * Workspace documents in Firestore collection "workspaces":
 *   { name: string, driveFolderId: string, userIds: string[], createdAt: string }
 *
 * All methods require Authorization: Bearer <firebase-id-token>.
 * Write methods additionally require the admin custom claim.
 */

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
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

const db = getFirestore(adminApp);

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
  let claims;
  try {
    claims = await requireAuth(req);
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }

  const isAdmin = claims.role === 'admin';

  // ── GET: list workspaces ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const col = db.collection('workspaces');
      const snap = isAdmin
        ? await col.get()
        : await col.where('userIds', 'array-contains', claims.uid).get();

      const workspaces = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      return res.json(workspaces);
    } catch (e) {
      console.error('[api/workspaces GET]', e.message);
      const msg = e.code === 5 || e.message?.includes('NOT_FOUND')
        ? 'Firestore database not found. Please create a Firestore database in the Firebase Console for project jhg-academy.'
        : e.message;
      return res.status(500).json({ error: msg });
    }
  }

  // All write operations require admin role
  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden — admin role required' });
  }

  // ── POST: create workspace ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, driveFolderId } = req.body ?? {};
    if (!name || !driveFolderId) {
      return res.status(400).json({ error: 'name and driveFolderId are required' });
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    // Basic validation: Google Drive IDs are alphanumeric + underscores/hyphens
    if (typeof driveFolderId !== 'string' || !/^[a-zA-Z0-9_-]{10,}$/.test(driveFolderId)) {
      return res.status(400).json({ error: 'driveFolderId appears invalid' });
    }
    try {
      const docRef = await db.collection('workspaces').add({
        name: name.trim(),
        driveFolderId,
        userIds: [],
        createdAt: new Date().toISOString(),
      });
      return res.status(201).json({
        id: docRef.id,
        name: name.trim(),
        driveFolderId,
        userIds: [],
      });
    } catch (e) {
      console.error('[api/workspaces POST]', e.message);
      const msg = e.code === 5 || e.message?.includes('NOT_FOUND')
        ? 'Firestore database not found. Please create a Firestore database in the Firebase Console for project jhg-academy.'
        : e.message;
      return res.status(500).json({ error: msg });
    }
  }

  // ── PATCH: update workspace name/folder or add/remove a user ──────────────
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });

    const { name, driveFolderId, addUser, removeUser } = req.body ?? {};

    if (addUser && removeUser) {
      return res.status(400).json({ error: 'addUser and removeUser are mutually exclusive in one request' });
    }

    try {
      const ref = db.collection('workspaces').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Workspace not found' });

      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (driveFolderId !== undefined) {
        if (!/^[a-zA-Z0-9_-]{10,}$/.test(driveFolderId)) {
          return res.status(400).json({ error: 'driveFolderId appears invalid' });
        }
        updates.driveFolderId = driveFolderId;
      }
      if ('instructionFileId' in (req.body ?? {})) {
        updates.instructionFileId = req.body.instructionFileId ?? null;
      }
      if (addUser) updates.userIds = FieldValue.arrayUnion(addUser);
      if (removeUser) updates.userIds = FieldValue.arrayRemove(removeUser);

      await ref.update(updates);
      const updated = await ref.get();
      return res.json({ id, ...updated.data() });
    } catch (e) {
      console.error('[api/workspaces PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE: delete workspace ───────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });
    try {
      await db.collection('workspaces').doc(id).delete();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/workspaces DELETE]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
