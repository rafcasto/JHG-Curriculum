import { useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import './ReviewerPage.css';

function getFolder(doc) {
  const path = doc.drivePath ?? '';
  if (!path) return '(uncategorized)';
  const first = path.split('/')[0].trim();
  return first || '(uncategorized)';
}

export default function ReviewerPage() {
  const { reviewDocs = [], reviewLoading = false } = useOutletContext() ?? {};
  const navigate = useNavigate();

  const grouped = useMemo(() => {
    const map = {};
    reviewDocs.forEach((doc) => {
      const folder = getFolder(doc);
      if (!map[folder]) map[folder] = [];
      map[folder].push(doc);
    });
    const sorted = Object.keys(map).sort((a, b) => {
      if (a === '(uncategorized)') return 1;
      if (b === '(uncategorized)') return -1;
      return a.localeCompare(b);
    });
    return sorted.map((folder) => ({
      folder,
      files: map[folder].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')),
    }));
  }, [reviewDocs]);

  if (reviewLoading) {
    return (
      <div className="rv-loading">
        <div className="rv-spinner" />
        <p>Loading documents…</p>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="rv-welcome">
        <div className="rv-welcome-inner">
          <p className="rv-welcome-icon" aria-hidden="true">&#128196;</p>
          <h1 className="rv-welcome-heading">No documents assigned yet.</h1>
          <p className="rv-welcome-text">
            Check back later or contact your workspace administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-toc-page">
      {grouped.map(({ folder, files }) => (
        <section key={folder} className="rv-toc-section">
          <h2 className="rv-toc-folder">{folder}</h2>
          <ul className="rv-toc-files">
            {files.map((doc) => (
              <li key={doc.id}>
                <button
                  className="rv-toc-file-link"
                  onClick={() => navigate(`/file/${doc.driveFileId}`)}
                >
                  {doc.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

