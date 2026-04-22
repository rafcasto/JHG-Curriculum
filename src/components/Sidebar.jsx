import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { createDocument, renameDocument } from '../hooks/useDocuments';
import './Sidebar.css';

const TAG_OPTIONS = [
  { label: '0. Preparation',        value: 'Module/0-Preparation' },
  { label: '1. Goal',               value: 'Module/1-Goal' },
  { label: '2. Value - Resume',     value: 'Module/2-Value-Resume' },
  { label: '3. Value - eProfile',   value: 'Module/3-Value-eProfile' },
  { label: '4. Apply on autopilot', value: 'Module/4-Apply-on-autopilot' },
  { label: '5. Networking',         value: 'Module/5-Networking' },
  { label: '6. Interview',          value: 'Module/6-Interview' },
  { label: '7. Nego',               value: 'Module/7-Nego' },
];

const CATEGORY_OPTIONS = [
  'Infographic',
  'Lesson - Text',
  'Lesson - Example',
  'Lesson - Video',
  'Homework - Instructions',
  'Homework - Template example',
];

function getModule(doc) {
  const p = doc.path ?? '';
  if (!p.includes('/')) return 'other';
  return p.split('/')[0];
}

/** Infer a document type from its title/path when frontMatter is unavailable */
function inferType(doc) {
  const name = (doc.title ?? doc.path ?? '').toLowerCase();
  if (name.includes('roadmap'))  return 'roadmap';
  if (name.includes('toolkit'))  return 'toolkit';
  if (name.includes('analysis')) return 'analysis';
  return doc.frontMatter?.type ?? 'lesson';
}

function moduleLabel(key) {
  return key
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function Sidebar({ documents, loading = false, onRefresh }) {
  const navigate = useNavigate();
  const { id: activeId } = useParams();
  const { role, user } = useAuth();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});

  // Folders loaded on mount for per-folder "+" button matching
  const [folders, setFolders] = useState([]);

  // New-file modal state
  const [showModal, setShowModal] = useState(false);
  const [modalName, setModalName] = useState('');
  const [modalFolders, setModalFolders] = useState([]);
  const [modalFolderId, setModalFolderId] = useState('');
  const [modalTag, setModalTag] = useState('');
  const [modalCategories, setModalCategories] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [foldersLoading, setFoldersLoading] = useState(false);

  // Rename state
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null); // { id, message }

  const canEdit = role === 'admin' || role === 'editor';
  const { currentWorkspace } = useWorkspace();
  const workspaceFolderId = currentWorkspace?.driveFolderId ?? null;

  /** Build the /api/folders URL, optionally scoped to the current workspace root. */
  function foldersUrl() {
    return workspaceFolderId
      ? `/api/folders?folderId=${encodeURIComponent(workspaceFolderId)}`
      : '/api/folders';
  }

  // Pre-load folders whenever the workspace changes
  useEffect(() => {
    if (!canEdit) return;
    fetch(foldersUrl())
      .then((r) => r.json())
      .then(setFolders)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, workspaceFolderId]);

  function openModalForFolder(moduleKey) {
    const matched = folders.find(
      (f) => f.name.toLowerCase() === moduleKey.toLowerCase()
    );
    setShowModal(true);
    setModalName('');
    setModalTag('');
    setModalCategories([]);
    setModalError(null);
    setFoldersLoading(true);
    fetch(foldersUrl())
      .then((r) => r.json())
      .then((fols) => {
        setModalFolders(fols);
        setModalFolderId(matched?.id ?? fols[0]?.id ?? '');
      })
      .catch((e) => setModalError(e.message))
      .finally(() => setFoldersLoading(false));
  }

  function toggleCategory(cat) {
    setModalCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!modalName.trim() || !modalTag) return;
    setModalLoading(true);
    setModalError(null);
    try {
      const token = await user.getIdToken();
      const newFile = await createDocument(
        modalName.trim(),
        modalFolderId,
        { tag: modalTag, categories: modalCategories, token }
      );
      setShowModal(false);
      onRefresh?.();
      navigate(`/file/${newFile.id}`);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  }

  function startRename(doc) {
    setRenamingId(doc.id);
    setRenameValue(doc.title ?? '');
    setRenameError(null);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue('');
    setRenameError(null);
  }

  async function confirmRename(doc) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    setRenameValue('');
    if (!trimmed || trimmed === doc.title) return;
    try {
      const token = await user.getIdToken();
      await renameDocument(doc.id, trimmed, token);
      onRefresh?.();
    } catch (err) {
      setRenameError({ id: doc.id, message: err.message });
    }
  }

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? documents.filter(
          (d) =>
            (d.title ?? '').toLowerCase().includes(q) ||
            (d.frontMatter?.type ?? '').toLowerCase().includes(q)
        )
      : documents;

    const groups = {};
    filtered.forEach((d) => {
      const key = getModule(d);
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    Object.values(groups).forEach((arr) =>
      arr.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
    );

    return groups;
  }, [documents, search]);

  const sortedModules = Object.keys(grouped).sort((a, b) =>
    a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)
  );

  function toggle(key) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button className="graph-nav-btn" onClick={() => navigate('/graph')}>
          ⬡ Graph View
        </button>
        <input
          className="sidebar-search"
          type="search"
          placeholder="Search files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <nav className="sidebar-nav">
        {sortedModules.map((key) => (
          <div key={key} className="module-group">
            <div className="module-header-row">
              <button
                className="module-header"
                onClick={() => toggle(key)}
              >
                <span className={`chevron ${collapsed[key] ? '' : 'open'}`}>›</span>
                <span className="module-name">{moduleLabel(key)}</span>
                <span className="module-count">{grouped[key].length}</span>
              </button>
              {canEdit && (
                <button
                  className="module-add-btn"
                  onClick={() => openModalForFolder(key)}
                  title={`Add file to ${moduleLabel(key)}`}
                >
                  +
                </button>
              )}
            </div>

            {!collapsed[key] && (
              <ul className="module-files">
                {grouped[key].map((doc) => (
                  <li key={doc.id}>
                    {renamingId === doc.id ? (
                      <div className="rename-row">
                        <input
                          className="rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); confirmRename(doc); }
                            if (e.key === 'Escape') cancelRename();
                          }}
                          onBlur={() => confirmRename(doc)}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="file-row">
                        <button
                          className={`file-btn ${doc.id === activeId ? 'active' : ''}`}
                          onClick={() => navigate(`/file/${doc.id}`)}
                          title={doc.title}
                        >
                          <span className="file-type-dot" data-type={inferType(doc)} />
                          <span className="file-name">{doc.title ?? doc.id}</span>
                        </button>
                        {canEdit && doc.mimeType !== 'application/vnd.google-apps.document' && (
                          <button
                            className="rename-btn"
                            onClick={() => startRename(doc)}
                            title="Rename file"
                          >
                            ✎
                          </button>
                        )}
                      </div>
                    )}
                    {renameError?.id === doc.id && (
                      <p className="rename-error">{renameError.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {loading && sortedModules.length === 0 && (
          <p className="sidebar-empty">Loading…</p>
        )}
        {!loading && sortedModules.length === 0 && (
          <p className="sidebar-empty">
            {search ? `No results for "${search}"` : 'No documents found'}
          </p>
        )}
      </nav>

      {/* New File modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">New File</h3>
            <form onSubmit={handleCreate}>
              <input
                className="modal-input"
                type="text"
                placeholder="File name (e.g. Week 1 Lesson)"
                value={modalName}
                onChange={(e) => setModalName(e.target.value)}
                autoFocus
                required
              />

              <label className="modal-label">Folder</label>
              {foldersLoading ? (
                <p className="modal-hint">Loading folders…</p>
              ) : (
                <select
                  className="modal-select"
                  value={modalFolderId}
                  onChange={(e) => setModalFolderId(e.target.value)}
                >
                  {modalFolders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              )}

              <label className="modal-label">
                Step <span className="modal-required">*</span>
              </label>
              <div className="modal-radio-group">
                {TAG_OPTIONS.map((opt) => (
                  <label key={opt.value} className="modal-radio-label">
                    <input
                      type="radio"
                      name="modalTag"
                      value={opt.value}
                      checked={modalTag === opt.value}
                      onChange={() => setModalTag(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>

              <label className="modal-label">Asset Type</label>
              <div className="modal-checkbox-group">
                {CATEGORY_OPTIONS.map((cat) => (
                  <label key={cat} className="modal-checkbox-label">
                    <input
                      type="checkbox"
                      checked={modalCategories.includes(cat)}
                      onChange={() => toggleCategory(cat)}
                    />
                    {cat}
                  </label>
                ))}
              </div>

              {modalError && <p className="modal-error">{modalError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-btn modal-btn--cancel"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn modal-btn--create"
                  disabled={modalLoading || !modalName.trim() || !modalTag}
                >
                  {modalLoading ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
