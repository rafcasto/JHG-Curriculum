import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './FeedbackDashboard.css';

// ── Constants ─────────────────────────────────────────────────────────────

const WARMUP_LABELS = {
  1: '🌱 Beginner',
  2: '📖 Some exposure',
  3: '💪 Fairly confident',
  4: '🎯 Expert',
};

const SCORE_CLASS = (score) => {
  if (score == null) return 'fd-score--none';
  if (score >= 85) return 'fd-score--excellent';
  if (score >= 70) return 'fd-score--good';
  if (score >= 55) return 'fd-score--needsWork';
  return 'fd-score--rethink';
};

const SCORE_CHIP_CLASS = (score) => {
  if (score == null) return '';
  if (score >= 85) return 'fd-chip--score';
  if (score >= 70) return 'fd-chip--score-good';
  if (score >= 55) return 'fd-chip--score-warn';
  return 'fd-chip--score-bad';
};

const DELTA_CLASS = (delta) => {
  if (delta == null) return 'fd-delta--zero';
  if (delta > 0) return 'fd-delta--positive';
  if (delta < 0) return 'fd-delta--negative';
  return 'fd-delta--zero';
};

function fmt(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

function fmtDelta(n) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n).toFixed(1);
  return n > 0 ? `+${v}` : v;
}

function formatDate(ts) {
  if (!ts) return '—';
  // Firestore Timestamp or ISO string
  const ms = ts?.seconds ? ts.seconds * 1000 : typeof ts === 'string' ? Date.parse(ts) : Number(ts);
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDuration(secs) {
  if (secs == null) return null;
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

const STORAGE_KEY = 'fd_visible_question_cols';

// ── Column Picker ─────────────────────────────────────────────────────────

function ColumnPicker({ ratingQuestions, visibleCols, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="fd-col-picker" ref={ref}>
      <button
        className={`fd-col-picker-btn${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        Columns
        <span className="fd-chevron">▼</span>
      </button>
      {open && (
        <div className="fd-col-picker-dropdown">
          <div className="fd-col-picker-header">Rating questions</div>
          {ratingQuestions.length === 0 && (
            <p style={{ padding: '0.5rem 0.875rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>
              No rating questions found
            </p>
          )}
          {ratingQuestions.map((q) => (
            <label key={q.id} className="fd-col-picker-item">
              <input
                type="checkbox"
                checked={visibleCols.includes(q.id)}
                onChange={() => onToggle(q.id)}
              />
              <span className="fd-col-picker-label">{q.text}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Submission body (expanded detail) ────────────────────────────────────

function SubmissionBody({ submission }) {
  const { warmupAnswer, questionsSnapshot = [], responses = {}, reviewDuration } = submission;

  const preQuestions = questionsSnapshot.filter((q) => q.touchpoint === 'pre');
  const postRating = questionsSnapshot.filter(
    (q) => q.touchpoint === 'post' && (q.type === 'scale' || q.type === 'star_rating' || q.type === 'single_choice')
  );
  const postOpen = questionsSnapshot.filter((q) => q.touchpoint === 'post' && q.type === 'open_text');

  function renderRaw(q) {
    const r = responses[q.id];
    const raw = r?.raw ?? r;
    if (raw == null || raw === '') return '—';
    if (q.type === 'scale' || q.type === 'star_rating') {
      const max = q.scaleMax ?? 5;
      return `${raw} / ${max}`;
    }
    if (q.type === 'single_choice') {
      const opt = (q.options ?? []).find((o) => o.value === raw || o.value === Number(raw));
      return opt ? opt.label : String(raw);
    }
    return String(raw);
  }

  function getOpenText(q) {
    const r = responses[q.id];
    return r?.raw ?? r ?? null;
  }

  return (
    <div className="fd-submission-body">
      {/* Warmup */}
      <div>
        <div className="fd-qna-label">Pre-survey</div>
        <div className="fd-warmup-row">
          Familiarity: <span>{WARMUP_LABELS[warmupAnswer] ?? `Level ${warmupAnswer}`}</span>
        </div>
        {preQuestions.map((q) => {
          const raw = responses[q.id]?.raw ?? responses[q.id];
          if (raw == null) return null;
          const opt = (q.options ?? []).find((o) => o.value === raw || o.value === Number(raw));
          return (
            <div key={q.id} className="fd-qna-item">
              <span className="fd-qna-text">{q.text}</span>
              <span className="fd-qna-response">{opt ? opt.label : String(raw)}</span>
            </div>
          );
        })}
      </div>

      {/* Post — rating questions */}
      {postRating.length > 0 && (
        <div>
          <div className="fd-qna-label">Post-survey — ratings</div>
          <div className="fd-qna-group">
            {postRating.map((q) => (
              <div key={q.id} className="fd-qna-item">
                <span className="fd-qna-text">{q.text}</span>
                <span className="fd-qna-response">{renderRaw(q)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Post — open text */}
      {postOpen.length > 0 && (
        <div>
          <div className="fd-qna-label">Post-survey — open responses</div>
          {postOpen.map((q) => {
            const text = getOpenText(q);
            return (
              <div key={q.id} style={{ marginBottom: '0.5rem' }}>
                <div className="fd-qna-open-q">{q.text}</div>
                {text ? (
                  <div className="fd-qna-open">{text}</div>
                ) : (
                  <div className="fd-qna-open" style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    No response
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {reviewDuration != null && (
        <div className="fd-duration">Review duration: {formatDuration(reviewDuration)}</div>
      )}
    </div>
  );
}

// ── Submission card ───────────────────────────────────────────────────────

function SubmissionCard({ submission, userEmail }) {
  const [expanded, setExpanded] = useState(false);
  const { contentQualityScore, confidenceDelta, warmupAnswer, submittedAt } = submission;

  const scoreChipClass = SCORE_CHIP_CLASS(contentQualityScore);

  return (
    <div className="fd-submission-card">
      <div
        className="fd-submission-header"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        aria-expanded={expanded}
      >
        <span className={`fd-submission-toggle${expanded ? ' fd-submission-toggle--open' : ''}`}>▶</span>
        <div className="fd-submission-meta">
          <span className="fd-submission-user">{userEmail}</span>
          <span className="fd-submission-date">{formatDate(submittedAt)}</span>
        </div>
        <div className="fd-submission-chips">
          {warmupAnswer != null && (
            <span className="fd-chip fd-chip--warmup">{WARMUP_LABELS[warmupAnswer] ?? `Pre: ${warmupAnswer}`}</span>
          )}
          {contentQualityScore != null && (
            <span className={`fd-chip ${scoreChipClass}`}>CQS {Math.round(contentQualityScore)}</span>
          )}
          {confidenceDelta != null && (
            <span className={`fd-chip ${confidenceDelta >= 0 ? 'fd-chip--delta-pos' : 'fd-chip--delta-neg'}`}>
              Δ {fmtDelta(confidenceDelta)}
            </span>
          )}
        </div>
      </div>
      {expanded && <SubmissionBody submission={submission} />}
    </div>
  );
}

// ── Detail Panel (inline expansion below a document row) ─────────────────

function DetailPanel({ documentName, submissions, users, colSpan }) {
  const emailForUid = (uid) => users.find((u) => u.uid === uid)?.email ?? uid;
  const sorted = [...submissions].sort((a, b) => {
    const ta = a.submittedAt?.seconds ?? 0;
    const tb = b.submittedAt?.seconds ?? 0;
    return tb - ta;
  });

  return (
    <tr className="fd-detail-row">
      <td colSpan={colSpan}>
        <div className="fd-detail-panel">
          <p className="fd-detail-title">{sorted.length} submission{sorted.length !== 1 ? 's' : ''} — {documentName}</p>
          <div className="fd-submission-list">
            {sorted.map((s) => (
              <SubmissionCard key={s.id} submission={s} userEmail={emailForUid(s.userId)} />
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Main FeedbackDashboard ────────────────────────────────────────────────

/**
 * Props:
 *   getToken — () => Promise<string>  — firebase id token
 *   users    — [{ uid, email }]       — from AdminPage
 */
export default function FeedbackDashboard({ getToken, users }) {
  const [submissions, setSubmissions] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [docMap, setDocMap] = useState({}); // documentId -> title
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedDocId, setExpandedDocId] = useState(null);
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Load submissions + questions in parallel
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };

        const [subRes, qRes, filesRes] = await Promise.all([
          fetch('/api/submissions?admin=true', { headers }),
          fetch('/api/questions?touchpoint=post', { headers }),
          fetch('/api/files', { headers }),
        ]);

        const [subData, qData, filesData] = await Promise.all([
          subRes.json(),
          qRes.json(),
          filesRes.json(),
        ]);

        if (!subRes.ok) throw new Error(subData.error ?? 'Failed to load submissions');
        if (!qRes.ok) throw new Error(qData.error ?? 'Failed to load questions');

        if (!cancelled) {
          setSubmissions(subData);
          setQuestions(qData);

          // Build docId -> title map from files
          const map = {};
          if (Array.isArray(filesData)) {
            filesData.forEach((f) => { if (f.id) map[f.id] = f.title ?? f.id; });
          }
          setDocMap(map);

          // Auto-select all rating questions as visible if first load (no saved preference)
          const savedCols = (() => {
            try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
          })();
          if (savedCols === null) {
            const ratingIds = qData
              .filter((q) => q.type === 'scale' || q.type === 'star_rating')
              .map((q) => q.id);
            setVisibleCols(ratingIds);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(ratingIds));
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [getToken]);

  // Rating-type post questions (toggleable columns)
  const ratingQuestions = useMemo(
    () => questions.filter((q) => q.type === 'scale' || q.type === 'star_rating'),
    [questions]
  );

  function toggleCol(qId) {
    setVisibleCols((prev) => {
      const next = prev.includes(qId) ? prev.filter((id) => id !== qId) : [...prev, qId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  // Group submissions by documentId and compute per-document aggregates
  const docRows = useMemo(() => {
    const groups = {};
    for (const s of submissions) {
      if (!groups[s.documentId]) groups[s.documentId] = [];
      groups[s.documentId].push(s);
    }

    return Object.entries(groups).map(([docId, subs]) => {
      const count = subs.length;

      const avgCQS = (() => {
        const vals = subs.map((s) => s.contentQualityScore).filter((v) => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      })();

      const avgDelta = (() => {
        const vals = subs.map((s) => s.confidenceDelta).filter((v) => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      })();

      const avgWarmup = (() => {
        const vals = subs.map((s) => s.warmupAnswer).filter((v) => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      })();

      // Per-question average raw response (for rating questions)
      const questionAvgs = {};
      for (const q of ratingQuestions) {
        const vals = subs
          .map((s) => {
            const r = s.responses?.[q.id];
            const raw = r?.raw ?? r;
            return raw != null && raw !== '' ? Number(raw) : null;
          })
          .filter((v) => v != null && !isNaN(v));
        questionAvgs[q.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }

      return { docId, subs, count, avgCQS, avgDelta, avgWarmup, questionAvgs };
    }).sort((a, b) => (b.count - a.count));
  }, [submissions, ratingQuestions]);

  // Summary stats
  const totalSubmissions = submissions.length;
  const totalDocs = docRows.length;
  const overallAvgCQS = useMemo(() => {
    const vals = submissions.map((s) => s.contentQualityScore).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [submissions]);

  // Active visible rating questions (preserving question order)
  const activeCols = useMemo(
    () => ratingQuestions.filter((q) => visibleCols.includes(q.id)),
    [ratingQuestions, visibleCols]
  );

  // Total column count for colspan in detail rows
  const totalCols = 5 + activeCols.length; // doc name + count + CQS + delta + warmup + question cols

  if (loading) {
    return (
      <div className="fd-root">
        <div className="fd-loading"><div className="spinner" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fd-root">
        <div className="fd-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="fd-root">
      {/* Stats bar */}
      <div className="fd-stats-bar">
        <div className="fd-stat-card">
          <div className="fd-stat-label">Total Submissions</div>
          <div className="fd-stat-value fd-stat-value--accent">{totalSubmissions}</div>
        </div>
        <div className="fd-stat-card">
          <div className="fd-stat-label">Documents Reviewed</div>
          <div className="fd-stat-value">{totalDocs}</div>
        </div>
        <div className="fd-stat-card">
          <div className="fd-stat-label">Avg Quality Score</div>
          <div className={`fd-stat-value ${SCORE_CLASS(overallAvgCQS)}`}>
            {overallAvgCQS != null ? Math.round(overallAvgCQS) : '—'}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="fd-toolbar">
        <h2 className="fd-toolbar-title">By document</h2>
        <div className="fd-toolbar-right">
          <ColumnPicker
            ratingQuestions={ratingQuestions}
            visibleCols={visibleCols}
            onToggle={toggleCol}
          />
        </div>
      </div>

      {/* Document table */}
      {docRows.length === 0 ? (
        <div className="fd-empty">No completed submissions yet.</div>
      ) : (
        <div className="fd-table-wrap">
          <table className="fd-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Submissions</th>
                <th>Avg CQS</th>
                <th>Avg Δ Confidence</th>
                <th>Avg Pre-survey</th>
                {activeCols.map((q) => (
                  <th key={q.id} title={q.text}>{q.text.length > 28 ? q.text.slice(0, 26) + '…' : q.text}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docRows.map((row) => {
                const isExpanded = expandedDocId === row.docId;
                const docName = docMap[row.docId] ?? row.docId;

                return (
                  <>
                    <tr
                      key={row.docId}
                      className={isExpanded ? 'fd-row--selected' : ''}
                      onClick={() => setExpandedDocId(isExpanded ? null : row.docId)}
                    >
                      <td>
                        <span className="fd-doc-name-expand">
                          <span className={`fd-expand-icon${isExpanded ? ' fd-expand-icon--open' : ''}`}>▶</span>
                          <span className="fd-doc-name">{docName}</span>
                        </span>
                      </td>
                      <td className="fd-num">{row.count}</td>
                      <td className={`fd-score fd-num ${SCORE_CLASS(row.avgCQS)}`}>
                        {row.avgCQS != null ? Math.round(row.avgCQS) : <span className="fd-empty-cell">—</span>}
                      </td>
                      <td className={`fd-num ${DELTA_CLASS(row.avgDelta)}`}>
                        {fmtDelta(row.avgDelta)}
                      </td>
                      <td className="fd-num">
                        {row.avgWarmup != null ? fmt(row.avgWarmup) : <span className="fd-empty-cell">—</span>}
                      </td>
                      {activeCols.map((q) => (
                        <td key={q.id} className="fd-num">
                          {row.questionAvgs[q.id] != null
                            ? fmt(row.questionAvgs[q.id])
                            : <span className="fd-empty-cell">—</span>}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      <DetailPanel
                        key={`detail-${row.docId}`}
                        documentName={docName}
                        submissions={row.subs}
                        users={users}
                        colSpan={totalCols}
                      />
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
