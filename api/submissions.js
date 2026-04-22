/**
 * GET    /api/submissions?documentId=<id>        — get the authenticated user's submission for a doc
 *                                                  admin + ?all=true lists all submissions for that doc
 * POST   /api/submissions                        — create a warm-up draft submission
 *         body: { documentId, warmupAnswer }       (userId extracted from token)
 * PATCH  /api/submissions?id=<submissionId>      — complete submission with full post-reading responses
 *         body: { responses: { [questionId]: rawValue } }
 *
 * Scoring model (Content Quality Score 0–100):
 *   normalise(raw, min, max) = (raw - min) / (max - min) * 100
 *   CQS = sum( normalised[q] * q.weight ) for all questions where includedInScore === true
 *   confidenceDelta = Q1.raw - warmupMappedScore
 *   warmupMappedScore = ((warmupAnswer - 1) / 3) * 4 + 1   (maps 1–4 to 1–5)
 *
 * Submission IDs are deterministic: `${userId}_${documentId}` to prevent duplicate submissions
 * and allow O(1) lookups without composite indexes.
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

// ── Scoring helpers ────────────────────────────────────────────────────────

function normalise(raw, min, max) {
  if (max === min) return 0;
  return ((Number(raw) - min) / (max - min)) * 100;
}

function mapWarmup(warmupAnswer) {
  // Maps 1–4 scale to 1–5 scale
  return ((warmupAnswer - 1) / 3) * 4 + 1;
}

function getInterpretation(score) {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Needs Work';
  return 'Rethink';
}

function getDistributionBucket(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 55) return 'needsWork';
  return 'rethink';
}

function computeScores(questions, responses) {
  const normalisedResponses = {};
  const questionScores = {};
  let weightedSum = 0;
  let difficultyFit = null;
  let confidenceShiftRaw = null; // Q1 raw value (confidence after reading)

  for (const q of questions) {
    if (q.touchpoint !== 'post') continue;
    const raw = responses[q.id];

    // Track the confidence shift question (scale, includedInScore, first one found)
    if (q.type === 'scale' && q.includedInScore && confidenceShiftRaw === null && raw !== undefined) {
      // Heuristic: the first included scale question is Q1 (confidence shift)
      // This is overridden below by explicit question tagging if available
    }

    let normalised = null;
    if (raw === undefined || raw === null || raw === '') {
      normalisedResponses[q.id] = { raw: raw ?? null, normalised: null };
      continue;
    }

    if (q.type === 'scale' || q.type === 'star_rating') {
      normalised = normalise(raw, q.scaleMin ?? 1, q.scaleMax ?? 5);
    } else if (q.type === 'single_choice') {
      const option = (q.options ?? []).find(
        (o) => o.value === Number(raw) || o.value === raw
      );
      normalised = option ? option.value : null;
      // Track difficulty fit (non-scored single_choice question)
      if (!q.includedInScore && option) {
        difficultyFit = option.label;
      }
    }
    // open_text: normalised stays null

    normalisedResponses[q.id] = { raw, normalised };

    if (!q.includedInScore || q.weight === 0 || normalised === null) continue;

    const contribution = normalised * q.weight;
    questionScores[q.id] = contribution;
    weightedSum += contribution;
  }

  return { normalisedResponses, questionScores, weightedSum, difficultyFit };
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── GET: retrieve submission ────────────────────────────────────────────────
  if (req.method === 'GET') {
    let claims;
    try { claims = await requireAuth(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { documentId, all } = req.query;
    if (!documentId) return res.status(400).json({ error: 'Missing ?documentId parameter' });

    try {
      if (all === 'true' && claims.role === 'admin') {
        // Admin: list all submissions for a document
        const snapshot = await db.collection('submissions')
          .where('documentId', '==', documentId)
          .get();
        return res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      }

      // Regular user: get own submission
      const submissionId = `${claims.uid}_${documentId}`;
      const snap = await db.collection('submissions').doc(submissionId).get();
      if (!snap.exists) return res.status(404).json({ error: 'No submission found' });
      return res.json({ id: snap.id, ...snap.data() });
    } catch (e) {
      console.error('[api/submissions GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: create warm-up draft submission ──────────────────────────────────
  if (req.method === 'POST') {
    let claims;
    try { claims = await requireAuth(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { documentId, warmupAnswer } = req.body ?? {};
    if (!documentId || typeof documentId !== 'string') {
      return res.status(400).json({ error: 'documentId is required' });
    }
    const warmup = Number(warmupAnswer);
    if (!Number.isInteger(warmup) || warmup < 1 || warmup > 4) {
      return res.status(400).json({ error: 'warmupAnswer must be an integer 1–4' });
    }

    const submissionId = `${claims.uid}_${documentId}`;

    // Prevent overwriting a completed submission
    const existing = await db.collection('submissions').doc(submissionId).get();
    if (existing.exists && existing.data().status === 'complete') {
      return res.status(409).json({ error: 'Submission already completed' });
    }

    const warmupMappedScore = mapWarmup(warmup);
    try {
      await db.collection('submissions').doc(submissionId).set({
        id: submissionId,
        documentId,
        userId: claims.uid,
        status: 'draft',
        warmupAnswer: warmup,
        warmupMappedScore,
        responses: {},
        scores: {},
        contentQualityScore: null,
        confidenceDelta: null,
        difficultyFit: null,
        questionsSnapshot: [],
        submittedAt: null,
        formVersion: null,
      }, { merge: true });

      return res.status(201).json({
        submissionId,
        status: 'draft',
        warmupAnswer: warmup,
        warmupMappedScore,
        documentId,
        userId: claims.uid,
      });
    } catch (e) {
      console.error('[api/submissions POST]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH: complete submission with full responses ─────────────────────────
  if (req.method === 'PATCH') {
    let claims;
    try { claims = await requireAuth(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }

    const { id: submissionId } = req.query;
    if (!submissionId) return res.status(400).json({ error: 'Missing ?id parameter' });

    const { responses, reviewDuration } = req.body ?? {};
    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'responses object is required' });
    }

    try {
      // Load existing submission
      const submissionRef = db.collection('submissions').doc(submissionId);
      const submissionSnap = await submissionRef.get();
      if (!submissionSnap.exists) return res.status(404).json({ error: 'Submission not found' });

      const submission = submissionSnap.data();
      // Verify ownership
      if (submission.userId !== claims.uid && claims.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (submission.status === 'complete') {
        return res.status(409).json({ error: 'Submission already completed' });
      }

      // Load active post questions
      const questionsSnap = await db.collection('questions')
        .where('active', '==', true)
        .where('touchpoint', '==', 'post')
        .get();
      const questions = questionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Compute scores
      const { normalisedResponses, questionScores, weightedSum, difficultyFit } =
        computeScores(questions, responses);

      const contentQualityScore = Math.round(weightedSum * 10) / 10;

      // Find confidence shift question (scale, included, lowest order)
      const confidenceQ = questions
        .filter((q) => q.type === 'scale' && q.includedInScore)
        .sort((a, b) => a.order - b.order)[0];
      const confidenceRaw = confidenceQ ? Number(responses[confidenceQ.id]) : null;
      const confidenceDelta =
        confidenceRaw !== null && !isNaN(confidenceRaw)
          ? Math.round((confidenceRaw - submission.warmupMappedScore) * 100) / 100
          : null;

      const now = new Date().toISOString();

      // Build snapshot of question state at submission time
      const questionsSnapshot = questions.map((q) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        touchpoint: q.touchpoint,
        weight: q.weight,
        includedInScore: q.includedInScore,
        isOptional: q.isOptional,
        options: q.options ?? [],
        scaleMin: q.scaleMin ?? null,
        scaleMax: q.scaleMax ?? null,
      }));

      // Update submission and scores/documentId atomically
      await db.runTransaction(async (tx) => {
        // Update submission to complete
        const submissionUpdate = {
          status: 'complete',
          responses: normalisedResponses,
          scores: questionScores,
          contentQualityScore,
          confidenceDelta,
          difficultyFit,
          questionsSnapshot,
          submittedAt: FieldValue.serverTimestamp(),
          formVersion: now,
        };
        if (typeof reviewDuration === 'number' && reviewDuration >= 0) {
          submissionUpdate.reviewDuration = Math.round(reviewDuration);
        }
        tx.update(submissionRef, submissionUpdate);

        // Update aggregate scores document
        const scoresRef = db.collection('scores').doc(submission.documentId);
        const scoresSnap = await tx.get(scoresRef);

        if (!scoresSnap.exists) {
          const bucket = getDistributionBucket(contentQualityScore);
          tx.set(scoresRef, {
            documentId: submission.documentId,
            averageQualityScore: contentQualityScore,
            averageConfidenceDelta: confidenceDelta ?? 0,
            totalSubmissions: 1,
            scoreDistribution: { excellent: 0, good: 0, needsWork: 0, rethink: 0, [bucket]: 1 },
            lastUpdated: FieldValue.serverTimestamp(),
          });
        } else {
          const s = scoresSnap.data();
          const n = s.totalSubmissions;
          const newAvgQuality = (s.averageQualityScore * n + contentQualityScore) / (n + 1);
          const newAvgDelta =
            confidenceDelta !== null
              ? (s.averageConfidenceDelta * n + confidenceDelta) / (n + 1)
              : s.averageConfidenceDelta;
          const bucket = getDistributionBucket(contentQualityScore);
          const dist = { ...s.scoreDistribution };
          dist[bucket] = (dist[bucket] ?? 0) + 1;

          tx.update(scoresRef, {
            averageQualityScore: Math.round(newAvgQuality * 10) / 10,
            averageConfidenceDelta: Math.round(newAvgDelta * 100) / 100,
            totalSubmissions: n + 1,
            scoreDistribution: dist,
            lastUpdated: FieldValue.serverTimestamp(),
          });
        }
      });

      const interpretation = getInterpretation(contentQualityScore);
      return res.json({
        ok: true,
        submissionId,
        contentQualityScore,
        confidenceDelta,
        interpretation,
        status: 'complete',
      });
    } catch (e) {
      console.error('[api/submissions PATCH]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
