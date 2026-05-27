import { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './BadgeManager.css';

const MODULE_DEFS = [
  { key: '0. preparation', label: 'Preparation' },
  { key: '1. focus',        label: 'Focus' },
  { key: '2. value',        label: 'Value' },
  { key: '3. profile',      label: 'Profile' },
  { key: '4. applications', label: 'Applications' },
  { key: '5. network',      label: 'Network' },
  { key: '6. interviews',   label: 'Interviews' },
  { key: '7. deal',         label: 'Deal' },
];

const BLANK_FORM = {
  name: '',
  description: '',
  icon: '🏅',
  iconType: 'emoji',
  requiredModules: [],
};

function BadgeForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() =>
    initial
      ? {
          name: initial.name ?? '',
          description: initial.description ?? '',
          icon: initial.icon ?? '🏅',
          iconType: initial.iconType ?? 'emoji',
          requiredModules: initial.requiredModules ?? [],
        }
      : { ...BLANK_FORM }
  );

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  function toggleModule(key) {
    setForm((f) => ({
      ...f,
      requiredModules: f.requiredModules.includes(key)
        ? f.requiredModules.filter((k) => k !== key)
        : [...f.requiredModules, key],
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave({
      name: form.name.trim(),
      description: form.description.trim(),
      icon: form.icon.trim() || '🏅',
      iconType: form.iconType,
      requiredModules: form.requiredModules,
    });
  }

  const isUrl = form.iconType === 'url';

  return (
    <form className="bm-form" onSubmit={handleSubmit}>
      <div className="bm-form-row">
        <div className="bm-form-field bm-form-field--flex">
          <label className="bm-label">Badge Name</label>
          <input
            className="bm-input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Interview Master"
            required
          />
        </div>
      </div>

      <div className="bm-form-field">
        <label className="bm-label">Description</label>
        <textarea
          className="bm-input bm-textarea"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="What does this badge represent?"
          rows={2}
        />
      </div>

      <div className="bm-form-row">
        <div className="bm-form-field">
          <label className="bm-label">Icon type</label>
          <select className="bm-input" value={form.iconType} onChange={(e) => set('iconType', e.target.value)}>
            <option value="emoji">Emoji</option>
            <option value="url">Image URL</option>
          </select>
        </div>
        <div className="bm-form-field bm-form-field--flex">
          <label className="bm-label">{isUrl ? 'Image URL' : 'Emoji'}</label>
          <div className="bm-icon-preview-row">
            {!isUrl && (
              <span className="bm-icon-preview" role="img" aria-label="badge icon">
                {form.icon || '🏅'}
              </span>
            )}
            <input
              className="bm-input"
              value={form.icon}
              onChange={(e) => set('icon', e.target.value)}
              placeholder={isUrl ? 'https://…' : '🏅'}
            />
          </div>
        </div>
      </div>

      <div className="bm-form-field">
        <label className="bm-label">Required Modules <span className="bm-label-hint">(all must be completed to earn this badge)</span></label>
        <div className="bm-module-grid">
          {MODULE_DEFS.map((m) => (
            <label key={m.key} className={`bm-module-chip ${form.requiredModules.includes(m.key) ? 'bm-module-chip--selected' : ''}`}>
              <input
                type="checkbox"
                checked={form.requiredModules.includes(m.key)}
                onChange={() => toggleModule(m.key)}
                className="bm-module-checkbox"
              />
              {m.label}
            </label>
          ))}
        </div>
        {form.requiredModules.length === 0 && (
          <p className="bm-field-hint">Select at least one module</p>
        )}
      </div>

      <div className="bm-form-actions">
        <button
          className="bm-btn bm-btn--primary"
          type="submit"
          disabled={saving || form.requiredModules.length === 0}
        >
          {saving ? 'Saving…' : initial ? 'Update Badge' : 'Create Badge'}
        </button>
        <button className="bm-btn bm-btn--ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function BadgeManager({ getToken }) {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? null;

  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingBadge, setEditingBadge] = useState(null);

  const fetchBadges = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/badges?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load badges');
      setBadges(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, getToken]);

  useEffect(() => { fetchBadges(); }, [fetchBadges]);

  async function handleCreate(payload) {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/badges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...payload, workspaceId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Create failed');
      setShowForm(false);
      await fetchBadges();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(payload) {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/badges?id=${encodeURIComponent(editingBadge.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Update failed');
      setEditingBadge(null);
      await fetchBadges();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(badge) {
    if (!window.confirm(`Delete badge "${badge.name}"? All earned records will also be removed.`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/badges?id=${encodeURIComponent(badge.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      setBadges((prev) => prev.filter((b) => b.id !== badge.id));
    } catch (e) {
      setError(e.message);
    }
  }

  if (!workspaceId) {
    return (
      <section className="admin-section">
        <h2 className="admin-section-title">Badges</h2>
        <p className="admin-empty-msg">Select a workspace to manage badges.</p>
      </section>
    );
  }

  return (
    <section className="admin-section bm-section">
      <div className="bm-header">
        <h2 className="admin-section-title" style={{ margin: 0 }}>
          Badges — {currentWorkspace?.name}
        </h2>
        {!showForm && !editingBadge && (
          <button className="bm-btn bm-btn--primary" onClick={() => setShowForm(true)}>
            + New Badge
          </button>
        )}
      </div>

      {error && <p className="bm-error">{error}</p>}

      {(showForm || editingBadge) && (
        <div className="bm-form-wrap">
          <h3 className="bm-form-title">{editingBadge ? 'Edit Badge' : 'New Badge'}</h3>
          <BadgeForm
            initial={editingBadge}
            onSave={editingBadge ? handleUpdate : handleCreate}
            onCancel={() => { setShowForm(false); setEditingBadge(null); }}
            saving={saving}
          />
        </div>
      )}

      {loading ? (
        <div className="bm-loading">Loading badges…</div>
      ) : badges.length === 0 ? (
        <p className="bm-empty">No badges defined yet. Create one above to set a milestone for learners.</p>
      ) : (
        <ul className="bm-list">
          {badges.map((badge) => {
            const moduleLabels = (badge.requiredModules ?? []).map(
              (k) => MODULE_DEFS.find((m) => m.key === k)?.label ?? k
            );
            return (
              <li key={badge.id} className={`bm-item ${!badge.active ? 'bm-item--inactive' : ''}`}>
                <span className="bm-item-icon">
                  {badge.iconType === 'url' ? (
                    <img src={badge.icon} alt="" className="bm-item-img" />
                  ) : (
                    <span role="img" aria-label={badge.name}>{badge.icon}</span>
                  )}
                </span>
                <div className="bm-item-body">
                  <span className="bm-item-name">{badge.name}</span>
                  {badge.description && <span className="bm-item-desc">{badge.description}</span>}
                  <div className="bm-item-modules">
                    {moduleLabels.map((lbl) => (
                      <span key={lbl} className="bm-module-tag">{lbl}</span>
                    ))}
                  </div>
                </div>
                <div className="bm-item-actions">
                  <button className="bm-btn bm-btn--ghost bm-btn--sm" onClick={() => { setShowForm(false); setEditingBadge(badge); }}>
                    Edit
                  </button>
                  <button className="bm-btn bm-btn--danger bm-btn--sm" onClick={() => handleDelete(badge)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
