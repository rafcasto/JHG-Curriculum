import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
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
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();

  // Instruction file
  const instructionFileId = currentWorkspace?.instructionFileId ?? null;
  const [instructionContent, setInstructionContent] = useState(null);
  const [instructionTitle, setInstructionTitle] = useState('');
  const [instructionLoading, setInstructionLoading] = useState(false);

  useEffect(() => {
    if (!instructionFileId || !user) {
      setInstructionContent(null);
      return;
    }
    let cancelled = false;
    setInstructionLoading(true);
    user.getIdToken().then((token) =>
      fetch(`/api/file?id=${encodeURIComponent(instructionFileId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data) {
          setInstructionTitle(data.title ?? '');
          setInstructionContent(data.content ?? '');
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setInstructionLoading(false); });
    return () => { cancelled = true; };
  }, [instructionFileId, user]);

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

  if (reviewLoading || instructionLoading) {
    return (
      <div className="rv-loading">
        <div className="rv-spinner" />
        <p>Loading documents…</p>
      </div>
    );
  }

  // Show instruction file instead of TOC when set
  if (instructionFileId && instructionContent !== null) {
    return (
      <div className="rv-instruction-page">
        {instructionTitle && <h1 className="rv-instruction-heading">{instructionTitle}</h1>}
        <div className="rv-instruction-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{instructionContent}</ReactMarkdown>
        </div>
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

