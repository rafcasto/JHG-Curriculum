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

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
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
