import { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './EarlyAccessManager.css';

const STATUS_LABELS = {
  early_access: 'Early Access',
  published: 'Published',
};

function DocumentForm({ workspaceId, initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() => ({
    driveFileId: initial.driveFileId ?? '',
    title: initial.title ?? '',
    description: initial.description ?? '',
    category: initial.category ?? '',
    version: initial.version ?? '1.0',
    status: initial.status ?? 'early_access',
  }));

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  function handleSubmit(e) {
    e.preventDefault();
    onSave({ ...form, workspaceId });
  }

  return (
    <form className="ea-form" onSubmit={handleSubmit}>
      <div className="ea-form-row">
        <div className="ea-form-field ea-form-field--flex">
          <label className="ea-label">Title</label>
          <input className="ea-input" value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </div>
        <div className="ea-form-field">
          <label className="ea-label">Version</label>
          <input className="ea-input ea-input--sm" value={form.version} onChange={(e) => set('version', e.target.value)} />
        </div>
        <div className="ea-form-field">
          <label className="ea-label">Status</label>
          <select className="ea-input" value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="early_access">Early Access</option>
            <option value="published">Published</option>
          </select>
        </div>
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
          {saving ? 'Saving…' : 'Update'}
        </button>
        <button className="admin-btn admin-btn--secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function EarlyAccessManager({ getToken }) {
  const { currentWorkspace, refreshWorkspaces } = useWorkspace();
  const [documents, setDocuments] = useState([]);
  const [scores, setScores] = useState({});
  const [driveFiles, setDriveFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);

  // Left-panel state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [leftSearch, setLeftSearch] = useState('');
  const [adding, setAdding] = useState(false);

  // Instruction file state
  const [instructionFileId, setInstructionFileId] = useState('');
  const [savingInstruction, setSavingInstruction] = useState(false);

  const workspaceId = currentWorkspace?.id ?? null;

  // Sync instruction file field from workspace
  useEffect(() => {
    setInstructionFileId(currentWorkspace?.instructionFileId ?? '');
  }, [currentWorkspace]);

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

  // Left panel: Drive files not yet assigned to early access, filtered by search
  const assignedIds = new Set(documents.map((d) => d.driveFileId));
  const availableFiles = driveFiles.filter((f) => {
    if (assignedIds.has(f.id)) return false;
    const q = leftSearch.trim().toLowerCase();
    if (!q) return true;
    return (f.title ?? f.name ?? '').toLowerCase().includes(q);
  });

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === availableFiles.length && availableFiles.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(availableFiles.map((f) => f.id)));
    }
  }

  async function handleBulkAdd() {
    if (selectedIds.size === 0) return;
    setAdding(true);
    setError(null);
    try {
      const token = await getToken();
      const toAdd = driveFiles.filter((f) => selectedIds.has(f.id));
      const results = await Promise.all(
        toAdd.map((f) =>
          fetch('/api/documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              driveFileId: f.id,
              title: f.title ?? f.name ?? f.id,
              description: '',
              category: '',
              version: '1.0',
              workspaceId,
            }),
          })
        )
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) throw new Error(`${failed.length} file(s) failed to add`);
      setSelectedIds(new Set());
      await fetchDocuments();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleSave(payload) {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/documents?id=${encodeURIComponent(editingDoc.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
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

  async function handleSaveInstruction() {
    if (!workspaceId) return;
    setSavingInstruction(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(workspaceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ instructionFileId: instructionFileId || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save instruction file');
      await refreshWorkspaces();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingInstruction(false);
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

  const allSelected = availableFiles.length > 0 && selectedIds.size === availableFiles.length;
  const instructionFileName = instructionFileId
    ? (driveFiles.find((f) => f.id === instructionFileId)?.title ?? driveFiles.find((f) => f.id === instructionFileId)?.name ?? instructionFileId)
    : null;

  return (
    <section className="admin-section">
      <div className="ea-header">
        <h2 className="admin-section-title" style={{ margin: 0 }}>
          Early Access — {currentWorkspace?.name}
        </h2>
      </div>

      {error && <p className="admin-form-error" style={{ marginTop: '0.75rem' }}>{error}</p>}

      {/* ── Dual panel ─────────────────────────────────────────────────── */}
      <div className="ea-panels">
        {/* Left: available Drive files */}
        <div className="ea-panel">
          <div className="ea-panel-header">
            <span className="ea-panel-title">Available files</span>
            <span className="ea-panel-count">{availableFiles.length}</span>
          </div>
          <input
            className="ea-input ea-panel-search"
            placeholder="Search files…"
            value={leftSearch}
            onChange={(e) => setLeftSearch(e.target.value)}
          />
          <div className="ea-file-list">
            {availableFiles.length === 0 ? (
              <p className="ea-panel-empty">{leftSearch ? 'No matches.' : 'All files already added.'}</p>
            ) : (
              <>
                <label className="ea-file-row ea-file-row--select-all">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                  <span className="ea-file-row-name">Select all</span>
                </label>
                {availableFiles.map((f) => (
                  <label key={f.id} className="ea-file-row">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(f.id)}
                      onChange={() => toggleSelect(f.id)}
                    />
                    <span className="ea-file-row-name">{f.title ?? f.name}</span>
                  </label>
                ))}
              </>
            )}
          </div>
          <div className="ea-panel-footer">
            <button
              className="admin-btn admin-btn--primary"
              onClick={handleBulkAdd}
              disabled={selectedIds.size === 0 || adding}
            >
              {adding ? 'Adding…' : `→ Add selected${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
            </button>
          </div>
        </div>

        {/* Right: early access documents */}
        <div className="ea-panel">
          <div className="ea-panel-header">
            <span className="ea-panel-title">Early Access</span>
            <span className="ea-panel-count">{documents.length}</span>
          </div>
          {loading ? (
            <div className="admin-loading" style={{ padding: '1.5rem' }}><div className="spinner" /></div>
          ) : documents.length === 0 ? (
            <p className="ea-panel-empty" style={{ padding: '1rem' }}>No documents added yet. Select files on the left and click Add.</p>
          ) : (
            <div className="ea-right-list">
              {editingDoc && (
                <div className="ea-form-wrap">
                  <h3 className="ea-form-title">Edit — {editingDoc.title}</h3>
                  <DocumentForm
                    workspaceId={workspaceId}
                    initial={editingDoc}
                    onSave={handleSave}
                    onCancel={() => setEditingDoc(null)}
                    saving={saving}
                  />
                </div>
              )}
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
                        onClick={() => setEditingDoc(editingDoc?.id === doc.id ? null : doc)}
                      >
                        {editingDoc?.id === doc.id ? 'Close' : 'Edit'}
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
        </div>
      </div>

      {/* ── Instruction file ───────────────────────────────────────────── */}
      <div className="ea-instruction-card">
        <div className="ea-instruction-header">
          <span className="ea-instruction-title">Instruction file</span>
          <p className="ea-instruction-desc">
            This file is shown to reviewers on the landing page instead of the default table of contents. It will not be reviewed.
          </p>
        </div>
        <div className="ea-instruction-row">
          <select
            className="ea-input ea-instruction-select"
            value={instructionFileId}
            onChange={(e) => setInstructionFileId(e.target.value)}
          >
            <option value="">— None (show table of contents) —</option>
            {driveFiles.map((f) => (
              <option key={f.id} value={f.id}>{f.title ?? f.name}</option>
            ))}
          </select>
          <button
            className="admin-btn admin-btn--primary"
            onClick={handleSaveInstruction}
            disabled={savingInstruction}
          >
            {savingInstruction ? 'Saving…' : 'Save'}
          </button>
          {instructionFileId && (
            <button
              className="admin-btn admin-btn--secondary"
              onClick={() => setInstructionFileId('')}
              disabled={savingInstruction}
            >
              Clear
            </button>
          )}
        </div>
        {instructionFileName && (
          <p className="ea-instruction-current">
            Currently set: <strong>{instructionFileName}</strong>
          </p>
        )}
      </div>
    </section>
  );
}
