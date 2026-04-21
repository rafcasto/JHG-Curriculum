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

      await drive.files.update(
        { fileId: id, supportsAllDrives: true },
        { requestBody: { mimeType: 'text/plain' }, media: { mimeType: 'text/plain', body: content } }
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error('[api/file PUT]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: create new .md file ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { folderId } = req.query;
    const { name } = req.body ?? {};
    if (!folderId) return res.status(400).json({ error: 'Missing ?folderId parameter' });
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Request body must include { name: string }' });
    }

    // Sanitise: strip any path separators and ensure .md extension
    const safeName = name.trim().replace(/[/\\]/g, '').replace(/\.md$/i, '') + '.md';

    try {
      const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
      // Only allow creating files inside the configured Drive folder tree
      if (folderId !== rootFolderId) {
        // Verify the target folder is a child of the root folder
        const folderMeta = await drive.files.get({
          fileId: folderId,
          fields: 'parents',
          supportsAllDrives: true,
        });
        const parents = folderMeta.data.parents ?? [];
        if (!parents.includes(rootFolderId)) {
          return res.status(403).json({ error: 'Target folder is outside the allowed Drive tree' });
        }
      }

      const created = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: safeName,
          mimeType: 'text/plain',
          parents: [folderId],
        },
        media: {
          mimeType: 'text/plain',
          body: `# ${safeName.replace('.md', '')}\n`,
        },
        fields: 'id, name',
      });

      return res.status(201).json({ id: created.data.id, name: created.data.name });
    } catch (err) {
      console.error('[api/file POST]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: move file to trash ─────────────────────────────────────────────
  if (req.method === 'DELETE') {
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
