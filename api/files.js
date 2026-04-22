/**
 * GET /api/files
 * Returns the full recursive file tree from the configured Google Drive folder.
 * Each entry: { id, title, path, mimeType }
 *
 * Runs server-side on Vercel — the service-account key never reaches the browser.
 */

import { google } from 'googleapis';

const driveAuth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth: driveAuth });

/** List direct children of a Drive folder (handles pagination, Shared Drives). */
async function listFolder(folderId) {
  const items = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      orderBy: 'name',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    items.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

/** Recursively walk a Drive folder; returns flat array of file metadata. */
async function walkDrive(folderId, pathPrefix = '') {
  const items = await listFolder(folderId);
  const results = [];
  for (const item of items) {
    const itemPath = pathPrefix ? `${pathPrefix}/${item.name}` : item.name;
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      results.push(...(await walkDrive(item.id, itemPath)));
    } else if (
      item.name.toLowerCase().endsWith('.md') ||
      item.mimeType === 'application/vnd.google-apps.document'
    ) {
      results.push({
        id: item.id,
        title: item.name.replace(/\.md$/i, ''),
        path: itemPath,
        mimeType: item.mimeType,
      });
    }
  }
  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Accept a workspace-scoped folderId from the query string; validate its format.
  const queryFolder = req.query?.folderId;
  if (queryFolder !== undefined && !/^[a-zA-Z0-9_-]{10,}$/.test(queryFolder)) {
    return res.status(400).json({ error: 'Invalid folderId' });
  }
  const folderId = queryFolder || process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID not configured' });
  }

  try {
    const files = await walkDrive(folderId);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.json(files);
  } catch (err) {
    console.error('[api/files]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
