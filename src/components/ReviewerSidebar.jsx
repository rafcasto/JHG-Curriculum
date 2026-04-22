import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './ReviewerSidebar.css';

const STATUS_META = {
  not_started: { label: 'New',         className: 'rsb-status--new' },
  in_progress:  { label: 'In progress', className: 'rsb-status--progress' },
  complete:     { label: 'Done',        className: 'rsb-status--done' },
};

function submissionStatus(submission) {
  if (!submission) return 'not_started';
  if (submission.status === 'complete') return 'complete';
  return 'in_progress';
}

/** Extract the top-level folder name from a Drive path like "1. focus/Lesson Name" */
function getFolder(drivePath) {
  if (!drivePath) return 'Other';
  const segment = drivePath.split('/')[0].trim();
  return segment || 'Other';
}

function folderLabel(key) {
  return key
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Props:
 *   documents   — array of reviewer-assigned documents from /api/documents
 *   submissions — map of driveFileId → submission object
 *   loading     — bool
 */
export default function ReviewerSidebar({ documents = [], submissions = {}, loading = false }) {
  const navigate = useNavigate();
  const { id: activeId } = useParams();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? documents.filter((d) => (d.title ?? '').toLowerCase().includes(q))
      : documents;

    const groups = {};
    filtered.forEach((d) => {
      const key = getFolder(d.drivePath);
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    Object.values(groups).forEach((arr) =>
      arr.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
    );

    return groups;
  }, [documents, search]);

  const sortedGroups = Object.keys(grouped).sort((a, b) =>
    a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)
  );

  function toggle(key) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className="rsb-sidebar">
      <div className="rsb-header">
        <span className="rsb-title">Documents</span>
        <input
          className="rsb-search"
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <nav className="rsb-nav">
        {loading && (
          <div className="rsb-loading">
            <div className="spinner" />
          </div>
        )}

        {!loading && sortedGroups.length === 0 && (
          <p className="rsb-empty">No documents assigned yet.</p>
        )}

        {sortedGroups.map((key) => (
          <div key={key} className="rsb-group">
            <button className="rsb-group-header" onClick={() => toggle(key)}>
              <span className={`rsb-chevron${collapsed[key] ? '' : ' open'}`}>›</span>
              <span className="rsb-group-name">{folderLabel(key)}</span>
              <span className="rsb-group-count">{grouped[key].length}</span>
            </button>

            {!collapsed[key] && (
              <ul className="rsb-file-list">
                {grouped[key].map((doc) => {
                  const sub = submissions[doc.driveFileId];
                  const status = submissionStatus(sub);
                  const meta = STATUS_META[status];
                  const isActive = doc.driveFileId === activeId;

                  return (
                    <li key={doc.id}>
                      <button
                        className={`rsb-file-btn${isActive ? ' active' : ''}`}
                        onClick={() => navigate(`/file/${doc.driveFileId}`)}
                      >
                        <span className="rsb-file-name">{doc.title}</span>
                        <span className={`rsb-badge ${meta.className}`}>{meta.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
