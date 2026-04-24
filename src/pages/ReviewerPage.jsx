import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeCollapsibleHeadings from '../utils/rehypeCollapsibleHeadings';
import { getOrderedDocuments, getLockedDocumentIds } from '../utils/reviewOrder';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import './ReviewerPage.css';
import './FilePage.css';

// ── Shared markdown rendering helpers (mirrors FilePage) ─────────────────────
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
}

function makeHeading(Tag) {
  return function Heading({ children, ...props }) {
    const text =
      typeof children === 'string'
        ? children
        : Array.isArray(children)
        ? children.map((c) => (typeof c === 'string' ? c : '')).join('')
        : '';
    return <Tag id={slugify(text)} {...props}>{children}</Tag>;
  };
}

function PreWithCopy({ node, children, ...props }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    let text = '';
    try {
      const codeNode = node?.children?.find(
        (c) => c.type === 'element' && c.tagName === 'code'
      );
      text = (codeNode?.children ?? [])
        .map((c) => (c.type === 'text' ? c.value : (c.children ?? []).map((cc) => cc.value ?? '').join('')))
        .join('');
    } catch (_) {}
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
  const firstP = node?.children?.find(
    (c) => c.type === 'element' && c.tagName === 'p'
  );
  const firstText = firstP?.children?.[0];
  if (firstText?.type === 'text') {
    const match = firstText.value.match(
      /^\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|IMPORTANT|SUCCESS)\][ \t]*(.*)/i
    );
    if (match) {
      const type = match[1].toLowerCase();
      const inlineTitle = match[2].trim();
      const meta = CALLOUT_TYPES[type] ?? { icon: 'ℹ', label: match[1] };
      const title = inlineTitle || meta.label;
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

function splitFrontmatter(raw = '') {
  if (!raw.startsWith('---')) return { body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { body: raw };
  return { body: raw.slice(end + 4).replace(/^\n/, '') };
}

const markdownComponents = {
  h1: makeHeading('h1'),
  h2: makeHeading('h2'),
  h3: makeHeading('h3'),
  pre: PreWithCopy,
  blockquote: Callout,
};

function getFolder(doc) {
  const path = doc.drivePath ?? '';
  if (!path) return '(uncategorized)';
  const first = path.split('/')[0].trim();
  return first || '(uncategorized)';
}

export default function ReviewerPage() {
  const { reviewDocs = [], reviewLoading = false, reviewSubmissions = {} } = useOutletContext() ?? {};
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();

  const enforceSequential = currentWorkspace?.enforceSequentialReview ?? false;

  const lockedIds = useMemo(() => {
    if (!enforceSequential) return new Set();
    const ordered = getOrderedDocuments(reviewDocs);
    return getLockedDocumentIds(ordered, reviewSubmissions);
  }, [enforceSequential, reviewDocs, reviewSubmissions]);

  function handleContinue() {
    const ordered = getOrderedDocuments(reviewDocs);
    if (ordered.length === 0) return;
    const target =
      ordered.find((d) => !lockedIds.has(d.driveFileId) && reviewSubmissions[d.driveFileId]?.status !== 'complete') ||
      ordered.find((d) => !lockedIds.has(d.driveFileId)) ||
      ordered[0];
    navigate(`/file/${target.driveFileId}`);
  }

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
        <div className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeCollapsibleHeadings]}
            components={markdownComponents}
          >
            {splitFrontmatter(instructionContent).body}
          </ReactMarkdown>
        </div>
        {reviewDocs.length > 0 && (
          <div className="rv-continue-bar">
            <button className="rv-continue-btn" onClick={handleContinue}>
              Continue →
            </button>
          </div>
        )}
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
            {files.map((doc) => {
              const isLocked = enforceSequential && lockedIds.has(doc.driveFileId);
              const sub = reviewSubmissions[doc.driveFileId];
              const isFrontier = enforceSequential && !isLocked && sub?.status !== 'complete';
              return (
                <li key={doc.id}>
                  <button
                    className={`rv-toc-file-link${isLocked ? ' rv-toc-file-link--locked' : ''}`}
                    onClick={() => !isLocked && navigate(`/file/${doc.driveFileId}`)}
                    disabled={isLocked}
                    title={isLocked ? 'Complete the previous document first' : undefined}
                  >
                    {isLocked && <span className="rv-toc-lock" aria-hidden="true">🔒</span>}
                    {isFrontier && <span className="rv-toc-lock" aria-hidden="true">🔓</span>}
                    {doc.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="rv-continue-bar">
        <button
          className="rv-continue-btn"
          onClick={handleContinue}
          disabled={reviewDocs.length === 0}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

