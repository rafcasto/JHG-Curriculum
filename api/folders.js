/**
 * GET /api/folders — list direct subfolders under the root Drive folder
 * Returns: [{ id, name }] sorted by name, with root folder as first entry.
 */

import { google } from 'googleapis';

const driveAuth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth: driveAuth });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ?id=<folderId> — look up a single folder's name
  const lookupId = req.query?.id;
  if (lookupId) {
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(lookupId)) {
      return res.status(400).json({ error: 'Invalid folder id' });
    }
    try {
      const file = await drive.files.get({
        fileId: lookupId,
        fields: 'id, name',
        supportsAllDrives: true,
      });
      return res.json({ id: file.data.id, name: file.data.name });
    } catch (e) {
      console.error('[api/folders lookup]', e.message);
      return res.status(404).json({ error: 'Folder not found' });
    }
  }

  // Optional ?folderId= overrides the env root (workspace-scoped listing)
  const queryFolder = req.query?.folderId;
  if (queryFolder !== undefined && !/^[a-zA-Z0-9_-]{10,}$/.test(queryFolder)) {
    return res.status(400).json({ error: 'Invalid folderId' });
  }

  const folderId = queryFolder || process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID not configured' });
  }

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const subfolders = (response.data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
    }));

    return res.json([{ id: folderId, name: '/ Root' }, ...subfolders]);
  } catch (e) {
    console.error('[api/folders GET]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
