/**
 * POST /api/webhooks/payment
 *
 * Called by Zapier (or any HTTP webhook) after a successful payment on your
 * external payment site. Automatically provisions the learner:
 *   1. Creates a Firebase Auth account for the email if one doesn't exist yet
 *   2. Sets the 'learner' role claim (skipped if the user already has a role)
 *   3. Creates / merges the userProfiles Firestore document
 *   4. Adds the user to the workspace's userIds list
 *   5. Grants the appropriate access tier (upgrade-only, never downgrades)
 *
 * ── Zapier setup ──────────────────────────────────────────────────────────
 *   Trigger : Payment received in your payment platform
 *   Action  : Webhooks by Zapier → POST
 *   URL     : https://your-app.vercel.app/api/webhooks/payment
 *   Headers : Content-Type: application/json
 *   Body    : {
 *               "email":       "{{customer_email}}",
 *               "name":        "{{customer_name}}",       ← optional
 *               "workspaceId": "YOUR_FIRESTORE_WS_ID",
 *               "productId":   "{{product_id}}",          ← matches selfPacedProductId or cohortProductId
 *               "secret":      "YOUR_WORKSPACE_SECRET"
 *             }
 *
 * ── New-user login ────────────────────────────────────────────────────────
 *   Newly created accounts have no password. The learner must use the
 *   "Forgot password" link on your login page to set one, or sign in with
 *   Google using the same email address.
 *   You can optionally send a Firebase password-reset link via your email
 *   provider by calling auth.generatePasswordResetLink(email) here.
 *
 * ── Payload reference ─────────────────────────────────────────────────────
 *   email       string   learner's email address
 *   name        string?  optional display name
 *   workspaceId string   Firestore workspace document ID
 *   productId   string   must match paywallConfig.selfPacedProductId (→ level 2) or cohortProductId (→ level 3)
 *   secret      string   must match paywallConfig.webhookSecret for this workspace
 * ─────────────────────────────────────────────────────────────────────────
 */

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

const auth = getAuth(adminApp);
const db = getFirestore(adminApp);

/**
 * Looks up a Firebase Auth user by email, creating them if they don't exist.
 * Sets the 'learner' role claim only if the user has no existing role claim
 * (preserves admin / editor / reviewer roles).
 * Returns { uid, created }.
 */
async function getOrCreateUser(email, displayName) {
  let firebaseUser;
  let created = false;

  try {
    firebaseUser = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    firebaseUser = await auth.createUser({
      email,
      emailVerified: true,
      ...(displayName ? { displayName } : {}),
    });
    created = true;
  }

  // Only assign 'learner' if the user has no role yet — never overwrite admin/editor/etc.
  if (!firebaseUser.customClaims?.role) {
    await auth.setCustomUserClaims(firebaseUser.uid, { role: 'learner' });
  }

  return { uid: firebaseUser.uid, created };
}

/**
 * Provisions workspace access in Firestore.
 * - Creates / merges the userProfiles document
 * - Adds the user to the workspace's userIds array
 * - Upgrades paidWorkspaces[workspaceId] if the new level is higher
 */
async function grantAccess(workspaceId, userId, email, displayName, accessLevel) {
  const userRef = db.collection('userProfiles').doc(userId);
  const wsRef = db.collection('workspaces').doc(workspaceId);

  const snap = await userRef.get();
  const currentLevel = (snap.data()?.paidWorkspaces ?? {})[workspaceId] ?? 0;

  const profileData = {
    email,
    ...(displayName ? { displayName } : {}),
    ...(accessLevel > currentLevel ? { paidWorkspaces: { [workspaceId]: accessLevel } } : {}),
  };

  const batch = db.batch();
  batch.set(userRef, profileData, { merge: true });
  batch.update(wsRef, { userIds: FieldValue.arrayUnion(userId) });
  await batch.commit();
}

/**
 * Sends a welcome email to a newly created user with a Firebase password-set link.
 * Uses Resend (https://resend.com). Requires RESEND_API_KEY and RESEND_FROM_EMAIL env vars.
 * The email template (subject + HTML body) is loaded from wsData.paywallConfig.welcomeEmail,
 * falling back to a sensible default. Both fields support {{name}} and {{link}} placeholders.
 * The password-set link uses continueUrl (from config/app) as the Firebase action code redirect.
 *
 * NOTE: If you are on the Resend free plan without a verified domain, set RESEND_FROM_EMAIL to
 *       onboarding@resend.dev until your sending domain is verified.
 */
async function sendWelcomeEmail(email, displayName, wsData) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    console.warn('[api/webhooks/payment] RESEND_API_KEY or RESEND_FROM_EMAIL not set — skipping welcome email');
    return;
  }

  // Read global app config for the password-set redirect URL
  const appConfigSnap = await db.collection('config').doc('app').get();
  const continueUrl = appConfigSnap.data()?.continueUrl ?? null;

  // Generate the Firebase password-set link (serves as "set password" for new passwordless accounts)
  const actionCodeSettings = continueUrl ? { url: continueUrl, handleCodeInApp: false } : undefined;
  const passwordSetUrl = await auth.generatePasswordResetLink(email, actionCodeSettings);

  // Resolve template — fall back to built-in default if not configured on the workspace
  const emailTemplate = wsData?.paywallConfig?.welcomeEmail ?? {};
  const nameOrEmail = displayName ?? email;

  const DEFAULT_SUBJECT = 'Welcome! Set your password to get started';
  const DEFAULT_BODY = [
    '<p>Hi {{name}},</p>',
    '<p>Your account has been created. Click the link below to set your password and get started:</p>',
    '<p><a href="{{link}}">Set your password</a></p>',
    '<p>If you have any trouble accessing your account, contact us at ',
    '<a href="mailto:rafael@talentdojo.pro">rafael@talentdojo.pro</a>.</p>',
  ].join('\n');

  const interpolate = (str) =>
    str.replace(/\{\{name\}\}/g, nameOrEmail).replace(/\{\{link\}\}/g, passwordSetUrl);

  const subject = interpolate(emailTemplate.subject?.trim() || DEFAULT_SUBJECT);
  const html = interpolate(emailTemplate.body?.trim() || DEFAULT_BODY);

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from: fromEmail, to: [email], subject, html }),
  });

  if (!sendRes.ok) {
    const errBody = await sendRes.json().catch(() => ({}));
    throw new Error(`Resend HTTP ${sendRes.status}: ${errBody.message ?? JSON.stringify(errBody)}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Guard against unparsed body (e.g. Zapier sending wrong Content-Type)
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      console.error('[api/webhooks/payment] Failed to parse request body as JSON:', body.slice(0, 200));
      return res.status(400).json({ error: 'Request body must be valid JSON' });
    }
  }
  body = body ?? {};

  // Log incoming request (mask secret for security)
  console.log('[api/webhooks/payment] Incoming payload:', JSON.stringify({ ...body, secret: body.secret ? '***' : undefined }));

  const { email, name, workspaceId, productId, accessLevel: rawAccessLevel, secret } = body;

  // Validate required fields
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    console.error('[api/webhooks/payment] Validation failed: email is missing or invalid —', JSON.stringify(email));
    return res.status(400).json({ error: 'email is required and must be a valid address' });
  }
  if (!workspaceId || typeof workspaceId !== 'string') {
    console.error('[api/webhooks/payment] Validation failed: workspaceId is missing —', JSON.stringify(workspaceId));
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  // Either productId (resolved against paywallConfig) or accessLevel (2 or 3) must be provided
  if (!productId && rawAccessLevel == null) {
    console.error('[api/webhooks/payment] Validation failed: either productId or accessLevel is required');
    return res.status(400).json({ error: 'either productId or accessLevel (2 or 3) is required' });
  }
  if (!secret || typeof secret !== 'string') {
    console.error('[api/webhooks/payment] Validation failed: secret is missing');
    return res.status(400).json({ error: 'secret is required' });
  }

  // Look up the workspace and its per-workspace webhook secret
  let wsData;
  try {
    const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
    if (!wsSnap.exists) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    wsData = wsSnap.data();
  } catch (e) {
    console.error('[api/webhooks/payment] Workspace lookup failed:', e.message);
    return res.status(500).json({ error: 'Database error' });
  }

  const webhookSecret = wsData?.paywallConfig?.webhookSecret;
  if (!webhookSecret) {
    console.error(`[api/webhooks/payment] No webhookSecret configured for workspace ${workspaceId}`);
    return res.status(500).json({ error: 'Webhook secret not configured for this workspace' });
  }

  // Constant-time comparison to prevent timing attacks
  if (secret.length !== webhookSecret.length || !timingSafeEqual(secret, webhookSecret)) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  // Resolve access level — either from productId (against paywallConfig) or directly from accessLevel field
  const { selfPacedProductId, cohortProductId } = wsData?.paywallConfig ?? {};
  let accessLevel;
  if (productId) {
    if (productId === selfPacedProductId) {
      accessLevel = 2;
    } else if (productId === cohortProductId) {
      accessLevel = 3;
    } else {
      console.error(`[api/webhooks/payment] productId mismatch — received: '${productId}', configured selfPacedProductId: '${selfPacedProductId}', cohortProductId: '${cohortProductId}'`);
      return res.status(400).json({ error: `productId '${productId}' is not configured for this workspace` });
    }
  } else {
    const lvl = Number(rawAccessLevel);
    if (lvl !== 2 && lvl !== 3) {
      console.error(`[api/webhooks/payment] Invalid accessLevel — received: ${rawAccessLevel}, must be 2 (self-paced) or 3 (cohort)`);
      return res.status(400).json({ error: 'accessLevel must be 2 (self-paced) or 3 (cohort)' });
    }
    accessLevel = lvl;
  }

  const displayName = typeof name === 'string' ? name.trim() || undefined : undefined;

  // Provision Firebase Auth user
  let uid, created;
  try {
    ({ uid, created } = await getOrCreateUser(email, displayName));
  } catch (e) {
    console.error('[api/webhooks/payment] User provisioning failed:', e.message);
    return res.status(500).json({ error: 'Failed to provision user' });
  }

  // Grant workspace access
  try {
    await grantAccess(workspaceId, uid, email, displayName, accessLevel);
    console.log(`[api/webhooks/payment] Granted level ${accessLevel} (productId=${productId}): user=${uid} (${email}) workspace=${workspaceId} created=${created}`);

    // Send welcome email with password-set link to newly created users.
    // Awaited before responding so the serverless function stays alive long enough to complete.
    if (created) {
      try {
        await sendWelcomeEmail(email, displayName ?? null, wsData);
        console.log(`[api/webhooks/payment] Welcome email sent to ${email}`);
      } catch (err) {
        console.error('[api/webhooks/payment] Welcome email failed:', err.message);
      }
    }

    // Fire outgoing Zapier webhook if configured.
    // Awaited before responding for the same serverless-lifetime reason.
    const zapierWebhookUrl = wsData?.paywallConfig?.zapierWebhookUrl;
    if (zapierWebhookUrl) {
      try {
        await fetch(zapierWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            name: displayName ?? null,
            workspaceId,
            accessLevel,
            userId: uid,
            created,
          }),
        });
      } catch (err) {
        console.error('[api/webhooks/payment] Zapier outgoing webhook failed:', err.message);
      }
    }

    return res.status(200).json({ ok: true, userId: uid, created });
  } catch (e) {
    console.error('[api/webhooks/payment] grantAccess failed:', e.message);
    return res.status(500).json({ error: 'Failed to grant access' });
  }
}

/** Simple constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
