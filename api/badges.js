/**
 * GET    /api/badges?workspaceId=<id>              — list badge definitions for workspace (auth)
 * GET    /api/badges?earned=true&workspaceId=<id>  — list current user's earned badges (auth)
 * POST   /api/badges                               — create badge definition (admin)
 *         body: { workspaceId, name, description, icon, iconType, requiredModules }
 * PATCH  /api/badges?id=<badgeId>                  — update badge (admin)
 * DELETE /api/badges?id=<badgeId>                  — delete badge + all userBadges referencing it (admin)
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
  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    let claims;
    try { claims = await requireAuth(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { workspaceId, earned } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'Missing ?workspaceId parameter' });

    try {
      if (earned === 'true') {
        // Earned badges for the current user in this workspace
        const snapshot = await db.collection('userBadges')
          .where('userId', '==', claims.uid)
          .where('workspaceId', '==', workspaceId)
          .get();
        return res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      }

      // Badge definitions for a workspace
      const snapshot = await db.collection('badges')
        .where('workspaceId', '==', workspaceId)
        .orderBy('createdAt', 'asc')
        .get();
      return res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('[api/badges GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: create badge definition ─────────────────────────────────────────
  if (req.method === 'POST') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const {
      workspaceId,
      name,
      description = '',
      icon = '🏅',
      iconType = 'emoji',
      requiredModules = [],
    } = req.body ?? {};

    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!Array.isArray(requiredModules) || requiredModules.length === 0) {
      return res.status(400).json({ error: 'requiredModules must be a non-empty array of module keys' });
    }

    const now = FieldValue.serverTimestamp();
    try {
      const ref = await db.collection('badges').add({
        workspaceId,
        name: name.trim(),
        description,
        icon,
        iconType,
        requiredModules,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      return res.status(201).json({ id: ref.id });
    } catch (e) {
      console.error('[api/badges POST]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH: update badge definition ────────────────────────────────────────
  if (req.method === 'PATCH') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });

    const allowed = ['name', 'description', 'icon', 'iconType', 'requiredModules', 'active'];
    const updates = {};
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    if (updates.name !== undefined) {
      if (!updates.name || !updates.name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      updates.name = updates.name.trim();
    }
    if (updates.requiredModules !== undefined) {
      if (!Array.isArray(updates.requiredModules) || updates.requiredModules.length === 0) {
        return res.status(400).json({ error: 'requiredModules must be a non-empty array' });
      }
    }
    updates.updatedAt = FieldValue.serverTimestamp();

    try {
      const ref = db.collection('badges').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Badge not found' });
      await ref.update(updates);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/badges PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE: remove badge definition and all earned records ────────────────
  if (req.method === 'DELETE') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });

    try {
      const ref = db.collection('badges').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Badge not found' });

      // Delete all userBadges referencing this badge
      const userBadgesSnap = await db.collection('userBadges')
        .where('badgeId', '==', id)
        .get();
      const batch = db.batch();
      userBadgesSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(ref);
      await batch.commit();

      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/badges DELETE]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
