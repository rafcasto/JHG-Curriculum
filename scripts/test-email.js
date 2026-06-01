/**
 * Quick smoke-test for the Resend welcome-email setup.
 *
 * Usage:
 *   node scripts/test-email.js
 *
 * What it does:
 *   1. Verifies RESEND_API_KEY and RESEND_FROM_EMAIL are present in .env
 *   2. Tries to generate a Firebase password-set link for the test address
 *      (skipped gracefully if the email doesn't exist in Firebase Auth yet)
 *   3. Sends a test email via Resend
 *   4. Prints the Resend email ID on success, or the full error on failure
 */

import 'dotenv/config';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// ── Config ────────────────────────────────────────────────────────────────────
const TEST_TO = 'rafael04@mailinator.com';

const RESEND_API_KEY   = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

// ── Validate env vars ─────────────────────────────────────────────────────────
if (!RESEND_API_KEY) {
  console.error('❌  RESEND_API_KEY is not set in .env');
  process.exit(1);
}
if (!RESEND_FROM_EMAIL) {
  console.error('❌  RESEND_FROM_EMAIL is not set in .env');
  process.exit(1);
}
console.log(`✅  Env vars present  (from: ${RESEND_FROM_EMAIL})`);

// ── Firebase Admin (for password-set link, optional) ─────────────────────────
let passwordSetUrl = 'https://example.com/set-password-placeholder';

const hasServiceAccount = process.env.GOOGLE_PROJECT_ID && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL;

if (hasServiceAccount) {
  const serviceAccount = {
    type:                        process.env.GOOGLE_TYPE,
    project_id:                  process.env.GOOGLE_PROJECT_ID,
    private_key_id:              process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key:                 process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email:                process.env.GOOGLE_CLIENT_EMAIL,
    client_id:                   process.env.GOOGLE_CLIENT_ID,
    auth_uri:                    process.env.GOOGLE_AUTH_URI,
    token_uri:                   process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url:        process.env.GOOGLE_CLIENT_CERT_URL,
    universe_domain:             process.env.GOOGLE_UNIVERSE_DOMAIN,
  };
  const adminApp = getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount) })
    : getApp();
  const auth = getAuth(adminApp);

  try {
    console.log(`🔑  Generating Firebase password-set link for ${TEST_TO}…`);
    passwordSetUrl = await auth.generatePasswordResetLink(TEST_TO);
    console.log('✅  Link generated');
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.warn(`⚠️   ${TEST_TO} doesn't exist in Firebase Auth — using placeholder link.`);
    } else {
      console.error('❌  generatePasswordResetLink failed:', err.message);
      process.exit(1);
    }
  }
} else {
  console.warn('⚠️   GOOGLE_* service account vars not in .env — skipping Firebase link, using placeholder.');
}

// ── Send via Resend ───────────────────────────────────────────────────────────
console.log(`📤  Sending test email to ${TEST_TO}…`);

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${RESEND_API_KEY}`,
  },
  body: JSON.stringify({
    from: RESEND_FROM_EMAIL,
    to: [TEST_TO],
    subject: '[Test] Welcome — set your password',
    html: [
      '<p>Hi,</p>',
      '<p>This is a test email sent from the welcome-email script.</p>',
      `<p><a href="${passwordSetUrl}">Set your password</a></p>`,
      '<p>If you received this, Resend is configured correctly! 🎉</p>',
    ].join('\n'),
  }),
});

const body = await res.json();

if (!res.ok) {
  console.error('❌  Resend rejected the request:');
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log('✅  Email sent successfully!');
console.log(`   Resend ID : ${body.id}`);
console.log(`   Inbox     : https://www.mailinator.com/v4/public/inboxes.jsp?to=rafael04`);
