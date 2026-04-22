/**
 * GET    /api/documents?workspaceId=<id>     — list early-access documents for a workspace (auth required)
 * POST   /api/documents                      — add a Drive file to early access (admin)
 *         body: { driveFileId, title, description, category, version, workspaceId }
 * PATCH  /api/documents?id=<docId>           — update document metadata (admin)
 * DELETE /api/documents?id=<docId>           — remove from early access (admin)
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

async function requireAdmin(req) {
  const claims = await requireAuth(req);
  if (claims.role !== 'admin') throw Object.assign(new Error('Forbidden — admin role required'), { status: 403 });
  return claims;
}

export default async function handler(req, res) {
  // ── GET: list early-access documents ──────────────────────────────────────
  if (req.method === 'GET') {
    try { await requireAuth(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'Missing ?workspaceId parameter' });

    try {
      const snapshot = await db.collection('documents')
        .where('workspaceId', '==', workspaceId)
        .orderBy('createdAt', 'desc')
        .get();
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.json(docs);
    } catch (e) {
      console.error('[api/documents GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: add to early access ──────────────────────────────────────────────
  if (req.method === 'POST') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { driveFileId, title, description = '', category = '', version = '1.0', workspaceId } = req.body ?? {};
    if (!driveFileId || typeof driveFileId !== 'string') {
      return res.status(400).json({ error: 'driveFileId is required' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const now = FieldValue.serverTimestamp();
    try {
      const ref = await db.collection('documents').add({
        driveFileId,
        title: title.trim(),
        description,
        category,
        version,
        workspaceId,
        status: 'early_access',
        createdAt: now,
        updatedAt: now,
      });
      return res.status(201).json({ id: ref.id });
    } catch (e) {
      console.error('[api/documents POST]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH: update document metadata ───────────────────────────────────────
  if (req.method === 'PATCH') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });

    const allowed = ['title', 'description', 'category', 'version', 'status'];
    const updates = {};
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    updates.updatedAt = FieldValue.serverTimestamp();

    try {
      const ref = db.collection('documents').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Document not found' });
      await ref.update(updates);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/documents PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE: remove from early access ──────────────────────────────────────
  if (req.method === 'DELETE') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });

    try {
      const ref = db.collection('documents').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Document not found' });
      await ref.delete();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/documents DELETE]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
