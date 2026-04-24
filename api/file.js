/**
 * GET    /api/file?id=<driveFileId>              — read file content + parsed front matter
 * PUT    /api/file?id=<driveFileId>              — write new content (plain .md files only)
 * POST   /api/file?folderId=<driveFolderId>      — create new .md file  { name: string }
 * DELETE /api/file?id=<driveFileId>              — move file to trash
 *
 * Google Docs are exported as plain text (read-only from this app).
 */

import { google } from 'googleapis';
import matter from 'gray-matter';
import { basename } from 'path';
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

getApps().length === 0 ? initializeApp({ credential: cert(serviceAccount) }) : getApp();

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

async function requireWriteAccess(req) {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw Object.assign(new Error('Authorization required'), { status: 401 });
  const claims = await verifyTokenClaims(token);
  if (claims.role === 'reviewer') {
    throw Object.assign(new Error('Reviewers cannot modify files'), { status: 403 });
  }
  return claims;
}

const driveAuth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth: driveAuth });

/** Download the plain-text content of any supported Drive file. */
async function downloadContent(fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'text' }
    );
    return String(res.data);
  }
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );
  return String(res.data);
}

export default async function handler(req, res) {
  // ── POST: create new .md file (uses ?folderId, not ?id) ───────────────────
  if (req.method === 'POST') {
    try { await requireWriteAccess(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }
    const { folderId } = req.query;
    const { name, tag, categories } = req.body ?? {};
    if (!folderId) return res.status(400).json({ error: 'Missing ?folderId parameter' });
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Request body must include { name: string }' });
    }

    const safeName = name.trim().replace(/[\/\\]/g, '').replace(/\.md$/i, '') + '.md';
    const fileTitle = safeName.replace(/\.md$/i, '');

    // Build YAML frontmatter if tag or categories are provided
    let frontmatterBlock = '';
    if (tag || (Array.isArray(categories) && categories.length > 0)) {
      const lines = ['---'];
      if (tag) {
        lines.push('tags:');
        lines.push(`  - ${tag}`);
      }
      if (Array.isArray(categories) && categories.length > 0) {
        lines.push('category:');
        categories.forEach((c) => lines.push(`  - ${c}`));
      }
      lines.push('---');
      frontmatterBlock = lines.join('\n') + '\n';
    }

    try {
      const created = await drive.files.create({
        supportsAllDrives: true,
        requestBody: { name: safeName, mimeType: 'text/plain', parents: [folderId] },
        media: { mimeType: 'text/plain', body: `${frontmatterBlock}# ${fileTitle}\n` },
        fields: 'id, name',
      });

      return res.status(201).json({ id: created.data.id, name: created.data.name });
    } catch (err) {
      console.error('[api/file POST]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH: rename file ─────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    try { await requireWriteAccess(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }
    const { id: patchId } = req.query;
    if (!patchId) return res.status(400).json({ error: 'Missing ?id parameter' });
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Request body must include { name: string }' });
    }
    const safeName = name.trim().replace(/[\/\\]/g, '').replace(/\.md$/i, '') + '.md';
    try {
      const meta = await drive.files.get({ fileId: patchId, fields: 'mimeType', supportsAllDrives: true });
      if (meta.data.mimeType === 'application/vnd.google-apps.document') {
        return res.status(400).json({ error: 'Google Docs cannot be renamed from this app' });
      }
      const updated = await drive.files.update({
        fileId: patchId,
        supportsAllDrives: true,
        fields: 'id, name',
        requestBody: { name: safeName },
      });

      // Sync updated title into any matching Firestore documents records
      const newTitle = safeName.replace(/\.md$/i, '');
      try {
        const fsdb = getFirestore();
        const snap = await fsdb.collection('documents').where('driveFileId', '==', patchId).get();
        if (!snap.empty) {
          await Promise.all(snap.docs.map((d) => d.ref.update({ title: newTitle })));
        }
      } catch (fsErr) {
        console.warn('[api/file PATCH] Firestore title sync failed:', fsErr.message);
      }

      return res.json({ id: updated.data.id, name: updated.data.name });
    } catch (err) {
      console.error('[api/file PATCH]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });

  // ── GET: read ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const meta = await drive.files.get({
        fileId: id,
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });

      const raw = await downloadContent(id, meta.data.mimeType);
      const { data: fm } = matter(raw);

      return res.json({
        id,
        title: fm.title || basename(meta.data.name, '.md'),
        content: raw,
        mimeType: meta.data.mimeType,
        readOnly: meta.data.mimeType === 'application/vnd.google-apps.document',
        frontMatter: {
          week:     fm.week     ?? null,
          type:     fm.type     ?? null,
          tags:     fm.tags     ?? [],
          category: fm.category ?? null,
          source:   fm.source   ?? null,
          created:  fm.created  ?? null,
        },
      });
    } catch (err) {
      console.error('[api/file GET]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT: write ─────────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    try { await requireWriteAccess(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }
    try {
      const { content } = req.body ?? {};
      if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Request body must include { content: string }' });
      }

      // Refuse writes to Google Docs (they can't be overwritten as plain text)
      const meta = await drive.files.get({ fileId: id, fields: 'mimeType', supportsAllDrives: true });
      if (meta.data.mimeType === 'application/vnd.google-apps.document') {
        return res.status(400).json({ error: 'Google Docs are read-only in this app' });
      }

      await drive.files.update({
        fileId: id,
        supportsAllDrives: true,
        requestBody: { mimeType: 'text/plain' },
        media: { mimeType: 'text/plain', body: content },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[api/file PUT]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: move file to trash ─────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try { await requireWriteAccess(req); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }
    if (!id) return res.status(400).json({ error: 'Missing ?id parameter' });
    try {
      // Refuse trashing Google Docs
      const meta = await drive.files.get({ fileId: id, fields: 'mimeType', supportsAllDrives: true });
      if (meta.data.mimeType === 'application/vnd.google-apps.document') {
        return res.status(400).json({ error: 'Google Docs cannot be deleted from this app' });
      }

      await drive.files.update({
        fileId: id,
        supportsAllDrives: true,
        requestBody: { trashed: true },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[api/file DELETE]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
