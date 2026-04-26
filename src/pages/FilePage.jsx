import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import MonacoEditor from '@monaco-editor/react';
import remarkGfm from 'remark-gfm';
import rehypeCollapsibleHeadings from '../utils/rehypeCollapsibleHeadings';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { fetchDocument, saveDocument, deleteDocument } from '../hooks/useDocuments';
import { getOrderedDocuments, getLockedDocumentIds } from '../utils/reviewOrder';
import RichTextEditor from '../components/RichTextEditor';
import GraphView, { DEFAULT_SETTINGS } from '../components/GraphView';
import TableOfContents from '../components/TableOfContents';
import PreSurveyModal from '../components/PreSurveyModal';
import PostSurveyModal from '../components/PostSurveyModal';
import { doc as firestoreDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
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

/** Code block wrapper with a copy-to-clipboard button. */
function PreWithCopy({ node, children, ...props }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    // Extract raw text from the HAST node to avoid pulling from highlighted spans
    let text = '';
    try {
      const codeNode = node?.children?.find(
        (c) => c.type === 'element' && c.tagName === 'code'
      );
      text = (codeNode?.children ?? [])
        .map((c) => (c.type === 'text' ? c.value : (c.children ?? []).map((cc) => cc.value ?? '').join('')))
        .join('');
    } catch (_) {
      // fallback: get text from DOM via the pre element
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="code-copy-wrapper">
      <pre {...props}>{children}</pre>
      <button
        className={`code-copy-btn${copied ? ' copied' : ''}`}
        onClick={handleCopy}
        aria-label="Copy code"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

/** Callout block renderer — detects > [!TYPE] Title syntax. */
const CALLOUT_TYPES = {
  note:      { icon: 'ℹ', label: 'Note' },
  info:      { icon: 'ℹ', label: 'Info' },
  tip:       { icon: '💡', label: 'Tip' },
  warning:   { icon: '⚠', label: 'Warning' },
  caution:   { icon: '⚠', label: 'Caution' },
  danger:    { icon: '⚡', label: 'Danger' },
  important: { icon: '📌', label: 'Important' },
  success:   { icon: '✓', label: 'Success' },
};

function Callout({ node, children, ...props }) {
  // Find the first paragraph child in the HAST node
  const firstP = node?.children?.find(
    (c) => c.type === 'element' && c.tagName === 'p'
  );
  const firstText = firstP?.children?.[0];

  if (firstText?.type === 'text') {
    const match = firstText.value.match(/^\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|IMPORTANT|SUCCESS)\][ \t]*(.*)/i);
    if (match) {
      const type = match[1].toLowerCase();
      const inlineTitle = match[2].trim();
      const meta = CALLOUT_TYPES[type] ?? { icon: 'ℹ', label: match[1] };
      const title = inlineTitle || meta.label;

      // Strip the [!TYPE] marker line from rendered children
      // children[0] is the first <p>; we replace its text
      const bodyChildren = children ? [...children] : [];

      return (
        <div className={`callout callout-${type}`}>
          <div className="callout-title">
            <span className="callout-icon" aria-hidden="true">{meta.icon}</span>
            <span>{title}</span>
          </div>
          <div className="callout-body">{bodyChildren}</div>
        </div>
      );
    }
  }

  return <blockquote {...props}>{children}</blockquote>;
}

const headingComponents = {
  h1: makeHeading('h1'),
  h2: makeHeading('h2'),
  h3: makeHeading('h3'),
};

const markdownComponents = {
  ...headingComponents,
  pre: PreWithCopy,
  blockquote: Callout,
};

const STALE_LOCK_MS = 30 * 60 * 1000; // 30 minutes — lock is considered stale after this

/**
 * Strip Google-Docs-style backslash escapes (e.g. \# → #, \- → -) from
 * markdown while leaving code fences and inline code untouched.
 */
function preprocessMarkdown(body = '') {
  return body.replace(
    /(```[\s\S]*?```|`[^`\n]*`)|\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    (match, code, escaped) => (code !== undefined ? code : escaped)
  );
}

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
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? null;
  const { refreshDocuments, onReviewSubmissionUpdated, reviewDocs = [], reviewSubmissions = {} } = useOutletContext() ?? {};

  const [doc, setDoc] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [mode, setMode] = useState('preview'); // 'preview' | 'edit'
  const [editorMode, setEditorMode] = useState('wysiwyg'); // 'wysiwyg' | 'raw'
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Keep a ref to always have the latest content in save callbacks
  const contentRef = useRef('');
  useEffect(() => { contentRef.current = content; }, [content]);
  const readOnly = doc?.readOnly ?? false;
  const canEdit = role === 'admin' || role === 'editor';

  // Reviewer submission state
  const [submission, setSubmission] = useState(null);
  const [submissionChecked, setSubmissionChecked] = useState(false);
  const [hasPreQuestions, setHasPreQuestions] = useState(null); // null = loading

  // Reviewer modal state
  const [showPreSurveyModal, setShowPreSurveyModal] = useState(false);
  const [showPostSurveyModal, setShowPostSurveyModal] = useState(false);

  // Reviewer timer state
  const [reviewStartTime, setReviewStartTime] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [frozenDuration, setFrozenDuration] = useState(null);

  // Scroll container ref for the TOC intersection observer
  const scrollRef = useRef(null);
  // Flag: navigate to a path after post-survey submission (null = no pending nav)
  const pendingNavAfterSurveyRef = useRef(null);

  // Edit lock — real-time state of who currently holds edit access on this file
  const [lockInfo, setLockInfo] = useState(null);
  const lockOwnedRef = useRef(false); // true when this client holds the lock

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

  // Subscribe to this file's lock document in real-time (all roles)
  useEffect(() => {
    const lockDocRef = firestoreDoc(db, 'fileLocks', id);
    const unsub = onSnapshot(lockDocRef, (snap) => {
      setLockInfo(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [id]);

  // Release our lock when navigating away or when the file id changes
  useEffect(() => {
    const lockDocRef = firestoreDoc(db, 'fileLocks', id);
    return () => {
      if (lockOwnedRef.current) {
        lockOwnedRef.current = false;
        deleteDoc(lockDocRef).catch(() => {});
      }
    };
  }, [id]);

  const releaseLock = useCallback(async () => {
    if (!lockOwnedRef.current) return;
    lockOwnedRef.current = false;
    try { await deleteDoc(firestoreDoc(db, 'fileLocks', id)); } catch {}
  }, [id]);

  const handleEnterPreview = useCallback(async () => {
    await releaseLock();
    setMode('preview');
  }, [releaseLock]);

  const handleEnterEdit = useCallback(async () => {
    if (!user || !canEdit || readOnly) return;
    const lockDocRef = firestoreDoc(db, 'fileLocks', id);
    try {
      // lockInfo is already kept current by the onSnapshot listener — no extra read needed
      if (lockInfo) {
        const lock = lockInfo;
        if (lock.lockedBy !== user.uid) {
          const lockedAt = lock.lockedAt?.toDate?.() ?? null;
          const isStale = lockedAt ? (Date.now() - lockedAt.getTime()) > STALE_LOCK_MS : false;
          if (!isStale) return; // blocked — another user is actively editing
        }
      }
      await setDoc(lockDocRef, {
        lockedBy: user.uid,
        lockedByEmail: user.email ?? '',
        lockedAt: serverTimestamp(),
      });
      lockOwnedRef.current = true;
      setMode('edit');
    } catch {
      // Degrade gracefully on Firestore error — don't block editing
      setMode('edit');
    }
  }, [user, canEdit, readOnly, id]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setMode('preview');
    setEditorMode('wysiwyg');
    setDirty(false);
    setSubmission(null);
    setSubmissionChecked(false);
    setHasPreQuestions(null);
    setReviewStartTime(null);
    setElapsedSeconds(0);
    setFrozenDuration(null);
    setShowPreSurveyModal(false);
    setShowPostSurveyModal(false);
    pendingNavAfterSurveyRef.current = null;
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

  // For reviewer: check for an existing submission + whether pre-questions are active
  useEffect(() => {
    if (role !== 'reviewer' || !id || !user) return;
    let cancelled = false;
    async function checkSubmission() {
      try {
        const token = await user.getIdToken();
        const [subRes, preQRes] = await Promise.all([
          fetch(`/api/submissions?documentId=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/questions?touchpoint=pre&activeOnly=true' + (workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ''), {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (subRes.ok) {
          const data = await subRes.json();
          if (!cancelled) setSubmission(data);
        }
        if (preQRes.ok) {
          const preQs = await preQRes.json();
          if (!cancelled) setHasPreQuestions(preQs.length > 0);
        } else {
          if (!cancelled) setHasPreQuestions(false);
        }
      } catch {
        // no existing submission is fine
        if (!cancelled) setHasPreQuestions(false);
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
    setSaveError(null);
    try {
      const latestContent = contentRef.current;
      const token = await user.getIdToken();
      await saveDocument(id, latestContent, token);
      setDoc((prev) => ({ ...prev, content: latestContent }));
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e.message);
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setSaving(false);
    }
  }, [doc, saving, id, user]);

  const handleDelete = useCallback(async () => {
    if (!doc || deleting) return;
    if (!window.confirm(`Delete "${doc.title}"? It will be moved to the Drive trash.`)) return;
    setDeleting(true);
    try {
      const token = await user.getIdToken();
      await deleteDocument(id, token);
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

  // Reviewer: count up elapsed seconds while actively reviewing
  useEffect(() => {
    if (!reviewStartTime || submission?.status !== 'draft') return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - reviewStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [reviewStartTime, submission?.status]);

  // Reviewer helpers
  function formatTime(s) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  function handlePreSurveySubmitted(newSub) {
    setSubmission(newSub);
    setReviewStartTime(Date.now());
    setElapsedSeconds(0);
    setShowPreSurveyModal(false);
    onReviewSubmissionUpdated?.(id, newSub);
  }

  function handleStopReview() {
    setFrozenDuration(elapsedSeconds);
    setShowPostSurveyModal(true);
  }

  function handlePostSurveySubmitted(updatedSub) {
    setSubmission(updatedSub);
    setShowPostSurveyModal(false);
    onReviewSubmissionUpdated?.(id, updatedSub);
    if (pendingNavAfterSurveyRef.current) {
      const target = pendingNavAfterSurveyRef.current;
      pendingNavAfterSurveyRef.current = null;
      navigate(target);
    }
  }

  // Derived reviewer flags (computed after all hooks)
  const isUnreviewed   = role === 'reviewer' && submissionChecked && !submission;
  const isReviewing    = role === 'reviewer' && submission?.status === 'draft';
  const isReviewComplete = role === 'reviewer' && submission?.status === 'complete';

  // Sequential review: is this document locked?
  const isLocked = useMemo(() => {
    if (role !== 'reviewer') return false;
    if (!currentWorkspace?.enforceSequentialReview) return false;
    const ordered = getOrderedDocuments(reviewDocs);
    const lockedIds = getLockedDocumentIds(ordered, reviewSubmissions);
    return lockedIds.has(id);
  }, [role, currentWorkspace, reviewDocs, reviewSubmissions, id]);

  // Reviewer document navigation
  const orderedDocs = useMemo(
    () => (role === 'reviewer' ? getOrderedDocuments(reviewDocs) : []),
    [role, reviewDocs]
  );
  const currentDocIndex = orderedDocs.findIndex((d) => d.driveFileId === id);
  const prevDoc = currentDocIndex > 0 ? orderedDocs[currentDocIndex - 1] : null;
  const nextDoc =
    currentDocIndex > -1 && currentDocIndex < orderedDocs.length - 1
      ? orderedDocs[currentDocIndex + 1]
      : null;
  const isLastDoc = currentDocIndex > -1 && currentDocIndex === orderedDocs.length - 1;

  function handlePrev() {
    if (prevDoc) navigate(`/file/${prevDoc.driveFileId}`);
  }

  function handleContinue() {
    if (isLastDoc) {
      if (isReviewComplete) {
        navigate('/reviewer');
      } else if (isReviewing) {
        pendingNavAfterSurveyRef.current = '/reviewer';
        handleStopReview();
      }
      // isUnreviewed on last doc: button is disabled
    } else if (nextDoc) {
      if (isReviewComplete) {
        // Already completed — skip survey, just navigate
        navigate(`/file/${nextDoc.driveFileId}`);
      } else if (isReviewing) {
        // Trigger post-survey; navigate to next doc after survey is submitted
        pendingNavAfterSurveyRef.current = `/file/${nextDoc.driveFileId}`;
        handleStopReview();
      }
      // isUnreviewed: button is disabled, unreachable
    }
  }

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
      {/* Sequential review lock banner */}
      {isLocked && (
        <div className="fp-locked-banner">
          <span className="fp-locked-icon" aria-hidden="true">🔒</span>
          <span className="fp-locked-msg">
            This document is locked. Complete the previous document in the sequence to unlock it.
          </span>
          <button className="fp-locked-back" onClick={() => navigate('/reviewer')}>
            ← Back to documents
          </button>
        </div>
      )}
      {/* Pre-survey modal — reviewer only, gate before reading */}
      {showPreSurveyModal && (
        <PreSurveyModal
          documentId={id}
          user={user}
          submission={null}
          onSubmitted={handlePreSurveySubmitted}
        />
      )}

      {/* Post-survey modal — reviewer only, shown when Stop is clicked */}
      {showPostSurveyModal && (
        <PostSurveyModal
          documentId={id}
          user={user}
          submission={submission}
          reviewDuration={frozenDuration ?? elapsedSeconds}
          onSubmitted={handlePostSurveySubmitted}
          onClose={() => setShowPostSurveyModal(false)}
          workspaceId={workspaceId}
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
              Array.isArray(fm.category)
                ? fm.category.map((c) => <span key={c} className="meta-pill">{c}</span>)
                : <span className="meta-pill">{fm.category}</span>
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
                onClick={handleEnterPreview}
              >
                Preview
              </button>
              <button
                className={`mode-btn ${mode === 'edit' ? 'active' : ''}`}
                onClick={handleEnterEdit}
                disabled={!!(lockInfo && user && lockInfo.lockedBy !== user.uid)}
                title={
                  lockInfo && user && lockInfo.lockedBy !== user.uid
                    ? `Locked by ${lockInfo.lockedByEmail || 'another user'}`
                    : 'Edit (⌘E)'
                }
              >
                Edit
              </button>
            </div>
            {mode === 'edit' && (
              <div className="mode-toggle editor-mode-toggle">
                <button
                  className={`mode-btn ${editorMode === 'wysiwyg' ? 'active' : ''}`}
                  onClick={() => setEditorMode('wysiwyg')}
                  title="WYSIWYG editor"
                >
                  WYSIWYG
                </button>
                <button
                  className={`mode-btn ${editorMode === 'raw' ? 'active' : ''}`}
                  onClick={() => setEditorMode('raw')}
                  title="Raw Markdown editor"
                >
                  Raw
                </button>
              </div>
            )}
            {lockInfo && user && lockInfo.lockedBy !== user.uid && (
              <span className="lock-notice">
                🔒 {lockInfo.lockedByEmail || 'Another user'} is editing
              </span>
            )}
            {mode === 'edit' && (
              <>
                <button
                  className={`save-btn${saved ? ' saved' : ''}`}
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  title="Save (⌘S)"
                >
                  {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
                </button>
                {saveError && (
                  <span className="save-error-msg" title={saveError}>
                    ✕ {saveError}
                  </span>
                )}
              </>
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
          <button
            className="export-btn"
            onClick={() => window.print()}
            title="Print document"
          >
            ⎙ Print
          </button>
        )}

        {/* Reviewer: badge when review is complete */}
        {isReviewComplete && (
          <span className="reviewer-done-badge">&#10003; Reviewed</span>
        )}

        {/* Graph toggle — hidden for reviewers */}
        {role !== 'reviewer' && (
          <button
            className={`graph-toggle-btn${showGraph ? ' active' : ''}`}
            onClick={handleToggleGraph}
            title="Toggle local graph"
          >
            ⬡ Graph
          </button>
        )}
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
        <div className={`file-content-wrapper${isUnreviewed ? ' file-content--blurred' : ''}`}>
          {mode === 'preview' ? (
            <>
              <div className="file-content-scroll" ref={scrollRef}>
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeCollapsibleHeadings]}
                    components={markdownComponents}
                    urlTransform={(url) => {
                      if (url.startsWith('data:image/')) return url;
                      return /^(https?:|mailto:|tel:|#|\/)/.test(url) ? url : '';
                    }}
                  >
                    {preprocessMarkdown(splitFrontmatter(content).body)}
                  </ReactMarkdown>
                </div>
              </div>
              {!isUnreviewed && <TableOfContents content={splitFrontmatter(content).body} scrollRef={scrollRef} />}
            </>
          ) : editorMode === 'wysiwyg' ? (
            <RichTextEditor
              key={`${id}-wysiwyg`}
              initialContent={splitFrontmatter(content).body}
              onChange={(newBody) => {
                setContent((prev) => {
                  const { frontmatter } = splitFrontmatter(prev);
                  return frontmatter ? frontmatter + '\n' + newBody : newBody;
                });
                setDirty(true);
              }}
            />
          ) : (
            <MonacoEditor
              language="markdown"
              value={splitFrontmatter(content).body}
              onChange={(val) => {
                setContent((prev) => {
                  const { frontmatter } = splitFrontmatter(prev);
                  return frontmatter ? frontmatter + '\n' + (val ?? '') : (val ?? '');
                });
                setDirty(true);
              }}
              theme="vs-dark"
              options={{
                wordWrap: 'on',
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                fontSize: 14,
              }}
              className="monaco-editor-wrapper"
            />
          )}

          {/* Blur overlay with "Start Review" CTA — shown to reviewers before they begin */}
          {isUnreviewed && (
            <div className="file-start-overlay">
              <button
                className="file-start-btn"
                disabled={hasPreQuestions === null}
                onClick={async () => {
                  if (hasPreQuestions) {
                    setShowPreSurveyModal(true);
                  } else {
                    // No active pre-questions — create draft submission directly
                    try {
                      const token = await user.getIdToken();
                      const res = await fetch('/api/submissions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ documentId: id }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error ?? 'Failed to start review');
                      handlePreSurveySubmitted(data);
                    } catch (e) {
                      setError(e.message);
                    }
                  }
                }}
              >
                Start Review
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reviewer prev / continue navigation bar */}
      {role === 'reviewer' && !isLocked && orderedDocs.length > 0 && (
        <div className="fp-reviewer-nav">
          <button
            className="fp-nav-btn fp-nav-btn--prev"
            onClick={handlePrev}
            disabled={!prevDoc}
          >
            ← Previous
          </button>
          {currentDocIndex > -1 && (
            <span className="fp-nav-position">
              {currentDocIndex + 1} / {orderedDocs.length}
            </span>
          )}
          {isLastDoc ? (
            isReviewComplete ? (
              <button
                className="fp-nav-btn fp-nav-btn--done"
                onClick={() => navigate('/reviewer')}
              >
                Back to overview
              </button>
            ) : (
              <button
                className="fp-nav-btn fp-nav-btn--complete"
                onClick={handleContinue}
                disabled={isUnreviewed}
                title={isUnreviewed ? 'Start the review first' : undefined}
              >
                Complete ✓
              </button>
            )
          ) : (
            <button
              className="fp-nav-btn fp-nav-btn--continue"
              onClick={handleContinue}
              disabled={isUnreviewed || !submissionChecked}
              title={isUnreviewed ? 'Start the review first' : undefined}
            >
              Continue →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
