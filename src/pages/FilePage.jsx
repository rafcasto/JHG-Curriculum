import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../contexts/AuthContext';
import { fetchDocument, saveDocument, deleteDocument } from '../hooks/useDocuments';
import RichTextEditor from '../components/RichTextEditor';
import GraphView, { DEFAULT_SETTINGS } from '../components/GraphView';
import TableOfContents from '../components/TableOfContents';
import WarmupQuestion from '../components/WarmupQuestion';
import FeedbackForm from '../components/FeedbackForm';
import './FilePage.css';

/** Convert heading text to a URL-safe id for anchor links. */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
}

/** Custom heading renderers that add id attributes for TOC anchor links. */
function makeHeading(Tag) {
  return function Heading({ children, ...props }) {
    const text = typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? children.map((c) => (typeof c === 'string' ? c : '')).join('')
        : '';
    return <Tag id={slugify(text)} {...props}>{children}</Tag>;
  };
}

const headingComponents = {
  h1: makeHeading('h1'),
  h2: makeHeading('h2'),
  h3: makeHeading('h3'),
};

/** Split raw file content into the YAML frontmatter block and the markdown body. */
function splitFrontmatter(raw = '') {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: '', body: raw };
  const frontmatter = raw.slice(0, end + 4);
  const body = raw.slice(end + 4).replace(/^\n/, '');
  return { frontmatter, body };
}

export default function FilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { refreshDocuments } = useOutletContext() ?? {};

  const [doc, setDoc] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('preview'); // 'preview' | 'edit'
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const readOnly = doc?.readOnly ?? false;
  const canEdit = role === 'admin' || role === 'editor';

  // Reviewer feedback state
  const [submission, setSubmission] = useState(null);
  const [submissionChecked, setSubmissionChecked] = useState(false);

  // Scroll container ref for the TOC intersection observer
  const scrollRef = useRef(null);

  // Local graph panel
  const [showGraph, setShowGraph]       = useState(false);
  const [graphData, setGraphData]       = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [localDepth, setLocalDepth]     = useState(1);

  const handleToggleGraph = useCallback(() => {
    if (!showGraph && !graphData && !graphLoading) {
      setGraphLoading(true);
      fetch('/api/graph')
        .then((r) => r.json())
        .then(setGraphData)
        .finally(() => setGraphLoading(false));
    }
    setShowGraph((v) => !v);
  }, [showGraph, graphData, graphLoading]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setMode('preview');
    setDirty(false);
    setSubmission(null);
    setSubmissionChecked(false);
    fetchDocument(id)
      .then((data) => {
        if (!data) {
          setError('Document not found.');
          return;
        }
        setDoc(data);
        setContent(data.content ?? '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // For reviewer: check for an existing submission when doc is loaded
  useEffect(() => {
    if (role !== 'reviewer' || !id || !user) return;
    let cancelled = false;
    async function checkSubmission() {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/submissions?documentId=${encodeURIComponent(id)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setSubmission(data);
        }
      } catch {
        // no existing submission is fine
      } finally {
        if (!cancelled) setSubmissionChecked(true);
      }
    }
    checkSubmission();
    return () => { cancelled = true; };
  }, [role, id, user]);

  const handleSave = useCallback(async () => {
    if (!doc || saving) return;
    setSaving(true);
    try {
      await saveDocument(id, content, user.uid);
      setDoc((prev) => ({ ...prev, content }));
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }, [doc, saving, id, content, user]);

  const handleDelete = useCallback(async () => {
    if (!doc || deleting) return;
    if (!window.confirm(`Delete "${doc.title}"? It will be moved to the Drive trash.`)) return;
    setDeleting(true);
    try {
      await deleteDocument(id);
      refreshDocuments?.();
      navigate('/graph', { replace: true });
    } catch (e) {
      setError('Delete failed: ' + e.message);
      setDeleting(false);
    }
  }, [doc, deleting, id, navigate, refreshDocuments]);

  // Cmd+S / Ctrl+S to save while editing
  useEffect(() => {
    if (mode !== 'edit') return;
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, handleSave]);

  if (loading) {
    return (
      <div className="file-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="file-error">
        <p>{error}</p>
        <button onClick={() => navigate(-1)}>← Go back</button>
      </div>
    );
  }

  const fm = doc?.frontMatter ?? {};

  return (
    <div className="file-page">
      {/* Warm-up question — reviewer only, shown until submission is complete */}
      {role === 'reviewer' && submissionChecked && submission?.status !== 'complete' && (
        <WarmupQuestion
          documentId={id}
          user={user}
          submission={submission}
          onSubmitted={setSubmission}
        />
      )}

      {/* Top bar */}
      <div className="file-topbar">
        <div className="file-topbar-left">
          <h1 className="file-title">{doc?.title}</h1>
          <div className="file-meta-pills">
            {fm.week != null && (
              <span className="meta-pill">Week {fm.week}</span>
            )}
            {fm.type && (
              <span className="meta-pill meta-pill--type">{fm.type}</span>
            )}
            {fm.category && (
              <span className="meta-pill">{fm.category}</span>
            )}
            {fm.tags?.map((tag) => (
              <span key={tag} className="meta-pill meta-pill--tag">{tag}</span>
            ))}
          </div>
        </div>

        {canEdit && !readOnly && (
          <div className="file-topbar-actions">
            {mode === 'edit' && dirty && (
              <span className="unsaved-dot" title="Unsaved changes" />
            )}
            <div className="mode-toggle">
              <button
                className={`mode-btn ${mode === 'preview' ? 'active' : ''}`}
                onClick={() => setMode('preview')}
              >
                Preview
              </button>
              <button
                className={`mode-btn ${mode === 'edit' ? 'active' : ''}`}
                onClick={() => setMode('edit')}
              >
                Edit
              </button>
            </div>
            {mode === 'edit' && (
              <button
                className={`save-btn${saved ? ' saved' : ''}`}
                onClick={handleSave}
                disabled={saving || !dirty}
                title="Save (⌘S)"
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
              </button>
            )}
            <button
              className="delete-btn"
              onClick={handleDelete}
              disabled={deleting}
              title="Move to trash"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
        {readOnly && (
          <span className="readonly-badge">Read-only</span>
        )}
        {canEdit && (
          <div className="file-export-actions">
            <button
              className="export-btn"
              onClick={() => window.print()}
              title="Print document"
            >
              ⎙ Print
            </button>
            <button
              className="export-btn"
              onClick={() => window.print()}
              title="Download as PDF via print dialog"
            >
              ↓ PDF
            </button>
          </div>
        )}
        <button
          className={`graph-toggle-btn${showGraph ? ' active' : ''}`}
          onClick={handleToggleGraph}
          title="Toggle local graph"
        >
          ⬡ Graph
        </button>
      </div>

      {/* Local graph panel */}
      {showGraph && (
        <div className="local-graph-panel">
          <div className="local-graph-toolbar">
            <span className="local-graph-label">Local Graph</span>
            <div className="local-depth-btns">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  className={`depth-btn${localDepth === d ? ' active' : ''}`}
                  onClick={() => setLocalDepth(d)}
                >{d}</button>
              ))}
            </div>
            <button className="local-graph-close" onClick={() => setShowGraph(false)}>✕</button>
          </div>
          <div className="local-graph-canvas">
            {graphLoading ? (
              <div className="local-graph-loading"><div className="spinner" /></div>
            ) : graphData ? (
              <GraphView
                graphData={graphData}
                settings={{ ...DEFAULT_SETTINGS, showLabels: 'zoom', repelForce: -150, linkDistance: 80 }}
                localMode={{ centerNodeId: id, depth: localDepth }}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="file-body">
        {mode === 'preview' ? (
          <>
            <div className="file-content-scroll" ref={scrollRef}>
              <div className="markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={headingComponents}
                >
                  {content}
                </ReactMarkdown>
              </div>
            </div>
            <TableOfContents content={content} scrollRef={scrollRef} />
          </>
        ) : (
          <RichTextEditor
            key={id}
            initialContent={splitFrontmatter(content).body}
            onChange={(newBody) => {
              setContent((prev) => {
                const { frontmatter } = splitFrontmatter(prev);
                return frontmatter ? frontmatter + '\n' + newBody : newBody;
              });
              setDirty(true);
            }}
          />
        )}
      </div>

      {/* Post-reading feedback form — reviewer only, shown after warm-up */}
      {role === 'reviewer' && submission?.status === 'draft' && (
        <FeedbackForm
          documentId={id}
          user={user}
          submission={submission}
          onSubmitted={setSubmission}
        />
      )}
    </div>
  );
}
