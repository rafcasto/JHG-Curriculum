/**
 * scripts/create-admin.js
 *
 * Run once locally to create the superuser and set their admin custom claim.
 * Uses Firebase Auth custom claims — no Firestore required.
 * Usage: node scripts/create-admin.js
 */

import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Build service account object from individual .env vars
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

initializeApp({ credential: cert(serviceAccount) });

const adminAuth = getAuth();

const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Error: ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
  process.exit(1);
}

async function main() {
  let uid;

  // Try to create the user; if it already exists, fetch its UID
  try {
    const userRecord = await adminAuth.createUser({ email: EMAIL, password: PASSWORD });
    uid = userRecord.uid;
    console.log(`✓ Created Firebase Auth user: ${EMAIL} (uid: ${uid})`);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      const existing = await adminAuth.getUserByEmail(EMAIL);
      uid = existing.uid;
      console.log(`ℹ User already exists: ${EMAIL} (uid: ${uid})`);
    } else {
      throw err;
    }
  }

  // Set the admin custom claim on the user's token
  await adminAuth.setCustomUserClaims(uid, { role: 'admin' });
  console.log(`✓ Custom claim set: role=admin for ${EMAIL}`);
  console.log('\nDone. Sign out and sign back in to pick up the new role.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

