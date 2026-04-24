/**
 * GET   /api/catalog          — returns global tags & asset types catalog (no auth required)
 * PATCH /api/catalog          — update global catalog { tags?, assetTypes? } (admin only)
 *
 * Global catalog stored in Firestore document "config/catalog":
 *   { tags: [{label: string, value: string}], assetTypes: string[] }
 *
 * On first GET the document is auto-seeded from the hardcoded defaults below.
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

const CATALOG_REF = () => db.collection('config').doc('catalog');

const DEFAULT_TAGS = [
  { label: '0. Preparation',        value: 'Module/0-Preparation' },
  { label: '1. Goal',               value: 'Module/1-Goal' },
  { label: '2. Value - Resume',     value: 'Module/2-Value-Resume' },
  { label: '3. Value - eProfile',   value: 'Module/3-Value-eProfile' },
  { label: '4. Apply on autopilot', value: 'Module/4-Apply-on-autopilot' },
  { label: '5. Networking',         value: 'Module/5-Networking' },
  { label: '6. Interview',          value: 'Module/6-Interview' },
  { label: '7. Nego',               value: 'Module/7-Nego' },
];

const DEFAULT_ASSET_TYPES = [
  'Infographic',
  'Lesson - Text',
  'Lesson - Example',
  'Lesson - Video',
  'Homework - Instructions',
  'Homework - Template',
  'Homework - Example',
  'Homework - AI Prompt',
];

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

export default async function handler(req, res) {
  // ── GET: return catalog (no auth required) ──────────────────────────────
  if (req.method === 'GET') {
    try {
      const ref = CATALOG_REF();
      const snap = await ref.get();
      if (!snap.exists) {
        const defaults = { tags: DEFAULT_TAGS, assetTypes: DEFAULT_ASSET_TYPES };
        await ref.set(defaults);
        return res.json(defaults);
      }
      const data = snap.data();
      // Ensure both fields are present (forward-compatibility if doc is partial)
      return res.json({
        tags: data.tags ?? DEFAULT_TAGS,
        assetTypes: data.assetTypes ?? DEFAULT_ASSET_TYPES,
      });
    } catch (e) {
      console.error('[api/catalog GET]', e.message);
      // Fallback to hardcoded defaults so the app keeps working even if Firestore is down
      return res.json({ tags: DEFAULT_TAGS, assetTypes: DEFAULT_ASSET_TYPES });
    }
  }

  // ── PATCH: update catalog (admin only) ──────────────────────────────────
  if (req.method === 'PATCH') {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    let claims;
    try {
      claims = await verifyTokenClaims(token);
    } catch (e) {
      return res.status(e.status ?? 500).json({ error: e.message });
    }

    if (claims.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — admin role required' });
    }

    const { tags, assetTypes } = req.body ?? {};
    const updates = {};

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return res.status(400).json({ error: 'tags must be an array' });
      }
      const valid = tags.every(
        (t) => t && typeof t.label === 'string' && typeof t.value === 'string'
      );
      if (!valid) {
        return res.status(400).json({ error: 'each tag must have label (string) and value (string)' });
      }
      updates.tags = tags;
    }

    if (assetTypes !== undefined) {
      if (!Array.isArray(assetTypes)) {
        return res.status(400).json({ error: 'assetTypes must be an array' });
      }
      const valid = assetTypes.every((t) => typeof t === 'string');
      if (!valid) {
        return res.status(400).json({ error: 'assetTypes must be an array of strings' });
      }
      updates.assetTypes = assetTypes;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    try {
      const ref = CATALOG_REF();
      await ref.set(updates, { merge: true });
      const snap = await ref.get();
      const data = snap.data();
      return res.json({
        tags: data.tags ?? DEFAULT_TAGS,
        assetTypes: data.assetTypes ?? DEFAULT_ASSET_TYPES,
      });
    } catch (e) {
      console.error('[api/catalog PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
