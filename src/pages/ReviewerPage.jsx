import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { fetchAllDocuments } from '../hooks/useDocuments';
import './ReviewerPage.css';

function getFolder(doc) {
  if (!doc.path) return '(uncategorized)';
  const first = doc.path.split('/')[0].trim();
  return first || '(uncategorized)';
}

export default function ReviewerPage() {
  const { currentWorkspace } = useWorkspace();
  const navigate = useNavigate();

  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDocs([]);
    fetchAllDocuments(currentWorkspace?.driveFolderId)
      .then(setDocs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentWorkspace]);

  const grouped = useMemo(() => {
    const map = {};
    docs.forEach((doc) => {
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
      files: map[folder].sort((a, b) => a.title.localeCompare(b.title)),
    }));
  }, [docs]);

  if (loading) {
    return (
      <div className="rv-loading">
        <div className="rv-spinner" />
        <p>Loading documents…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rv-error">
        <p>Failed to load documents: {error}</p>
      </div>
    );
  }

  return (
    <div className="rv-toc-page">
      {currentWorkspace && (
        <p className="rv-toc-workspace">{currentWorkspace.name}</p>
      )}
      {grouped.map(({ folder, files }) => (
        <section key={folder} className="rv-toc-section">
          <h1 className="rv-toc-folder">{folder}</h1>
          <ul className="rv-toc-files">
            {files.map((doc) => (
              <li key={doc.id}>
                <button
                  className="rv-toc-file-link"
                  onClick={() => navigate(`/file/${doc.id}`)}
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

