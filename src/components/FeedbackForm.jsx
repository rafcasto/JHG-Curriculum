import { useState, useEffect } from 'react';
import './FeedbackForm.css';

const INTERPRETATION_META = {
  Excellent:    { color: '#3fb950', label: '85–100', note: 'Ready to publish' },
  Good:         { color: '#58a6ff', label: '70–84', note: 'Minor refinements needed' },
  'Needs Work': { color: '#e3b341', label: '55–69', note: 'Review feedback and revise' },
  Rethink:      { color: '#f85149', label: '< 55',  note: 'Significant issues to address' },
};

// ── Question renderers ────────────────────────────────────────────────────

function ScaleQuestion({ question, value, onChange }) {
  const min = question.scaleMin ?? 1;
  const max = question.scaleMax ?? 5;
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="ff-scale">
      <div className="ff-scale-buttons">
        {steps.map((n) => (
          <button
            key={n}
            type="button"
            className={`ff-scale-btn${value === n ? ' selected' : ''}`}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="ff-scale-anchors">
        {question.scaleAnchors?.min && <span>{question.scaleAnchors.min}</span>}
        {question.scaleAnchors?.max && <span>{question.scaleAnchors.max}</span>}
      </div>
    </div>
  );
}

function StarQuestion({ question, value, onChange }) {
  const max = question.scaleMax ?? 5;
  const [hovered, setHovered] = useState(null);
  const effective = hovered ?? value ?? 0;
  return (
    <div className="ff-stars">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={`ff-star${n <= effective ? ' active' : ''}`}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          aria-label={`${n} star${n !== 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
      {question.scaleAnchors?.min && question.scaleAnchors?.max && (
        <div className="ff-stars-anchors">
          <span>{question.scaleAnchors.min}</span>
          <span>{question.scaleAnchors.max}</span>
        </div>
      )}
    </div>
  );
}

function ChoiceQuestion({ question, value, onChange }) {
  return (
    <div className="ff-choices">
      {(question.options ?? []).map((opt) => (
        <label key={opt.value} className={`ff-choice${value === opt.value ? ' selected' : ''}`}>
          <input
            type="radio"
            name={question.id}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span className="ff-choice-label">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

function OpenTextQuestion({ question, value, onChange }) {
  return (
    <textarea
      className="ff-textarea"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder="Share your thoughts… (optional)"
      rows={3}
    />
  );
}

function QuestionBlock({ question, response, onChange }) {
  const required = !question.isOptional && question.type !== 'open_text';
  return (
    <div className="ff-question">
      <p className="ff-question-text">
        {question.text}
        {required && <span className="ff-required" aria-hidden="true"> *</span>}
        {question.isOptional && <span className="ff-optional"> (optional)</span>}
      </p>
      {question.type === 'scale' && (
        <ScaleQuestion question={question} value={response} onChange={onChange} />
      )}
      {question.type === 'star_rating' && (
        <StarQuestion question={question} value={response} onChange={onChange} />
      )}
      {question.type === 'single_choice' && (
        <ChoiceQuestion question={question} value={response} onChange={onChange} />
      )}
      {question.type === 'open_text' && (
        <OpenTextQuestion question={question} value={response} onChange={onChange} />
      )}
    </div>
  );
}

// ── Thank-you card ────────────────────────────────────────────────────────

function ThankYouCard({ submission }) {
  const score = submission?.contentQualityScore;
  const interp = submission?.interpretation ??
    (score != null
      ? score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 55 ? 'Needs Work' : 'Rethink'
      : null);
  const meta = interp ? INTERPRETATION_META[interp] : null;

  return (
    <div className="ff-container">
      <div className="ff-thankyou">
        <span className="ff-thankyou-icon" aria-hidden="true">✓</span>
        <h3 className="ff-thankyou-title">Thanks for your feedback!</h3>
        <p className="ff-thankyou-subtitle">Your response has been recorded and will help improve this material.</p>
        {score != null && meta && (
          <div className="ff-score-summary" style={{ '--score-color': meta.color }}>
            <span className="ff-score-value">{Math.round(score)}</span>
            <div className="ff-score-labels">
              <span className="ff-score-interp">{interp}</span>
              <span className="ff-score-note">{meta.note}</span>
            </div>
          </div>
        )}
        {submission?.confidenceDelta != null && (
          <p className="ff-delta">
            Confidence shift: {submission.confidenceDelta > 0 ? '+' : ''}{Math.round(submission.confidenceDelta * 10) / 10} points
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main FeedbackForm ─────────────────────────────────────────────────────

/**
 * Props:
 *   documentId     — Drive file ID
 *   user           — Firebase Auth user object
 *   submission     — existing submission object (must be status 'draft')
 *   reviewDuration — elapsed review time in seconds (optional)
 *   onSubmitted    — called with updated submission on successful submit
 */
export default function FeedbackForm({ documentId, user, submission, reviewDuration, onSubmitted }) {
  const [questions, setQuestions] = useState([]);
  const [responses, setResponses] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // If already complete, show thank-you card
  if (submission?.status === 'complete') {
    return <ThankYouCard submission={submission} />;
  }

  // Don't render until warm-up is done
  if (!submission || submission.status !== 'draft') return null;

  useEffect(() => {
    let cancelled = false;
    async function loadQuestions() {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/questions?touchpoint=post&activeOnly=true', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to load questions');
        const data = await res.json();
        if (!cancelled) setQuestions(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadQuestions();
    return () => { cancelled = true; };
  }, [user]);

  function setResponse(questionId, value) {
    setResponses((prev) => ({ ...prev, [questionId]: value }));
  }

  function validate() {
    for (const q of questions) {
      if (q.isOptional || q.type === 'open_text') continue;
      const r = responses[q.id];
      if (r === undefined || r === null) return `Please answer: "${q.text.slice(0, 60)}"`;
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setError(null);
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/submissions?id=${encodeURIComponent(submission.id ?? `${user.uid}_${documentId}`)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          responses,
          ...(typeof reviewDuration === 'number' ? { reviewDuration } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Submission failed');

      const updated = { ...submission, ...data };
      setResult(data);
      onSubmitted(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return <ThankYouCard submission={{ ...submission, ...result }} />;
  }

  return (
    <div className="ff-container">
      <div className="ff-header">
        <span className="ff-badge">Your feedback</span>
        <p className="ff-subtitle">A few quick questions — this takes about 2 minutes.</p>
      </div>

      {loading ? (
        <div className="ff-loading"><div className="spinner" /></div>
      ) : (
        <form className="ff-form" onSubmit={handleSubmit}>
          {questions.map((q) => (
            <QuestionBlock
              key={q.id}
              question={q}
              response={responses[q.id] ?? null}
              onChange={(val) => setResponse(q.id, val)}
            />
          ))}

          {error && <p className="ff-error">{error}</p>}

          <div className="ff-submit-wrap">
            <button className="ff-submit-btn" type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit feedback'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
