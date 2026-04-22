/**
 * scripts/seed-questions.js
 *
 * Seeds the `questions` Firestore collection with the default warm-up and
 * post-reading questions.  Idempotent: skips any question whose `text`
 * already exists in the collection.
 *
 * Usage:
 *   node scripts/seed-questions.js
 *
 * Requires the same .env variables used by create-admin.js.
 */

import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Firebase Admin init ───────────────────────────────────────────────────

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

const db = getFirestore();

// ── Question definitions ──────────────────────────────────────────────────

/**
 * One pre question (warm-up) — kept in Firestore for record-keeping /
 * possible future admin customisation. Warm-up rendering in the UI is
 * still handled by WarmupQuestion.jsx which is intentionally hardcoded
 * so it always renders even without this document.
 */
const PRE_QUESTIONS = [
  {
    touchpoint: 'pre',
    order: 1,
    active: true,
    type: 'single_choice',
    text: 'How familiar are you with this topic before reading?',
    options: [
      { label: '🌱 Complete beginner', value: 1 },
      { label: '📖 Some exposure', value: 2 },
      { label: '💪 Fairly confident', value: 3 },
      { label: '🎯 Expert', value: 4 },
    ],
    weight: 0,
    includedInScore: false,
    isOptional: false,
    scaleMin: 1,
    scaleMax: 4,
    scaleAnchors: { min: 'Novice', max: 'Expert' },
  },
];

/**
 * Seven post-reading questions.
 * Weights must sum to 1.0 across all questions where includedInScore = true.
 *   Q1  (confidence post)  0.25
 *   Q2  (clarity)          0.25
 *   Q3  (difficulty fit)   0     – diagnostic only
 *   Q4  (real-world)       0.20
 *   Q5  (most valuable)    0     – open text
 *   Q6  (gaps/confusion)   0     – open text
 *   Q7  (overall rating)   0.30
 *                          ────
 *                          1.00
 */
const POST_QUESTIONS = [
  {
    touchpoint: 'post',
    order: 1,
    active: true,
    type: 'scale',
    text: 'How confident do you feel about this topic now that you have read through the document?',
    scaleMin: 1,
    scaleMax: 5,
    scaleAnchors: { min: 'Not at all confident', max: 'Very confident' },
    weight: 0.25,
    includedInScore: true,
    isOptional: false,
  },
  {
    touchpoint: 'post',
    order: 2,
    active: true,
    type: 'scale',
    text: 'How clear and easy to understand was the writing?',
    scaleMin: 1,
    scaleMax: 5,
    scaleAnchors: { min: 'Very unclear', max: 'Very clear' },
    weight: 0.25,
    includedInScore: true,
    isOptional: false,
  },
  {
    touchpoint: 'post',
    order: 3,
    active: true,
    type: 'single_choice',
    text: 'How did the difficulty level of this document feel for you?',
    options: [
      { label: 'Too basic — I already knew all of this', value: 1 },
      { label: 'Just right', value: 2 },
      { label: 'Slightly too advanced in places', value: 3 },
      { label: 'Way over my head', value: 4 },
    ],
    weight: 0,
    includedInScore: false,
    isOptional: false,
  },
  {
    touchpoint: 'post',
    order: 4,
    active: true,
    type: 'single_choice',
    text: 'Could you apply what you learned in a real-world context?',
    options: [
      { label: 'Yes, I could use it straight away', value: 100 },
      { label: 'Yes, but not immediately', value: 75 },
      { label: 'Possibly, with more context', value: 40 },
      { label: 'Not really', value: 10 },
    ],
    weight: 0.20,
    includedInScore: true,
    isOptional: false,
  },
  {
    touchpoint: 'post',
    order: 5,
    active: true,
    type: 'open_text',
    text: 'What was the most valuable thing you took away from this document?',
    weight: 0,
    includedInScore: false,
    isOptional: true,
  },
  {
    touchpoint: 'post',
    order: 6,
    active: true,
    type: 'open_text',
    text: 'Were there any gaps, confusing sections, or topics you wish had been covered?',
    weight: 0,
    includedInScore: false,
    isOptional: true,
  },
  {
    touchpoint: 'post',
    order: 7,
    active: true,
    type: 'star_rating',
    text: 'Overall, how would you rate the quality of this document?',
    scaleMin: 1,
    scaleMax: 5,
    scaleAnchors: { min: 'Poor', max: 'Excellent' },
    weight: 0.30,
    includedInScore: true,
    isOptional: false,
  },
];

const ALL_QUESTIONS = [...PRE_QUESTIONS, ...POST_QUESTIONS];

// ── Seed logic ────────────────────────────────────────────────────────────

async function seed() {
  const col = db.collection('questions');

  // Load existing question texts for deduplication
  const existing = await col.get();
  const existingTexts = new Set(existing.docs.map((d) => d.data().text?.trim()));

  let created = 0;
  let skipped = 0;

  for (const q of ALL_QUESTIONS) {
    if (existingTexts.has(q.text?.trim())) {
      console.log(`  SKIP  [${q.touchpoint}/${q.order}] ${q.text.slice(0, 60)}`);
      skipped++;
      continue;
    }

    await col.add({ ...q, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    console.log(`  ADD   [${q.touchpoint}/${q.order}] ${q.text.slice(0, 60)}`);
    created++;
  }

  console.log(`\nDone. ${created} added, ${skipped} skipped.`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
