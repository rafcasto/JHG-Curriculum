import { useState } from 'react';
import './WarmupQuestion.css';

const OPTIONS = [
  { emoji: '🌱', label: 'Complete beginner', description: "I'm starting from scratch", value: 1 },
  { emoji: '📖', label: 'Some exposure', description: "I've come across this before", value: 2 },
  { emoji: '💪', label: 'Fairly confident', description: 'I work with this regularly', value: 3 },
  { emoji: '🎯', label: 'Expert', description: 'I could teach this myself', value: 4 },
];

/**
 * Props:
 *   documentId   — Drive file ID of the document being reviewed
 *   user         — Firebase Auth user object (for getIdToken())
 *   submission   — existing submission object from Firestore (null if none)
 *   onSubmitted  — called with the new/updated submission object on success
 */
export default function WarmupQuestion({ documentId, user, submission, onSubmitted }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isDone = submission != null;
  const selectedValue = submission?.warmupAnswer ?? null;

  async function handleSelect(value) {
    if (isDone || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ documentId, warmupAnswer: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save warm-up');
      onSubmitted(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="warmup-container">
      <div className="warmup-card">
        <div className="warmup-header">
          <span className="warmup-badge">Before you dive in</span>
          <p className="warmup-question">
            How familiar are you with this topic?
          </p>
        </div>

        <div className={`warmup-options${isDone ? ' warmup-options--done' : ''}`}>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`warmup-option${selectedValue === opt.value ? ' selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
              disabled={isDone || submitting}
            >
              <span className="warmup-emoji" aria-hidden="true">{opt.emoji}</span>
              <div className="warmup-option-text">
                <span className="warmup-option-label">{opt.label}</span>
                <span className="warmup-option-desc">{opt.description}</span>
              </div>
              {selectedValue === opt.value && <span className="warmup-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>

        {isDone && !error && (
          <p className="warmup-done-msg">
            Got it! Read through the material and share your feedback below when you're done.
          </p>
        )}
        {error && <p className="warmup-error">{error}</p>}
      </div>
    </div>
  );
}
