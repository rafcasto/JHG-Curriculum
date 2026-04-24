/**
 * GET    /api/questions                      — list questions (auth required)
 *                                              ?touchpoint=pre|post   — filter by touchpoint
 *                                              ?activeOnly=true       — only active questions
 *                                              Admin sees all; non-admin always gets active only.
 * POST   /api/questions                      — create question (admin)
 * PATCH  /api/questions?id=<questionId>      — update question fields (admin)
 * DELETE /api/questions?id=<questionId>      — delete question (admin)
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

const VALID_TYPES = ['scale', 'single_choice', 'open_text', 'star_rating'];
const VALID_TOUCHPOINTS = ['pre', 'post'];

export default async function handler(req, res) {
  // ── GET: list questions ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    let claims;
    try { claims = await requireAuth(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { touchpoint, activeOnly, workspaceId } = req.query;
    const isAdmin = claims.role === 'admin';

    try {
      const snapshot = await db.collection('questions').orderBy('order', 'asc').get();
      let questions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      if (touchpoint && VALID_TOUCHPOINTS.includes(touchpoint)) {
        questions = questions.filter((q) => q.touchpoint === touchpoint);
      }
      // Non-admins always see active questions only
      if (!isAdmin || activeOnly === 'true') {
        questions = questions.filter((q) => q.active === true);
      }
      // Filter by workspace: return global questions (no workspaceId) + matching workspace questions
      if (workspaceId) {
        questions = questions.filter((q) => !q.workspaceId || q.workspaceId === workspaceId);
      }

      return res.json(questions);
    } catch (e) {
      console.error('[api/questions GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: create question ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const {
      text, type, touchpoint, order, options = [],
      scaleMin, scaleMax, scaleAnchors = {},
      weight = 0, includedInScore = false, isOptional = false, active = true,
      workspaceId,
    } = req.body ?? {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!VALID_TOUCHPOINTS.includes(touchpoint)) {
      return res.status(400).json({ error: "touchpoint must be 'pre' or 'post'" });
    }

    const now = FieldValue.serverTimestamp();
    const docData = {
      text: text.trim(),
      type,
      touchpoint,
      order: typeof order === 'number' ? order : 999,
      options: Array.isArray(options) ? options : [],
      scaleMin: scaleMin ?? null,
      scaleMax: scaleMax ?? null,
      scaleAnchors: { min: scaleAnchors.min ?? '', max: scaleAnchors.max ?? '' },
      weight: typeof weight === 'number' ? weight : 0,
      includedInScore: Boolean(includedInScore),
      isOptional: Boolean(isOptional),
      active: Boolean(active),
      workspaceId: workspaceId || null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const ref = await db.collection('questions').add(docData);
      return res.status(201).json({ id: ref.id });
    } catch (e) {
      console.error('[api/questions POST]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH: update question ─────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });

    const allowed = [
      'text', 'type', 'touchpoint', 'order', 'options',
      'scaleMin', 'scaleMax', 'scaleAnchors',
      'weight', 'includedInScore', 'isOptional', 'active', 'workspaceId',
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    updates.updatedAt = FieldValue.serverTimestamp();

    try {
      const ref = db.collection('questions').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Question not found' });
      await ref.update(updates);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/questions PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE: delete question ────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try { await requireAdmin(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });

    try {
      const ref = db.collection('questions').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Question not found' });
      await ref.delete();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/questions DELETE]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
