/**
 * GET /api/scores?documentId=<id>  — get aggregate scores for a document
 *                                     admin: full scores object
 *                                     authenticated: just averageQualityScore and totalSubmissions
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let claims;
  try {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    claims = await verifyTokenClaims(token);
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }

  const { documentId, documentIds } = req.query;

  // ── Batch mode: ?documentIds=id1,id2,... ────────────────────────────────
  if (documentIds) {
    const ids = documentIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ error: 'documentIds is empty' });
    if (ids.length > 500) return res.status(400).json({ error: 'documentIds exceeds 500 limit' });
    try {
      const refs = ids.map((id) => db.collection('scores').doc(id));
      const snaps = await db.getAll(...refs);
      const result = {};
      const isAdmin = claims.role === 'admin';
      for (const snap of snaps) {
        const docId = snap.id;
        if (!snap.exists) {
          result[docId] = {
            documentId: docId,
            averageQualityScore: null,
            averageConfidenceDelta: null,
            totalSubmissions: 0,
            scoreDistribution: { excellent: 0, good: 0, needsWork: 0, rethink: 0 },
            lastUpdated: null,
          };
        } else {
          const data = snap.data();
          result[docId] = isAdmin
            ? { id: snap.id, ...data }
            : { documentId: docId, averageQualityScore: data.averageQualityScore, totalSubmissions: data.totalSubmissions };
        }
      }
      return res.json(result);
    } catch (e) {
      console.error('[api/scores GET batch]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Single mode: ?documentId=<id> ───────────────────────────────────────
  if (!documentId) return res.status(400).json({ error: 'Missing ?documentId or ?documentIds parameter' });

  try {
    const snap = await db.collection('scores').doc(documentId).get();
    if (!snap.exists) {
      return res.json({
        documentId,
        averageQualityScore: null,
        averageConfidenceDelta: null,
        totalSubmissions: 0,
        scoreDistribution: { excellent: 0, good: 0, needsWork: 0, rethink: 0 },
        lastUpdated: null,
      });
    }

    const data = snap.data();
    if (claims.role !== 'admin') {
      return res.json({
        documentId,
        averageQualityScore: data.averageQualityScore,
        totalSubmissions: data.totalSubmissions,
      });
    }

    return res.json({ id: snap.id, ...data });
  } catch (e) {
    console.error('[api/scores GET]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
