/**
 * GET /api/certificates-public?uid=<uid>
 *   — Public (no auth) endpoint that returns certificate data for display on a shareable page.
 *   — Only exposes public-safe fields: workspace name, award date, total lessons, learner name.
 *   — Used as the certUrl in LinkedIn "Add to Profile" deep links.
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'Missing ?uid parameter' });

  try {
    const [certSnap, profileSnap] = await Promise.all([
      db.collection('certificates').doc(uid).get(),
      db.collection('userProfiles').doc(uid).get(),
    ]);

    if (!certSnap.exists) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const cert = certSnap.data();
    const profile = profileSnap.exists ? profileSnap.data() : {};

    const firstName = profile.firstName ?? '';
    const lastName = profile.lastName ?? '';
    const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : null;

    return res.json({
      displayName,
      workspaceName: cert.workspaceName,
      awardedAt: cert.awardedAt,
      totalLessons: cert.totalLessons,
    });
  } catch (e) {
    console.error('[api/certificates-public GET]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
