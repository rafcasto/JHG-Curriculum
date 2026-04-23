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

export async function saveDocument(id, content, token) {
  const res = await fetch(`/api/file?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }
  return res.json();
}

/** Create a new .md file in the specified Drive folder. Returns { id, name }.
 * @param {string} name - File name (without .md extension)
 * @param {string} folderId - Target Drive folder id
 * @param {{ tag?: string, categories?: string[], token: string }} opts
 */
export async function createDocument(name, folderId, { tag, categories, token } = {}) {
  const res = await fetch(`/api/file?folderId=${encodeURIComponent(folderId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ name, tag, categories }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Create failed (${res.status})`);
  }
  return res.json();
}

/** Rename a .md file in Drive. Returns { id, name }. */
export async function renameDocument(id, newName, token) {
  const res = await fetch(`/api/file?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Rename failed (${res.status})`);
  }
  return res.json();
}

/** Move a .md file to the Drive trash. */
export async function deleteDocument(id, token) {
  const res = await fetch(`/api/file?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Delete failed (${res.status})`);
  }
  return res.json();
}
