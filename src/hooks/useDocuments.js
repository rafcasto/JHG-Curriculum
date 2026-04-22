/**
 * Document access via Vercel serverless API routes which proxy Google Drive.
 * The service-account credentials live only server-side (api/files.js, api/file.js).
 */

export async function fetchAllDocuments(folderId) {
  const url = folderId
    ? `/api/files?folderId=${encodeURIComponent(folderId)}`
    : '/api/files';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to list documents (${res.status})`);
  return res.json();
}

export async function fetchDocument(id) {
  const res = await fetch(`/api/file?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
  return res.json();
}

/** uid is accepted but unused — Drive tracks edits via the service account. */
export async function saveDocument(id, content, _uid) {
  const res = await fetch(`/api/file?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }
  return res.json();
}

/** Create a new .md file in the specified Drive folder. Returns { id, name }. */
export async function createDocument(name, folderId) {
  const res = await fetch(`/api/file?folderId=${encodeURIComponent(folderId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Create failed (${res.status})`);
  }
  return res.json();
}

/** Move a .md file to the Drive trash. */
export async function deleteDocument(id) {
  const res = await fetch(`/api/file?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Delete failed (${res.status})`);
  }
  return res.json();
}
