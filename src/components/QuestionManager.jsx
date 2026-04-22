import { useState, useEffect, useCallback } from 'react';
import './QuestionManager.css';

const TYPE_LABELS = {
  scale: 'Scale',
  single_choice: 'Choice',
  open_text: 'Open Text',
  star_rating: 'Stars',
};

const TOUCHPOINT_LABELS = { pre: 'Warm-up', post: 'Feedback' };

const BLANK_FORM = {
  text: '',
  type: 'scale',
  touchpoint: 'post',
  order: 10,
  scaleMin: 1,
  scaleMax: 5,
  scaleAnchorMin: '',
  scaleAnchorMax: '',
  options: [{ label: '', value: '' }],
  weight: 0,
  includedInScore: false,
  isOptional: false,
  active: true,
};

function OptionEditor({ options, onChange }) {
  function updateOption(i, field, value) {
    const next = options.map((o, idx) => (idx === i ? { ...o, [field]: value } : o));
    onChange(next);
  }
  function addOption() {
    onChange([...options, { label: '', value: '' }]);
  }
  function removeOption(i) {
    onChange(options.filter((_, idx) => idx !== i));
  }

  return (
    <div className="qm-options-editor">
      {options.map((opt, i) => (
        <div key={i} className="qm-option-row">
          <input
            className="qm-input"
            placeholder="Label"
            value={opt.label}
            onChange={(e) => updateOption(i, 'label', e.target.value)}
          />
          <input
            className="qm-input qm-input--sm"
            type="number"
            placeholder="Value"
            value={opt.value}
            onChange={(e) => updateOption(i, 'value', Number(e.target.value))}
          />
          <button className="qm-btn qm-btn--ghost" onClick={() => removeOption(i)} title="Remove">✕</button>
        </div>
      ))}
      <button className="qm-btn qm-btn--ghost qm-add-option" onClick={addOption}>+ Add option</button>
    </div>
  );
}

function QuestionForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() => {
    if (!initial) return { ...BLANK_FORM };
    return {
      text: initial.text ?? '',
      type: initial.type ?? 'scale',
      touchpoint: initial.touchpoint ?? 'post',
      order: initial.order ?? 10,
      scaleMin: initial.scaleMin ?? 1,
      scaleMax: initial.scaleMax ?? 5,
      scaleAnchorMin: initial.scaleAnchors?.min ?? '',
      scaleAnchorMax: initial.scaleAnchors?.max ?? '',
      options: initial.options?.length ? initial.options.map((o) => ({ label: o.label, value: o.value })) : [{ label: '', value: '' }],
      weight: initial.weight ?? 0,
      includedInScore: initial.includedInScore ?? false,
      isOptional: initial.isOptional ?? false,
      active: initial.active ?? true,
    };
  });

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const isScaleLike = form.type === 'scale' || form.type === 'star_rating';
  const isChoice = form.type === 'single_choice';

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      text: form.text.trim(),
      type: form.type,
      touchpoint: form.touchpoint,
      order: Number(form.order),
      weight: Number(form.weight),
      includedInScore: form.includedInScore,
      isOptional: form.isOptional,
      active: form.active,
      scaleMin: isScaleLike ? Number(form.scaleMin) : null,
      scaleMax: isScaleLike ? Number(form.scaleMax) : null,
      scaleAnchors: isScaleLike ? { min: form.scaleAnchorMin, max: form.scaleAnchorMax } : { min: '', max: '' },
      options: isChoice
        ? form.options.filter((o) => o.label).map((o) => ({ label: o.label, value: Number(o.value) }))
        : [],
    };
    onSave(payload);
  }

  return (
    <form className="qm-form" onSubmit={handleSubmit}>
      <div className="qm-form-grid">
        <div className="qm-form-field qm-form-field--full">
          <label className="qm-label">Question text</label>
          <textarea
            className="qm-input qm-textarea"
            value={form.text}
            onChange={(e) => set('text', e.target.value)}
            required
            rows={2}
          />
        </div>

        <div className="qm-form-field">
          <label className="qm-label">Type</label>
          <select className="qm-input" value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="scale">Scale (1–N)</option>
            <option value="star_rating">Star rating</option>
            <option value="single_choice">Single choice</option>
            <option value="open_text">Open text</option>
          </select>
        </div>

        <div className="qm-form-field">
          <label className="qm-label">Touchpoint</label>
          <select className="qm-input" value={form.touchpoint} onChange={(e) => set('touchpoint', e.target.value)}>
            <option value="pre">Warm-up (pre)</option>
            <option value="post">Feedback (post)</option>
          </select>
        </div>

        <div className="qm-form-field">
          <label className="qm-label">Display order</label>
          <input className="qm-input qm-input--sm" type="number" min={0} value={form.order} onChange={(e) => set('order', e.target.value)} />
        </div>

        {isScaleLike && (
          <>
            <div className="qm-form-field">
              <label className="qm-label">Min value</label>
              <input className="qm-input qm-input--sm" type="number" value={form.scaleMin} onChange={(e) => set('scaleMin', e.target.value)} />
            </div>
            <div className="qm-form-field">
              <label className="qm-label">Max value</label>
              <input className="qm-input qm-input--sm" type="number" value={form.scaleMax} onChange={(e) => set('scaleMax', e.target.value)} />
            </div>
            <div className="qm-form-field">
              <label className="qm-label">Min anchor label</label>
              <input className="qm-input" value={form.scaleAnchorMin} onChange={(e) => set('scaleAnchorMin', e.target.value)} placeholder="e.g. Not at all" />
            </div>
            <div className="qm-form-field">
              <label className="qm-label">Max anchor label</label>
              <input className="qm-input" value={form.scaleAnchorMax} onChange={(e) => set('scaleAnchorMax', e.target.value)} placeholder="e.g. Very confident" />
            </div>
          </>
        )}

        {isChoice && (
          <div className="qm-form-field qm-form-field--full">
            <label className="qm-label">Options <span className="qm-hint">(label visible to user; value used in scoring)</span></label>
            <OptionEditor options={form.options} onChange={(opts) => set('options', opts)} />
          </div>
        )}

        <div className="qm-form-field">
          <label className="qm-label">Score weight <span className="qm-hint">(weights should sum to 1.0)</span></label>
          <input className="qm-input qm-input--sm" type="number" step="0.05" min={0} max={1} value={form.weight} onChange={(e) => set('weight', e.target.value)} />
        </div>

        <div className="qm-form-field qm-form-field--checks">
          <label className="qm-checkbox-label">
            <input type="checkbox" checked={form.includedInScore} onChange={(e) => set('includedInScore', e.target.checked)} />
            Included in score
          </label>
          <label className="qm-checkbox-label">
            <input type="checkbox" checked={form.isOptional} onChange={(e) => set('isOptional', e.target.checked)} />
            Optional
          </label>
          <label className="qm-checkbox-label">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            Active
          </label>
        </div>
      </div>

      <div className="qm-form-actions">
        <button className="qm-btn qm-btn--primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Update question' : 'Add question'}
        </button>
        <button className="qm-btn qm-btn--ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function QuestionRow({ question, isFirst, isLast, onReorder, onToggleActive, onEdit, onDelete }) {
  return (
    <div className={`qm-row${!question.active ? ' qm-row--inactive' : ''}`}>
      <div className="qm-row-order">
        <button className="qm-icon-btn" disabled={isFirst} onClick={() => onReorder(question, -1)} title="Move up">↑</button>
        <button className="qm-icon-btn" disabled={isLast} onClick={() => onReorder(question, 1)} title="Move down">↓</button>
      </div>
      <div className="qm-row-main">
        <p className="qm-row-text">{question.text}</p>
        <div className="qm-row-meta">
          <span className={`qm-badge qm-badge--type qm-badge--${question.type}`}>{TYPE_LABELS[question.type] ?? question.type}</span>
          <span className="qm-badge qm-badge--touchpoint">{TOUCHPOINT_LABELS[question.touchpoint] ?? question.touchpoint}</span>
          {question.includedInScore && (
            <span className="qm-badge qm-badge--weight">w: {question.weight}</span>
          )}
          {question.isOptional && <span className="qm-badge qm-badge--optional">optional</span>}
        </div>
      </div>
      <div className="qm-row-actions">
        <button
          className={`qm-toggle${question.active ? ' active' : ''}`}
          onClick={() => onToggleActive(question)}
          title={question.active ? 'Deactivate' : 'Activate'}
        >
          {question.active ? 'On' : 'Off'}
        </button>
        <button className="qm-icon-btn" onClick={() => onEdit(question)} title="Edit">✎</button>
        <button className="qm-icon-btn qm-icon-btn--danger" onClick={() => onDelete(question)} title="Delete">✕</button>
      </div>
    </div>
  );
}

export default function QuestionManager({ getToken }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/questions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      setQuestions(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { fetchQuestions(); }, [fetchQuestions]);

  async function handleSave(payload) {
    setSaving(true);
    try {
      const token = await getToken();
      const isEdit = !!editingQuestion;
      const url = isEdit ? `/api/questions?id=${encodeURIComponent(editingQuestion.id)}` : '/api/questions';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      setShowForm(false);
      setEditingQuestion(null);
      await fetchQuestions();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(question) {
    if (!window.confirm(`Delete question "${question.text.slice(0, 60)}…"?`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/questions?id=${encodeURIComponent(question.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      await fetchQuestions();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleToggleActive(question) {
    try {
      const token = await getToken();
      const res = await fetch(`/api/questions?id=${encodeURIComponent(question.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ active: !question.active }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Update failed');
      await fetchQuestions();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleReorder(question, direction) {
    const sorted = [...questions].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((q) => q.id === question.id);
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;

    const swap = sorted[targetIdx];
    const newOrder = swap.order;
    const swapOrder = question.order;

    try {
      const token = await getToken();
      await Promise.all([
        fetch(`/api/questions?id=${encodeURIComponent(question.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ order: newOrder }),
        }),
        fetch(`/api/questions?id=${encodeURIComponent(swap.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ order: swapOrder }),
        }),
      ]);
      await fetchQuestions();
    } catch (e) {
      setError(e.message);
    }
  }

  function openAdd() {
    setEditingQuestion(null);
    setShowForm(true);
  }

  function openEdit(question) {
    setEditingQuestion(question);
    setShowForm(true);
  }

  const sorted = [...questions].sort((a, b) => a.order - b.order);
  const preQuestions = sorted.filter((q) => q.touchpoint === 'pre');
  const postQuestions = sorted.filter((q) => q.touchpoint === 'post');

  return (
    <section className="admin-section qm-section">
      <div className="qm-header">
        <h2 className="admin-section-title" style={{ margin: 0 }}>Questions</h2>
        <button className="qm-btn qm-btn--primary" onClick={openAdd}>+ Add question</button>
      </div>

      {error && <p className="qm-error">{error}</p>}

      {showForm && (
        <div className="qm-form-wrap">
          <h3 className="qm-form-title">{editingQuestion ? 'Edit question' : 'New question'}</h3>
          <QuestionForm
            initial={editingQuestion}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingQuestion(null); }}
            saving={saving}
          />
        </div>
      )}

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : questions.length === 0 ? (
        <p className="admin-empty-msg">No questions yet. Add one above or run the seed script.</p>
      ) : (
        <>
          {preQuestions.length > 0 && (
            <div className="qm-group">
              <h3 className="qm-group-title">Warm-up (pre-reading)</h3>
              {preQuestions.map((q, i) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  isFirst={i === 0}
                  isLast={i === preQuestions.length - 1}
                  onReorder={handleReorder}
                  onToggleActive={handleToggleActive}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
          {postQuestions.length > 0 && (
            <div className="qm-group">
              <h3 className="qm-group-title">Feedback form (post-reading)</h3>
              {postQuestions.map((q, i) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  isFirst={i === 0}
                  isLast={i === postQuestions.length - 1}
                  onReorder={handleReorder}
                  onToggleActive={handleToggleActive}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
