import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createDocument } from '../hooks/useDocuments';
import './Sidebar.css';

function getModule(doc) {
  return (doc.path ?? '').split('/')[0] || 'other';
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
  const { role } = useAuth();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});

  // New-file modal state
  const [showModal, setShowModal] = useState(false);
  const [modalName, setModalName] = useState('');
  const [modalFolders, setModalFolders] = useState([]);
  const [modalFolderId, setModalFolderId] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [foldersLoading, setFoldersLoading] = useState(false);

  const canEdit = role === 'admin' || role === 'editor';

  function openModal() {
    setShowModal(true);
    setModalName('');
    setModalError(null);
    setFoldersLoading(true);
    fetch('/api/folders')
      .then((r) => r.json())
      .then((folders) => {
        setModalFolders(folders);
        setModalFolderId(folders[0]?.id ?? '');
      })
      .catch((e) => setModalError(e.message))
      .finally(() => setFoldersLoading(false));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!modalName.trim()) return;
    setModalLoading(true);
    setModalError(null);
    try {
      const newFile = await createDocument(modalName.trim(), modalFolderId);
      setShowModal(false);
      onRefresh?.();
      navigate(`/file/${newFile.id}`);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
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

    // Sort documents within each group alphabetically by title
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
        {canEdit && (
          <button className="new-file-btn" onClick={openModal} title="Create new file">
            + New File
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {sortedModules.map((key) => (
          <div key={key} className="module-group">
            <button
              className="module-header"
              onClick={() => toggle(key)}
            >
              <span className={`chevron ${collapsed[key] ? '' : 'open'}`}>›</span>
              <span className="module-name">{moduleLabel(key)}</span>
              <span className="module-count">{grouped[key].length}</span>
            </button>

            {!collapsed[key] && (
              <ul className="module-files">
                {grouped[key].map((doc) => (
                  <li key={doc.id}>
                    <button
                      className={`file-btn ${doc.id === activeId ? 'active' : ''}`}
                      onClick={() => navigate(`/file/${doc.id}`)}
                      title={doc.title}
                    >
                      <span className="file-type-dot" data-type={inferType(doc)} />
                      <span className="file-name">{doc.title ?? doc.id}</span>
                    </button>
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
          <div className="modal" onClick={(e) => e.stopPropagation()}>
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
                  disabled={modalLoading || !modalName.trim()}
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
