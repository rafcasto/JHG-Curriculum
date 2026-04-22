import { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './EarlyAccessManager.css';

const STATUS_LABELS = {
  early_access: 'Early Access',
  published: 'Published',
};

function DocumentForm({ workspaceId, driveFiles, initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() => {
    if (initial) {
      return {
        driveFileId: initial.driveFileId ?? '',
        title: initial.title ?? '',
        description: initial.description ?? '',
        category: initial.category ?? '',
        version: initial.version ?? '1.0',
        status: initial.status ?? 'early_access',
      };
    }
    return { driveFileId: '', title: '', description: '', category: '', version: '1.0', status: 'early_access' };
  });

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  function handleDriveFileChange(driveFileId) {
    set('driveFileId', driveFileId);
    if (!form.title) {
      const file = driveFiles.find((f) => f.id === driveFileId);
      if (file) set('title', file.title ?? file.name ?? '');
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave({ ...form, workspaceId });
  }

  return (
    <form className="ea-form" onSubmit={handleSubmit}>
      {!initial && (
        <div className="ea-form-field">
          <label className="ea-label">Drive file</label>
          <select
            className="ea-input"
            value={form.driveFileId}
            onChange={(e) => handleDriveFileChange(e.target.value)}
            required
          >
            <option value="">— Select a file —</option>
            {driveFiles.map((f) => (
              <option key={f.id} value={f.id}>{f.title ?? f.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="ea-form-row">
        <div className="ea-form-field ea-form-field--flex">
          <label className="ea-label">Title</label>
          <input className="ea-input" value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </div>
        <div className="ea-form-field">
          <label className="ea-label">Version</label>
          <input className="ea-input ea-input--sm" value={form.version} onChange={(e) => set('version', e.target.value)} />
        </div>
        {initial && (
          <div className="ea-form-field">
            <label className="ea-label">Status</label>
            <select className="ea-input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="early_access">Early Access</option>
              <option value="published">Published</option>
            </select>
          </div>
        )}
      </div>

      <div className="ea-form-field">
        <label className="ea-label">Category</label>
        <input className="ea-input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Lesson, Homework" />
      </div>

      <div className="ea-form-field">
        <label className="ea-label">Description</label>
        <textarea className="ea-input ea-textarea" value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="What will the reviewer learn?" />
      </div>

      <div className="ea-form-actions">
        <button className="admin-btn admin-btn--primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Update' : 'Add to Early Access'}
        </button>
        <button className="admin-btn admin-btn--secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function EarlyAccessManager({ getToken }) {
  const { currentWorkspace } = useWorkspace();
  const [documents, setDocuments] = useState([]);
  const [scores, setScores] = useState({}); // docId -> score data
  const [driveFiles, setDriveFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);

  const workspaceId = currentWorkspace?.id ?? null;

  const fetchDocuments = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/documents?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      const docs = await res.json();
      setDocuments(docs);

      // Fetch scores for each document
      const scoreResults = await Promise.allSettled(
        docs.map(async (doc) => {
          const sr = await fetch(`/api/scores?documentId=${encodeURIComponent(doc.driveFileId)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const sd = await sr.json();
          return { docId: doc.driveFileId, data: sd };
        })
      );
      const scoreMap = {};
      for (const r of scoreResults) {
        if (r.status === 'fulfilled') scoreMap[r.value.docId] = r.value.data;
      }
      setScores(scoreMap);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, getToken]);

  // Fetch Drive files for the add-document form
  const fetchDriveFiles = useCallback(async () => {
    if (!currentWorkspace?.driveFolderId) return;
    try {
      const res = await fetch(`/api/files?folderId=${encodeURIComponent(currentWorkspace.driveFolderId)}`);
      if (res.ok) setDriveFiles(await res.json());
    } catch {
      // non-critical
    }
  }, [currentWorkspace]);

  useEffect(() => {
    fetchDocuments();
    fetchDriveFiles();
  }, [fetchDocuments, fetchDriveFiles]);

  async function handleSave(payload) {
    setSaving(true);
    try {
      const token = await getToken();
      const isEdit = !!editingDoc;
      const url = isEdit ? `/api/documents?id=${encodeURIComponent(editingDoc.id)}` : '/api/documents';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      setShowForm(false);
      setEditingDoc(null);
      await fetchDocuments();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(doc) {
    if (!window.confirm(`Remove "${doc.title}" from Early Access? Historical submissions are preserved.`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/documents?id=${encodeURIComponent(doc.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e) {
      setError(e.message);
    }
  }

  if (!workspaceId) {
    return (
      <section className="admin-section">
        <h2 className="admin-section-title">Early Access</h2>
        <p className="admin-empty-msg">Select a workspace to manage early-access documents.</p>
      </section>
    );
  }

  return (
    <section className="admin-section">
      <div className="ea-header">
        <h2 className="admin-section-title" style={{ margin: 0 }}>
          Early Access — {currentWorkspace?.name}
        </h2>
        <button className="admin-btn admin-btn--primary" onClick={() => { setEditingDoc(null); setShowForm(true); }}>
          + Add document
        </button>
      </div>

      {error && <p className="admin-form-error" style={{ marginTop: '0.75rem' }}>{error}</p>}

      {showForm && (
        <div className="ea-form-wrap">
          <h3 className="ea-form-title">{editingDoc ? 'Edit document' : 'Add to Early Access'}</h3>
          <DocumentForm
            workspaceId={workspaceId}
            driveFiles={driveFiles}
            initial={editingDoc}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingDoc(null); }}
            saving={saving}
          />
        </div>
      )}

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : documents.length === 0 ? (
        <p className="admin-empty-msg">No early-access documents for this workspace yet.</p>
      ) : (
        <div className="ea-list">
          {documents.map((doc) => {
            const s = scores[doc.driveFileId];
            return (
              <div key={doc.id} className="ea-card">
                <div className="ea-card-info">
                  <span className="ea-card-title">{doc.title}</span>
                  <div className="ea-card-meta">
                    {doc.category && <span className="ea-badge ea-badge--category">{doc.category}</span>}
                    <span className={`ea-badge ea-badge--status ea-badge--${doc.status}`}>
                      {STATUS_LABELS[doc.status] ?? doc.status}
                    </span>
                    <span className="ea-badge ea-badge--version">v{doc.version}</span>
                    {s && (
                      <span className="ea-badge ea-badge--score">
                        {s.totalSubmissions} submission{s.totalSubmissions !== 1 ? 's' : ''}
                        {s.averageQualityScore != null && ` · avg ${s.averageQualityScore}`}
                      </span>
                    )}
                  </div>
                  {doc.description && <p className="ea-card-desc">{doc.description}</p>}
                </div>
                <div className="ea-card-actions">
                  <button
                    className="admin-btn admin-btn--secondary"
                    onClick={() => { setEditingDoc(doc); setShowForm(true); }}
                  >
                    Edit
                  </button>
                  <button
                    className="admin-btn admin-btn--danger"
                    onClick={() => handleDelete(doc)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
