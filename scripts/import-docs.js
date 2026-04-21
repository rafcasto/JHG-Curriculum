/**
 * scripts/import-docs.js
 *
 * Reads all .md files and Google Docs recursively from a Google Drive folder
 * and imports them into Firestore under the `documents` collection.
 *
 * Prerequisites:
 *   1. Enable the Google Drive API in your GCP project:
 *      https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=jhg-academy
 *   2. Share the Drive folder with the service-account email:
 *      firebase-adminsdk-fbsvc@jhg-academy.iam.gserviceaccount.com
 *
 * Run:
 *   npm run import-docs
 */

import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { basename } from 'path';
import matter from 'gray-matter';

// ── Validate required env ────────────────────────────────────────────────────
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
if (!FOLDER_ID) {
  console.error('ERROR: GOOGLE_DRIVE_FOLDER_ID is not set in .env');
  process.exit(1);
}

// ── Firebase Admin ───────────────────────────────────────────────────────────
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

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// ── Google Drive client (service-account auth) ───────────────────────────────
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a filename to a URL-safe Firestore document ID */
function toSlug(name) {
  return name
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Extract [[wiki-links]] from markdown content */
function extractLinks(content) {
  const RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links = new Set();
  let m;
  while ((m = RE.exec(content)) !== null) {
    links.add(toSlug(m[1].trim()));
  }
  return [...links];
}

/** List direct children of a Drive folder (handles pagination) */
async function listFolder(folderId) {
  const items = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 1000,
      pageToken,
    });
    items.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

/** Recursively walk a Drive folder; returns array of { id, name, mimeType, path } */
async function walkDrive(folderId, pathPrefix = '') {
  const items = await listFolder(folderId);
  const results = [];
  for (const item of items) {
    const itemPath = pathPrefix ? `${pathPrefix}/${item.name}` : item.name;
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      results.push(...await walkDrive(item.id, itemPath));
    } else if (
      item.name.toLowerCase().endsWith('.md') ||
      item.mimeType === 'application/vnd.google-apps.document'
    ) {
      results.push({ ...item, path: itemPath });
    }
  }
  return results;
}

/** Download file content as plain text */
async function downloadContent(file) {
  if (file.mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: 'text/plain' },
      { responseType: 'text' }
    );
    return String(res.data);
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: 'media' },
    { responseType: 'text' }
  );
  return String(res.data);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Scanning Google Drive folder: ${FOLDER_ID}`);
  const files = await walkDrive(FOLDER_ID);
  console.log(`Found ${files.length} importable file(s)\n`);

  if (files.length === 0) {
    console.warn(
      'No files found.\n' +
      'Make sure the service account has been granted access to the folder:\n' +
      `  ${process.env.GOOGLE_CLIENT_EMAIL}`
    );
    process.exit(0);
  }

  // Firestore has a 500-write batch limit — chunk in groups of 400
  const CHUNK = 400;
  let total = 0;

  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = files.slice(i, i + CHUNK);
    const batch = db.batch();

    for (const file of chunk) {
      let raw;
      try {
        raw = await downloadContent(file);
      } catch (err) {
        console.warn(`  SKIP ${file.path}: ${err.message}`);
        continue;
      }

      const { data: frontMatter, content } = matter(raw);
      const slug = toSlug(file.name);
      const outgoingLinks = extractLinks(content);

      const docRef = db.collection('documents').doc(slug);
      batch.set(docRef, {
        slug,
        title: frontMatter.title || basename(file.name, '.md'),
        path: file.path,
        driveFileId: file.id,
        content: raw,
        frontMatter: {
          week:     frontMatter.week     ?? null,
          type:     frontMatter.type     ?? null,
          tags:     frontMatter.tags     ?? [],
          category: frontMatter.category ?? null,
          source:   frontMatter.source   ?? null,
          created:  frontMatter.created  ?? null,
        },
        outgoingLinks,
        updatedAt: new Date(),
        updatedBy: 'import-script',
      }, { merge: false });

      console.log(`  + ${file.path}`);
      total++;
    }

    await batch.commit();
  }

  console.log(`\n✓ Imported ${total} document(s) into Firestore`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  if (err.message.includes('has not been used') || err.message.includes('disabled')) {
    console.error(
      '\nFix: Enable the Google Drive API at:\n' +
      'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=jhg-academy'
    );
  }
  if (err.message.includes('insufficientPermissions') || err.message.includes('forbidden')) {
    console.error(
      '\nFix: Share the Drive folder with the service account:\n' +
      `  ${process.env.GOOGLE_CLIENT_EMAIL}`
    );
  }
  process.exit(1);
});
