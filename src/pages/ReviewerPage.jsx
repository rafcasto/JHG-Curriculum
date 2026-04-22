import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './ReviewerPage.css';

const STATUS_LABELS = {
  early_access: 'Early Access',
  published: 'Published',
};

function submissionStatus(submission) {
  if (!submission) return 'not_started';
  if (submission.status === 'complete') return 'complete';
  return 'in_progress';
}

const SUBMISSION_UI = {
  not_started: { label: 'Not started', className: 'rv-status--new' },
  in_progress:  { label: 'In progress', className: 'rv-status--progress' },
  complete:     { label: 'Submitted', className: 'rv-status--done' },
};

export default function ReviewerPage() {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const navigate = useNavigate();

  const [documents, setDocuments] = useState([]);
  const [submissions, setSubmissions] = useState({}); // driveFileId -> submission
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentWorkspace?.id || !user) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();

        // Load early-access documents for this workspace
        const docsRes = await fetch(
          `/api/documents?workspaceId=${encodeURIComponent(currentWorkspace.id)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!docsRes.ok) throw new Error((await docsRes.json()).error ?? 'Failed to load documents');
        const docs = await docsRes.json();
        if (cancelled) return;
        setDocuments(docs);

        // Load submission status for each document
        const subResults = await Promise.allSettled(
          docs.map(async (doc) => {
            const res = await fetch(
              `/api/submissions?documentId=${encodeURIComponent(doc.driveFileId)}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = res.ok ? await res.json() : null;
            return { driveFileId: doc.driveFileId, submission: data };
          })
        );
        if (cancelled) return;
        const subMap = {};
        for (const r of subResults) {
          if (r.status === 'fulfilled' && r.value.submission) {
            subMap[r.value.driveFileId] = r.value.submission;
          }
        }
        setSubmissions(subMap);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [currentWorkspace, user]);

  if (loading) {
    return (
      <div className="rv-page">
        <div className="rv-loading"><div className="spinner" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rv-page">
        <div className="rv-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-page">
      <div className="rv-header">
        <h1 className="rv-title">My Documents</h1>
        {currentWorkspace && (
          <span className="rv-workspace-label">{currentWorkspace.name}</span>
        )}
      </div>

      {documents.length === 0 ? (
        <div className="rv-empty">
          <p>No documents have been assigned to this workspace yet.</p>
          <p className="rv-empty-hint">Check back soon — content is on its way.</p>
        </div>
      ) : (
        <div className="rv-grid">
          {documents.map((doc) => {
            const sub = submissions[doc.driveFileId];
            const status = submissionStatus(sub);
            const ui = SUBMISSION_UI[status];
            const isComplete = status === 'complete';

            return (
              <button
                key={doc.id}
                className={`rv-card${isComplete ? ' rv-card--done' : ''}`}
                onClick={() => navigate(`/file/${doc.driveFileId}`)}
              >
                <div className="rv-card-top">
                  <div className="rv-card-badges">
                    {doc.category && (
                      <span className="rv-badge rv-badge--category">{doc.category}</span>
                    )}
                    <span className={`rv-badge rv-status ${ui.className}`}>{ui.label}</span>
                    {doc.status && (
                      <span className="rv-badge rv-badge--doc-status">
                        {STATUS_LABELS[doc.status] ?? doc.status}
                      </span>
                    )}
                  </div>
                </div>

                <div className="rv-card-body">
                  <h2 className="rv-card-title">{doc.title}</h2>
                  {doc.description && (
                    <p className="rv-card-desc">{doc.description}</p>
                  )}
                </div>

                <div className="rv-card-footer">
                  {doc.version && <span className="rv-card-version">v{doc.version}</span>}
                  <span className="rv-card-cta">
                    {status === 'not_started' && 'Start reading →'}
                    {status === 'in_progress' && 'Continue →'}
                    {status === 'complete' && 'Review again →'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
