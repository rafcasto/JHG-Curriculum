import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useNavigate } from 'react-router-dom';
import QuestionManager from '../components/QuestionManager';
import EarlyAccessManager from '../components/EarlyAccessManager';
import FeedbackDashboard from '../components/FeedbackDashboard';
import './AdminPage.css';

const ROLES = ['admin', 'editor', 'viewer', 'reviewer'];

// ── Workspace Management Section ────────────────────────────────────────────
function WorkspacesSection({ users, getToken }) {
  const { workspaces, loading: wsLoading, error: wsLoadError, refreshWorkspaces } = useWorkspace();
  const [wsForm, setWsForm] = useState({ name: '', driveFolderId: '' });
  const [wsFormError, setWsFormError] = useState(null);
  const [wsFormLoading, setWsFormLoading] = useState(false);
  const [wsError, setWsError] = useState(null);
  const [expanded, setExpanded] = useState({}); // workspaceId -> boolean
  const [addUserSel, setAddUserSel] = useState({}); // workspaceId -> uid
  const [folderLookupLoading, setFolderLookupLoading] = useState(false);
  const [syncingId, setSyncingId] = useState(null); // workspace id being synced

  // ── Global Catalog ─────────────────────────────────────────────────────────
  const [globalCatalogOpen, setGlobalCatalogOpen] = useState(false);
  const [globalCatalog, setGlobalCatalog] = useState({ tags: [], assetTypes: [] });
  const [gcDraft, setGcDraft] = useState({ tags: [], assetTypes: [] });
  const [gcSaving, setGcSaving] = useState(false);
  const [gcError, setGcError] = useState(null);
  const [gcNewTag, setGcNewTag] = useState({ label: '', value: '' });
  const [gcNewAssetType, setGcNewAssetType] = useState('');

  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .then((data) => {
        setGlobalCatalog(data);
        setGcDraft(data);
      })
      .catch(() => {});
  }, []);

  async function saveGlobalCatalog() {
    setGcSaving(true);
    setGcError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(gcDraft),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      setGlobalCatalog(body);
      setGcDraft(body);
    } catch (e) {
      setGcError(e.message);
    } finally {
      setGcSaving(false);
    }
  }

  function gcAddTag() {
    if (!gcNewTag.label.trim() || !gcNewTag.value.trim()) return;
    setGcDraft((d) => ({ ...d, tags: [...d.tags, { label: gcNewTag.label.trim(), value: gcNewTag.value.trim() }] }));
    setGcNewTag({ label: '', value: '' });
  }

  function gcRemoveTag(idx) {
    setGcDraft((d) => ({ ...d, tags: d.tags.filter((_, i) => i !== idx) }));
  }

  function gcAddAssetType() {
    if (!gcNewAssetType.trim()) return;
    setGcDraft((d) => ({ ...d, assetTypes: [...d.assetTypes, gcNewAssetType.trim()] }));
    setGcNewAssetType('');
  }

  function gcRemoveAssetType(idx) {
    setGcDraft((d) => ({ ...d, assetTypes: d.assetTypes.filter((_, i) => i !== idx) }));
  }

  // ── Per-Workspace Catalog ──────────────────────────────────────────────────
  const [catalogOpen, setCatalogOpen] = useState({}); // wsId -> boolean
  const [catalogDraft, setCatalogDraft] = useState({}); // wsId -> { inheritGlobalCatalog, tags, assetTypes }
  const [catalogSaving, setCatalogSaving] = useState({}); // wsId -> boolean
  const [catalogError, setCatalogError] = useState({}); // wsId -> string | null
  const [wsNewTag, setWsNewTag] = useState({}); // wsId -> { label, value }
  const [wsNewAssetType, setWsNewAssetType] = useState({}); // wsId -> string

  function openWsCatalog(ws) {
    const isOpen = catalogOpen[ws.id];
    setCatalogOpen((prev) => ({ ...prev, [ws.id]: !isOpen }));
    if (!isOpen && !catalogDraft[ws.id]) {
      setCatalogDraft((prev) => ({
        ...prev,
        [ws.id]: {
          inheritGlobalCatalog: ws.inheritGlobalCatalog !== false,
          tags: ws.tags ?? [],
          assetTypes: ws.assetTypes ?? [],
        },
      }));
      setWsNewTag((prev) => ({ ...prev, [ws.id]: { label: '', value: '' } }));
      setWsNewAssetType((prev) => ({ ...prev, [ws.id]: '' }));
    }
  }

  async function saveWsCatalog(wsId) {
    const draft = catalogDraft[wsId];
    if (!draft) return;
    setCatalogSaving((prev) => ({ ...prev, [wsId]: true }));
    setCatalogError((prev) => ({ ...prev, [wsId]: null }));
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(wsId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          inheritGlobalCatalog: draft.inheritGlobalCatalog,
          tags: draft.tags,
          assetTypes: draft.assetTypes,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      await refreshWorkspaces();
      // Sync draft to saved data
      setCatalogDraft((prev) => ({ ...prev, [wsId]: draft }));
    } catch (e) {
      setCatalogError((prev) => ({ ...prev, [wsId]: e.message }));
    } finally {
      setCatalogSaving((prev) => ({ ...prev, [wsId]: false }));
    }
  }

  function wsAddTag(wsId) {
    const nt = wsNewTag[wsId] ?? { label: '', value: '' };
    if (!nt.label.trim() || !nt.value.trim()) return;
    setCatalogDraft((prev) => ({
      ...prev,
      [wsId]: {
        ...prev[wsId],
        tags: [...(prev[wsId].tags ?? []), { label: nt.label.trim(), value: nt.value.trim() }],
      },
    }));
    setWsNewTag((prev) => ({ ...prev, [wsId]: { label: '', value: '' } }));
  }

  function wsRemoveTag(wsId, idx) {
    setCatalogDraft((prev) => ({
      ...prev,
      [wsId]: { ...prev[wsId], tags: (prev[wsId].tags ?? []).filter((_, i) => i !== idx) },
    }));
  }

  function wsAddAssetType(wsId) {
    const val = wsNewAssetType[wsId] ?? '';
    if (!val.trim()) return;
    setCatalogDraft((prev) => ({
      ...prev,
      [wsId]: {
        ...prev[wsId],
        assetTypes: [...(prev[wsId].assetTypes ?? []), val.trim()],
      },
    }));
    setWsNewAssetType((prev) => ({ ...prev, [wsId]: '' }));
  }

  function wsRemoveAssetType(wsId, idx) {
    setCatalogDraft((prev) => ({
      ...prev,
      [wsId]: {
        ...prev[wsId],
        assetTypes: (prev[wsId].assetTypes ?? []).filter((_, i) => i !== idx),
      },
    }));
  }

  // When a folder ID is entered in the create form, auto-fetch its Drive name
  useEffect(() => {
    const id = wsForm.driveFolderId.trim();
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) return;
    // Only auto-fill name if user hasn't typed one
    if (wsForm.name) return;
    setFolderLookupLoading(true);
    fetch(`/api/folders?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.name) setWsForm((f) => ({ ...f, name: f.name || data.name }));
      })
      .catch(() => {})
      .finally(() => setFolderLookupLoading(false));
  }, [wsForm.driveFolderId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSyncName(workspace) {
    setSyncingId(workspace.id);
    try {
      const res = await fetch(`/api/folders?id=${encodeURIComponent(workspace.driveFolderId)}`);
      const data = await res.json();
      if (!res.ok || !data.name) throw new Error(data.error ?? 'Folder not found');
      const token = await getToken();
      const patch = await fetch(`/api/workspaces?id=${encodeURIComponent(workspace.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: data.name }),
      });
      if (!patch.ok) {
        const b = await patch.json().catch(() => ({}));
        throw new Error(b.error ?? 'Update failed');
      }
      await refreshWorkspaces();
    } catch (e) {
      setWsError(e.message);
    } finally {
      setSyncingId(null);
    }
  }

  async function handleCreateWorkspace(e) {
    e.preventDefault();
    setWsFormError(null);
    setWsFormLoading(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(wsForm),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setWsForm({ name: '', driveFolderId: '' });
      await refreshWorkspaces();
    } catch (e) {
      setWsFormError(e.message);
    } finally {
      setWsFormLoading(false);
    }
  }

  async function handleDeleteWorkspace(id, name) {
    if (!window.confirm(`Delete workspace "${name}"? This cannot be undone.`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Delete failed');
      }
      await refreshWorkspaces();
    } catch (e) {
      setWsError(e.message);
    }
  }

  async function handleAddUser(workspaceId) {
    const uid = addUserSel[workspaceId];
    if (!uid) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(workspaceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ addUser: uid }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to add user');
      }
      setAddUserSel((prev) => ({ ...prev, [workspaceId]: '' }));
      await refreshWorkspaces();
    } catch (e) {
      setWsError(e.message);
    }
  }

  async function handleRemoveUser(workspaceId, uid) {
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(workspaceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ removeUser: uid }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to remove user');
      }
      await refreshWorkspaces();
    } catch (e) {
      setWsError(e.message);
    }
  }

  function emailForUid(uid) {
    return users.find((u) => u.uid === uid)?.email ?? uid;
  }

  return (
    <section className="admin-section">
      <h2 className="admin-section-title">Workspaces</h2>

      {/* ── Global Catalog card ── */}
      <div className="catalog-card catalog-card--global">
        <button
          className="catalog-card-header"
          onClick={() => setGlobalCatalogOpen((v) => !v)}
        >
          <span className="catalog-card-title">Global Catalog</span>
          <span className="catalog-card-meta">
            {gcDraft.tags.length} tags · {gcDraft.assetTypes.length} asset types
          </span>
          <span className="catalog-chevron">{globalCatalogOpen ? '▲' : '▼'}</span>
        </button>

        {globalCatalogOpen && (
          <div className="catalog-panel">
            <div className="catalog-columns">
              {/* Tags */}
              <div className="catalog-col">
                <h4 className="catalog-col-title">Tags (Steps)</h4>
                <ul className="catalog-item-list">
                  {gcDraft.tags.map((t, i) => (
                    <li key={i} className="catalog-item-row">
                      <span className="catalog-item-label">{t.label}</span>
                      <code className="catalog-item-value">{t.value}</code>
                      <button className="catalog-remove-btn" onClick={() => gcRemoveTag(i)}>✕</button>
                    </li>
                  ))}
                </ul>
                <div className="catalog-add-row">
                  <input
                    className="admin-input catalog-input-sm"
                    placeholder="Label (e.g. 8. Follow-up)"
                    value={gcNewTag.label}
                    onChange={(e) => setGcNewTag((t) => ({ ...t, label: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), gcAddTag())}
                  />
                  <input
                    className="admin-input catalog-input-sm"
                    placeholder="Value (e.g. Module/8-Followup)"
                    value={gcNewTag.value}
                    onChange={(e) => setGcNewTag((t) => ({ ...t, value: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), gcAddTag())}
                  />
                  <button className="admin-btn admin-btn--secondary admin-btn--sm" onClick={gcAddTag}>Add</button>
                </div>
              </div>

              {/* Asset Types */}
              <div className="catalog-col">
                <h4 className="catalog-col-title">Asset Types</h4>
                <ul className="catalog-item-list">
                  {gcDraft.assetTypes.map((t, i) => (
                    <li key={i} className="catalog-item-row">
                      <span className="catalog-item-label">{t}</span>
                      <button className="catalog-remove-btn" onClick={() => gcRemoveAssetType(i)}>✕</button>
                    </li>
                  ))}
                </ul>
                <div className="catalog-add-row">
                  <input
                    className="admin-input catalog-input-sm"
                    placeholder="e.g. Lesson - Case Study"
                    value={gcNewAssetType}
                    onChange={(e) => setGcNewAssetType(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), gcAddAssetType())}
                  />
                  <button className="admin-btn admin-btn--secondary admin-btn--sm" onClick={gcAddAssetType}>Add</button>
                </div>
              </div>
            </div>

            {gcError && <p className="admin-form-error" style={{ marginTop: '0.5rem' }}>{gcError}</p>}
            <div className="catalog-save-row">
              <button
                className="admin-btn admin-btn--primary"
                onClick={saveGlobalCatalog}
                disabled={gcSaving}
              >
                {gcSaving ? 'Saving…' : 'Save Global Catalog'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create workspace form */}
      <form className="admin-form" onSubmit={handleCreateWorkspace}>
        <div className="admin-form-row">
          <div className="admin-input-wrap">
            <input
              className="admin-input"
              type="text"
              placeholder="Google Drive folder ID"
              value={wsForm.driveFolderId}
              onChange={(e) => setWsForm((f) => ({ ...f, driveFolderId: e.target.value, name: '' }))}
              required
            />
          </div>
          <div className="admin-input-wrap">
            <input
              className="admin-input"
              type="text"
              placeholder={folderLookupLoading ? 'Fetching name from Drive…' : 'Workspace name'}
              value={wsForm.name}
              onChange={(e) => setWsForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <button className="admin-btn admin-btn--primary" type="submit" disabled={wsFormLoading || folderLookupLoading}>
            {wsFormLoading ? 'Creating…' : 'Create Workspace'}
          </button>
        </div>
        {wsFormError && <p className="admin-form-error">{wsFormError}</p>}
      </form>

      {wsLoadError && (
        <div className="admin-error" style={{ marginTop: '0.75rem' }}>
          <div>
            <strong>Could not load workspaces:</strong> {wsLoadError}
            {wsLoadError.includes('Firestore') && (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#c9d1d9' }}>
                Go to the{' '}
                <a
                  href="https://console.firebase.google.com/project/jhg-academy/firestore"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#58a6ff' }}
                >
                  Firebase Console → Firestore
                </a>{' '}
                and create a database (Native mode, any region).
              </p>
            )}
          </div>
          <button className="admin-retry-btn" onClick={refreshWorkspaces}>Retry</button>
        </div>
      )}
      {wsError && <p className="admin-form-error" style={{ marginTop: '0.75rem' }}>{wsError}</p>}

      {/* Workspace list */}
      {workspaces.length === 0 ? (
        <p className="admin-empty-msg">No workspaces yet. Create one above.</p>
      ) : (
        <div className="ws-list">
          {workspaces.map((ws) => {
            const isOpen = expanded[ws.id] ?? false;
            const assignedUids = ws.userIds ?? [];
            const unassigned = users.filter((u) => !assignedUids.includes(u.uid));

            return (
              <div key={ws.id} className="ws-card">
                <div className="ws-card-header">
                  <div className="ws-card-info">
                    <span className="ws-card-name">{ws.name}</span>
                    <span className="ws-card-folder">
                      Drive: <code>{ws.driveFolderId}</code>
                    </span>
                    <span className="ws-card-count">
                      {assignedUids.length} user{assignedUids.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="ws-card-actions">
                    <button
                      className="admin-btn admin-btn--secondary"
                      disabled={syncingId === ws.id}
                      onClick={() => handleSyncName(ws)}
                      title="Sync workspace name from Google Drive folder"
                    >
                      {syncingId === ws.id ? 'Syncing…' : 'Sync Name'}
                    </button>
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setExpanded((prev) => ({ ...prev, [ws.id]: !isOpen }))}
                    >
                      {isOpen ? 'Hide Users' : 'Manage Users'}
                    </button>
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => openWsCatalog(ws)}
                    >
                      {catalogOpen[ws.id] ? 'Hide Catalog' : 'Catalog'}
                    </button>
                    <button
                      className="admin-btn admin-btn--danger"
                      onClick={() => handleDeleteWorkspace(ws.id, ws.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="ws-users-panel">
                    {/* Assigned users */}
                    {assignedUids.length === 0 ? (
                      <p className="ws-no-users">No users assigned yet.</p>
                    ) : (
                      <ul className="ws-user-list">
                        {assignedUids.map((uid) => (
                          <li key={uid} className="ws-user-row">
                            <span className="ws-user-email">{emailForUid(uid)}</span>
                            <button
                              className="admin-btn admin-btn--danger admin-btn--sm"
                              onClick={() => handleRemoveUser(ws.id, uid)}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Add user */}
                    {unassigned.length > 0 && (
                      <div className="ws-add-user-row">
                        <select
                          className="admin-select"
                          value={addUserSel[ws.id] ?? ''}
                          onChange={(e) =>
                            setAddUserSel((prev) => ({ ...prev, [ws.id]: e.target.value }))
                          }
                        >
                          <option value="">— Select user to add —</option>
                          {unassigned.map((u) => (
                            <option key={u.uid} value={u.uid}>{u.email}</option>
                          ))}
                        </select>
                        <button
                          className="admin-btn admin-btn--primary"
                          disabled={!addUserSel[ws.id]}
                          onClick={() => handleAddUser(ws.id)}
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Per-workspace Custom Catalog panel ── */}
                {catalogOpen[ws.id] && (
                  <div className="ws-catalog-panel">
                    <div className="catalog-inherit-row">
                      <label className="catalog-toggle-label">
                        <input
                          type="checkbox"
                          checked={catalogDraft[ws.id]?.inheritGlobalCatalog ?? true}
                          onChange={(e) =>
                            setCatalogDraft((prev) => ({
                              ...prev,
                              [ws.id]: { ...prev[ws.id], inheritGlobalCatalog: e.target.checked },
                            }))
                          }
                        />
                        Inherit global catalog (merge workspace additions with global defaults)
                      </label>
                    </div>
                    <div className="catalog-columns">
                      {/* Custom Tags */}
                      <div className="catalog-col">
                        <h4 className="catalog-col-title">Custom Tags</h4>
                        <ul className="catalog-item-list">
                          {(catalogDraft[ws.id]?.tags ?? []).map((t, i) => (
                            <li key={i} className="catalog-item-row">
                              <span className="catalog-item-label">{t.label}</span>
                              <code className="catalog-item-value">{t.value}</code>
                              <button
                                className="catalog-remove-btn"
                                onClick={() => wsRemoveTag(ws.id, i)}
                              >✕</button>
                            </li>
                          ))}
                          {(catalogDraft[ws.id]?.tags ?? []).length === 0 && (
                            <li className="catalog-empty">No custom tags yet</li>
                          )}
                        </ul>
                        <div className="catalog-add-row">
                          <input
                            className="admin-input catalog-input-sm"
                            placeholder="Label"
                            value={wsNewTag[ws.id]?.label ?? ''}
                            onChange={(e) =>
                              setWsNewTag((prev) => ({
                                ...prev,
                                [ws.id]: { ...(prev[ws.id] ?? { label: '', value: '' }), label: e.target.value },
                              }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), wsAddTag(ws.id))}
                          />
                          <input
                            className="admin-input catalog-input-sm"
                            placeholder="Value"
                            value={wsNewTag[ws.id]?.value ?? ''}
                            onChange={(e) =>
                              setWsNewTag((prev) => ({
                                ...prev,
                                [ws.id]: { ...(prev[ws.id] ?? { label: '', value: '' }), value: e.target.value },
                              }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), wsAddTag(ws.id))}
                          />
                          <button
                            className="admin-btn admin-btn--secondary admin-btn--sm"
                            onClick={() => wsAddTag(ws.id)}
                          >Add</button>
                        </div>
                      </div>

                      {/* Custom Asset Types */}
                      <div className="catalog-col">
                        <h4 className="catalog-col-title">Custom Asset Types</h4>
                        <ul className="catalog-item-list">
                          {(catalogDraft[ws.id]?.assetTypes ?? []).map((t, i) => (
                            <li key={i} className="catalog-item-row">
                              <span className="catalog-item-label">{t}</span>
                              <button
                                className="catalog-remove-btn"
                                onClick={() => wsRemoveAssetType(ws.id, i)}
                              >✕</button>
                            </li>
                          ))}
                          {(catalogDraft[ws.id]?.assetTypes ?? []).length === 0 && (
                            <li className="catalog-empty">No custom asset types yet</li>
                          )}
                        </ul>
                        <div className="catalog-add-row">
                          <input
                            className="admin-input catalog-input-sm"
                            placeholder="e.g. Workshop"
                            value={wsNewAssetType[ws.id] ?? ''}
                            onChange={(e) =>
                              setWsNewAssetType((prev) => ({ ...prev, [ws.id]: e.target.value }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), wsAddAssetType(ws.id))}
                          />
                          <button
                            className="admin-btn admin-btn--secondary admin-btn--sm"
                            onClick={() => wsAddAssetType(ws.id)}
                          >Add</button>
                        </div>
                      </div>
                    </div>

                    {catalogError[ws.id] && (
                      <p className="admin-form-error" style={{ marginTop: '0.5rem' }}>
                        {catalogError[ws.id]}
                      </p>
                    )}
                    <div className="catalog-save-row">
                      <button
                        className="admin-btn admin-btn--primary"
                        onClick={() => saveWsCatalog(ws.id)}
                        disabled={catalogSaving[ws.id]}
                      >
                        {catalogSaving[ws.id] ? 'Saving…' : 'Save Catalog'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add user form state
  const [form, setForm] = useState({ email: '', password: '', role: 'editor' });
  const [formError, setFormError] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  // Redirect non-admins immediately
  useEffect(() => {
    if (role && role !== 'admin') navigate('/graph', { replace: true });
  }, [role, navigate]);

  const getToken = useCallback(() => user?.getIdToken(), [user]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      setUsers(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (role === 'admin') fetchUsers();
  }, [role, fetchUsers]);

  async function handleAddUser(e) {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setForm({ email: '', password: '', role: 'editor' });
      await fetchUsers();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleRoleChange(uid, newRole) {
    try {
      const token = await getToken();
      const res = await fetch(`/api/users?uid=${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Update failed');
      }
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, role: newRole } : u))
      );
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(uid, email) {
    if (!window.confirm(`Delete user "${email}"? This cannot be undone.`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/users?uid=${encodeURIComponent(uid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Delete failed');
      }
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
    } catch (e) {
      setError(e.message);
    }
  }

  const [activeTab, setActiveTab] = useState('workspaces');

  if (role && role !== 'admin') return null;

  const tabs = [
    { id: 'workspaces', label: 'Workspaces' },
    { id: 'users', label: 'Users' },
    { id: 'questions', label: 'Questions' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'early-access', label: 'Early Access' },
  ];

  return (
    <div className="admin-page">
      <h1 className="admin-title">Admin</h1>

      <div className="admin-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`admin-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'workspaces' && (
        <WorkspacesSection users={users} getToken={getToken} />
      )}

      {activeTab === 'questions' && (
        <QuestionManager getToken={getToken} />
      )}

      {activeTab === 'early-access' && (
        <EarlyAccessManager getToken={getToken} />
      )}

      {activeTab === 'feedback' && (
        <FeedbackDashboard getToken={getToken} users={users} />
      )}

      {activeTab === 'users' && (
      <>
      {/* ── Add user form ── */}
      <section className="admin-section">
        <h2 className="admin-section-title">Add User</h2>
        <form className="admin-form" onSubmit={handleAddUser}>
          <div className="admin-form-row">
            <input
              className="admin-input"
              type="email"
              placeholder="Email address"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              autoComplete="off"
            />
            <input
              className="admin-input"
              type="password"
              placeholder="Password (min 8 chars)"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <select
              className="admin-select"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button className="admin-btn admin-btn--primary" type="submit" disabled={formLoading}>
              {formLoading ? 'Adding…' : 'Add User'}
            </button>
          </div>
          {formError && <p className="admin-form-error">{formError}</p>}
        </form>
      </section>

      {/* ── User list ── */}
      <section className="admin-section">
        <h2 className="admin-section-title">Users</h2>

        {error && (
          <div className="admin-error">
            {error}
            <button className="admin-retry-btn" onClick={fetchUsers}>Retry</button>
          </div>
        )}

        {loading ? (
          <div className="admin-loading"><div className="spinner" /></div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid} className={u.uid === user?.uid ? 'admin-table-row--self' : ''}>
                  <td className="admin-td-email">
                    {u.email}
                    {u.uid === user?.uid && <span className="admin-self-badge">you</span>}
                  </td>
                  <td>
                    <select
                      className="admin-select admin-select--inline"
                      value={u.role}
                      disabled={u.uid === user?.uid}
                      onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="admin-td-date">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <button
                      className="admin-btn admin-btn--danger"
                      disabled={u.uid === user?.uid}
                      onClick={() => handleDelete(u.uid, u.email)}
                      title={u.uid === user?.uid ? "You can't delete yourself" : 'Delete user'}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr><td colSpan={4} className="admin-empty">No users found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
      </>
      )}
    </div>
  );
}
