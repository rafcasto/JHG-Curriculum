/**
 * GET   /api/config  — returns global app config (admin only)
 * PATCH /api/config  — update global app config { continueUrl? } (admin only)
 *
 * Global app config stored in Firestore document "config/app":
 *   { continueUrl: string }  — https:// URL used as the Firebase action-code
 *                              continue URL (redirect after a user sets their
 *                              password via a welcome email).
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

const APP_CONFIG_REF = () => db.collection('config').doc('app');

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
  // Both GET and PATCH require admin auth
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

  const ref = APP_CONFIG_REF();

  // ── GET: return app config ───────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const snap = await ref.get();
      return res.json(snap.exists ? snap.data() : {});
    } catch (e) {
      console.error('[api/config GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH: update app config ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { continueUrl } = req.body ?? {};
    const updates = {};

    if (continueUrl !== undefined) {
      if (continueUrl === null || continueUrl === '') {
        updates.continueUrl = null;
      } else {
        if (typeof continueUrl !== 'string') {
          return res.status(400).json({ error: 'continueUrl must be a string or null' });
        }
        try {
          const parsed = new URL(continueUrl.trim());
          if (parsed.protocol !== 'https:') {
            return res.status(400).json({ error: 'continueUrl must use https://' });
          }
        } catch {
          return res.status(400).json({ error: 'continueUrl must be a valid URL' });
        }
        updates.continueUrl = continueUrl.trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    try {
      await ref.set(updates, { merge: true });
      const snap = await ref.get();
      return res.json(snap.data() ?? {});
    } catch (e) {
      console.error('[api/config PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
