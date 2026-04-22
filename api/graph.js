/**
 * GET /api/graph
 *
 * Downloads every file from the Drive folder, extracts [[wiki-links]],
 * and returns a graph payload:
 *   { nodes: [...], links: [...] }
 *
 * Node shape:  { id, title, path, type, module }
 * Link shape:  { source: nodeId, target: nodeId }
 *
 * Cached in-process for 5 minutes so repeated navigations are fast.
 */

import { google } from 'googleapis';

const driveAuth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth: driveAuth });

// ── In-process cache — keyed per folderId ──────────────────────────────────
const cacheMap = new Map(); // folderId → { graph, time }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferModule(path) {
  if (!path || !path.includes('/')) return 'other';
  return path.split('/')[0];
}

function inferType(title, path) {
  const name = `${title} ${path}`.toLowerCase();
  if (name.includes('roadmap'))  return 'roadmap';
  if (name.includes('toolkit'))  return 'toolkit';
  if (name.includes('analysis')) return 'analysis';
  if (name.includes('prompt'))   return 'toolkit';
  return 'lesson';
}

function inferModuleFromTag() {
  return 'other';
}

/**
 * Extract [[wiki-links]] from markdown content.
 * Handles [[Title]], [[Title|Alias]], [[Title#Heading]]
 * Returns an array of raw title strings (the part before | or #).
 */
function extractWikiLinks(content) {
  const titles = [];
  // Strip frontmatter first so we don't pick up links inside YAML
  const body = content.replace(/^---[\s\S]*?---\n?/, '');
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const t = m[1].trim();
    if (t) titles.push(t);
  }
  return titles;
}

/**
 * Parse YAML frontmatter and return:
 *   moduleTags  — all "Module/X-Name" tags  (used for graph linkages)
 *   categories  — all "category" values       (used for UI filtering)
 *
 * Handles scalar and list YAML values:
 *   tags:
 *     - Module/1-Goal
 *   category: Lesson/Text
 *   category:
 *     - Homework/1-Exercise-Instructions
 *     - Homework/3-AI-Prompt
 */
function extractFrontmatterData(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { moduleTags: [], categories: [] };

  const fm = fmMatch[1];

  // Extract Module/* tags
  const moduleTags = [];
  const tagsBlock = fm.match(/^tags:\n((?:[ \t]+-[ \t]+.+\n?)*)/m);
  if (tagsBlock) {
    for (const line of tagsBlock[1].split('\n')) {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m && m[1].trim().startsWith('Module/')) moduleTags.push(m[1].trim());
    }
  }

  // Extract categories (list or scalar)
  const categories = [];
  const catListBlock = fm.match(/^category:\n((?:[ \t]+-[ \t]+.+\n?)*)/m);
  if (catListBlock) {
    for (const line of catListBlock[1].split('\n')) {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m) categories.push(m[1].trim());
    }
  } else {
    const catInline = fm.match(/^category:\s+(.+)$/m);
    if (catInline) categories.push(catInline[1].trim());
  }

  return { moduleTags, categories };
}

/** List direct children of a folder (handles pagination + Shared Drives) */
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

/** Recursively collect all importable files with their paths */
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
      results.push({ id: item.id, name: item.name, mimeType: item.mimeType, path: itemPath });
    }
  }
  return results;
}

/** Download file as plain text */
async function downloadText(fileId, mimeType) {
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

// ── Build graph data ──────────────────────────────────────────────────────────
async function buildGraph(folderId) {
  const files = await walkDrive(folderId);

  // Download all content in parallel (batched to avoid rate limits)
  const BATCH = 10;
  const contentMap = new Map(); // id → text
  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(
      files.slice(i, i + BATCH).map(async (f) => {
        try {
          contentMap.set(f.id, await downloadText(f.id, f.mimeType));
        } catch {
          contentMap.set(f.id, '');
        }
      })
    );
  }

  // Build nodes + extract frontmatter data per node
  const nodes = [];
  const nodeModuleTags = new Map(); // id → string[]  (Module/* tags only)
  const nodeWikiLinks  = new Map(); // id → string[]  (raw [[titles]])

  for (const f of files) {
    const title = f.name.replace(/\.md$/i, '');
    const content = contentMap.get(f.id) ?? '';
    const { moduleTags, categories } = extractFrontmatterData(content);
    const wikiLinks = extractWikiLinks(content);

    nodes.push({
      id: f.id,
      title,
      path: f.path,
      type: inferType(title, f.path),
      module: inferModule(f.path),
      categories,          // e.g. ["Lesson/Text"] or ["Homework/3-AI-Prompt"]
      tags: moduleTags.map((t) => t.replace(/^Module\//, '')), // e.g. ["1-Focus", "3-Profile"]
    });

    nodeModuleTags.set(f.id, moduleTags);
    nodeWikiLinks.set(f.id, wikiLinks);
  }

  // title → id index for wiki-link resolution (case-insensitive, first match wins)
  const titleToId = new Map();
  for (const node of nodes) {
    const key = node.title.toLowerCase();
    if (!titleToId.has(key)) titleToId.set(key, node.id);
  }

  const seen = new Set();
  const links = [];

  // ── Wiki-link edges (directional, type:'wiki') ────────────────────────────
  for (const [sourceId, titles] of nodeWikiLinks) {
    for (const rawTitle of titles) {
      const targetId = titleToId.get(rawTitle.toLowerCase());
      if (!targetId || targetId === sourceId) continue;
      const key = sourceId < targetId ? `${sourceId}→${targetId}` : `${targetId}→${sourceId}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ source: sourceId, target: targetId, type: 'wiki' });
      }
    }
  }

  // ── Module-tag hub nodes + edges ──────────────────────────────────────────
  // Each unique Module/* tag becomes a central hub node; files connect to it
  // instead of pairwise, giving an Obsidian-style tag cluster.
  const moduleIndex = new Map(); // "Module/1-Goal" → Set<nodeId>
  for (const [id, tags] of nodeModuleTags) {
    for (const tag of tags) {
      if (!moduleIndex.has(tag)) moduleIndex.set(tag, new Set());
      moduleIndex.get(tag).add(id);
    }
  }

  for (const [tag, ids] of moduleIndex) {
    const tagNodeId = `tag:${tag}`;
    nodes.push({
      id: tagNodeId,
      title: tag.replace('Module/', ''),
      path: '',
      type: 'tag',
      module: inferModuleFromTag(tag),
      categories: [],
      isTagNode: true,
    });
    for (const fileId of ids) {
      const key = fileId < tagNodeId ? `${fileId}→${tagNodeId}` : `${tagNodeId}→${fileId}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ source: fileId, target: tagNodeId, type: 'tag' });
      }
    }
  }

  return { nodes, links };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Accept workspace-scoped folderId; validate format
  const queryFolder = req.query?.folderId;
  if (queryFolder !== undefined && !/^[a-zA-Z0-9_-]{10,}$/.test(queryFolder)) {
    return res.status(400).json({ error: 'Invalid folderId' });
  }
  const folderId = queryFolder || process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID not configured' });
  }

  const now = Date.now();
  const cached = cacheMap.get(folderId);
  if (cached && now - cached.time < CACHE_TTL) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.graph);
  }

  try {
    const graph = await buildGraph(folderId);
    cacheMap.set(folderId, { graph, time: now });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('X-Cache', 'MISS');
    return res.json(graph);
  } catch (err) {
    console.error('[api/graph]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
