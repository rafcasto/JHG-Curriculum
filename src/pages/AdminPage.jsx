import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useNavigate } from 'react-router-dom';
import QuestionManager from '../components/QuestionManager';
import EarlyAccessManager from '../components/EarlyAccessManager';
import FeedbackDashboard from '../components/FeedbackDashboard';
import BadgeManager from '../components/BadgeManager';
import RichTextEditor from '../components/RichTextEditor';
import './AdminPage.css';

const ROLES = ['admin', 'editor', 'viewer', 'reviewer', 'learner'];

// ── Workspace Management Section ────────────────────────────────────────────
function WorkspacesSection({ users, getToken, refreshUsers }) {
  const { workspaces, loading: wsLoading, error: wsLoadError, refreshWorkspaces } = useWorkspace();
  const [wsForm, setWsForm] = useState({ name: '', driveFolderId: '' });
  const [wsFormError, setWsFormError] = useState(null);
  const [wsFormLoading, setWsFormLoading] = useState(false);
  const [wsError, setWsError] = useState(null);
  const [expanded, setExpanded] = useState({}); // workspaceId -> boolean
  const [addUserSel, setAddUserSel] = useState({}); // workspaceId -> uid
  const [folderLookupLoading, setFolderLookupLoading] = useState(false);
  const [syncingId, setSyncingId] = useState(null); // workspace id being synced

  // ── Global Catalog ─────────────────────────────────────────────────────────
  const [globalCatalogOpen, setGlobalCatalogOpen] = useState(false);
  const [globalCatalog, setGlobalCatalog] = useState({ tags: [], assetTypes: [] });
  const [gcDraft, setGcDraft] = useState({ tags: [], assetTypes: [] });
  const [gcSaving, setGcSaving] = useState(false);
  const [gcError, setGcError] = useState(null);
  const [gcNewTag, setGcNewTag] = useState({ label: '', value: '' });
  const [gcNewAssetType, setGcNewAssetType] = useState('');

  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .then((data) => {
        setGlobalCatalog(data);
        setGcDraft(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getToken()
      .then((token) => fetch('/api/config', { headers: { Authorization: `Bearer ${token}` } }))
      .then((r) => r.json())
      .then((data) => setAppConfig({ continueUrl: data.continueUrl ?? '' }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveGlobalCatalog() {
    setGcSaving(true);
    setGcError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(gcDraft),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      setGlobalCatalog(body);
      setGcDraft(body);
    } catch (e) {
      setGcError(e.message);
    } finally {
      setGcSaving(false);
    }
  }

  function gcAddTag() {
    if (!gcNewTag.label.trim() || !gcNewTag.value.trim()) return;
    setGcDraft((d) => ({ ...d, tags: [...d.tags, { label: gcNewTag.label.trim(), value: gcNewTag.value.trim() }] }));
    setGcNewTag({ label: '', value: '' });
  }

  function gcRemoveTag(idx) {
    setGcDraft((d) => ({ ...d, tags: d.tags.filter((_, i) => i !== idx) }));
  }

  function gcAddAssetType() {
    if (!gcNewAssetType.trim()) return;
    setGcDraft((d) => ({ ...d, assetTypes: [...d.assetTypes, gcNewAssetType.trim()] }));
    setGcNewAssetType('');
  }

  function gcRemoveAssetType(idx) {
    setGcDraft((d) => ({ ...d, assetTypes: d.assetTypes.filter((_, i) => i !== idx) }));
  }

  async function saveAppConfig() {
    setAppConfigSaving(true);
    setAppConfigError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ continueUrl: appConfig.continueUrl?.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      setAppConfig({ continueUrl: body.continueUrl ?? '' });
    } catch (e) {
      setAppConfigError(e.message);
    } finally {
      setAppConfigSaving(false);
    }
  }

  // ── Per-Workspace Catalog ──────────────────────────────────────────────────
  const [catalogOpen, setCatalogOpen] = useState({}); // wsId -> boolean
  const [catalogDraft, setCatalogDraft] = useState({}); // wsId -> { inheritGlobalCatalog, tags, assetTypes }
  const [catalogSaving, setCatalogSaving] = useState({}); // wsId -> boolean
  const [catalogError, setCatalogError] = useState({}); // wsId -> string | null
  const [wsNewTag, setWsNewTag] = useState({}); // wsId -> { label, value }
  const [wsNewAssetType, setWsNewAssetType] = useState({}); // wsId -> string

  // ── Per-Workspace Settings (LinkedIn URL) ──────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState({}); // wsId -> boolean
  const [linkedInUrlDraft, setLinkedInUrlDraft] = useState({}); // wsId -> string
  const [linkedInSaving, setLinkedInSaving] = useState({}); // wsId -> boolean
  const [linkedInError, setLinkedInError] = useState({}); // wsId -> string | null

  // ── Per-Workspace Paywall Config ───────────────────────────────────────────
  const [paywallDraft, setPaywallDraft] = useState({}); // wsId -> config draft
  const [paywallSaving, setPaywallSaving] = useState({}); // wsId -> boolean
  const [paywallError, setPaywallError] = useState({}); // wsId -> string | null
  const [paywallAvailGroups, setPaywallAvailGroups] = useState({}); // wsId -> string[]
  const [paywallGroupsLoading, setPaywallGroupsLoading] = useState({}); // wsId -> boolean
  const [regUrlCopied, setRegUrlCopied] = useState({}); // wsId -> boolean
  // ── Per-Workspace Email Template Accordion Tabs ────────────────────────────
  const [paywallCopyOpen, setPaywallCopyOpen] = useState({}); // wsId -> boolean
  const [pwdEmailOpen, setPwdEmailOpen] = useState({}); // wsId -> boolean
  const [verifyEmailOpen, setVerifyEmailOpen] = useState({}); // wsId -> boolean
  const [paymentConfirmationEmailOpen, setPaymentConfirmationEmailOpen] = useState({}); // wsId -> boolean

  // ── App Settings ────────────────────────────────────────────────────────────
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [appConfig, setAppConfig] = useState({ continueUrl: '' });
  const [appConfigSaving, setAppConfigSaving] = useState(false);
  const [appConfigError, setAppConfigError] = useState(null);

  // ── Learner Access Level Promotion ─────────────────────────────────────────
  const [accessLevelSel, setAccessLevelSel] = useState({}); // `${wsId}:${uid}` -> 0|2|3
  const [accessLevelSaving, setAccessLevelSaving] = useState({}); // `${wsId}:${uid}` -> boolean

  function openSettings(ws) {
    const isOpen = settingsOpen[ws.id];
    setSettingsOpen((prev) => ({ ...prev, [ws.id]: !isOpen }));
    if (!isOpen) {
      if (linkedInUrlDraft[ws.id] === undefined) {
        setLinkedInUrlDraft((prev) => ({ ...prev, [ws.id]: ws.linkedInUrl ?? '' }));
      }
      if (paywallDraft[ws.id] === undefined) {
        const pc = ws.paywallConfig ?? {};
        setPaywallDraft((prev) => ({
          ...prev,
          [ws.id]: {
            enabled: pc.enabled === true,
            registrationEnabled: pc.registrationEnabled === true,
            paymentUrl: pc.paymentUrl ?? '',
            selfPacedProductId: pc.selfPacedProductId ?? '',
            cohortProductId: pc.cohortProductId ?? '',
            webhookSecret: '', // never pre-filled (write-only from the client)
            zapierWebhookUrl: pc.zapierWebhookUrl ?? `${window.location.origin}/api/webhooks/payment`,
            paywallDescription: pc.paywallDescription ?? '',
            paywallTitle: pc.paywallTitle ?? '',
            paywallCtaText: pc.paywallCtaText ?? '',
            demoGroups: pc.demoGroups ?? [],
            level2Groups: pc.level2Groups ?? [],
            level3Groups: pc.level3Groups ?? [],
            welcomeEmailSubject: pc.welcomeEmail?.subject ?? '',
            welcomeEmailBody: pc.welcomeEmail?.body ?? '',
            verificationEmailSubject: pc.verificationEmail?.subject ?? '',
            verificationEmailBody: pc.verificationEmail?.body ?? '',
            paymentConfirmationEmailSubject: pc.paymentConfirmationEmail?.subject ?? '',
            paymentConfirmationEmailBody: pc.paymentConfirmationEmail?.body ?? '',
          },
        }));
      }
      // Fetch available groups from Drive if not already loaded
      if (!paywallAvailGroups[ws.id] && ws.driveFolderId) {
        setPaywallGroupsLoading((prev) => ({ ...prev, [ws.id]: true }));
        fetch(`/api/files?folderId=${encodeURIComponent(ws.driveFolderId)}`)
          .then((r) => r.json())
          .then((files) => {
            const groups = [...new Set(
              files.map((f) => {
                const p = f.path ?? '';
                return p.includes('/') ? p.split('/')[0] : '__root__';
              })
            )].sort((a, b) => a === '__root__' ? -1 : b === '__root__' ? 1 : a.localeCompare(b));
            setPaywallAvailGroups((prev) => ({ ...prev, [ws.id]: groups }));
          })
          .catch(() => setPaywallAvailGroups((prev) => ({ ...prev, [ws.id]: [] })))
          .finally(() => setPaywallGroupsLoading((prev) => ({ ...prev, [ws.id]: false })));
      }
    }
  }

  async function savePaywallConfig(wsId) {
    const draft = paywallDraft[wsId];
    if (!draft) return;
    setPaywallSaving((prev) => ({ ...prev, [wsId]: true }));
    setPaywallError((prev) => ({ ...prev, [wsId]: null }));
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(wsId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          paywallConfig: {
            enabled: draft.enabled,
            registrationEnabled: draft.registrationEnabled,
            paymentUrl: draft.paymentUrl?.trim() || null,
            selfPacedProductId: draft.selfPacedProductId?.trim() || null,
            cohortProductId: draft.cohortProductId?.trim() || null,
            ...(draft.webhookSecret.trim() ? { webhookSecret: draft.webhookSecret.trim() } : {}),
            zapierWebhookUrl: draft.zapierWebhookUrl?.trim() || null,
            paywallTitle: draft.paywallTitle?.trim() || null,
            paywallDescription: draft.paywallDescription?.trim() || null,
            paywallCtaText: draft.paywallCtaText?.trim() || null,
            demoGroups: draft.demoGroups,
            level2Groups: draft.level2Groups,
            level3Groups: draft.level3Groups,
            welcomeEmail: {
              subject: draft.welcomeEmailSubject?.trim() || null,
              body: draft.welcomeEmailBody?.trim() || null,
            },
            verificationEmail: {
              subject: draft.verificationEmailSubject?.trim() || null,
              body: draft.verificationEmailBody?.trim() || null,
            },
            paymentConfirmationEmail: {
              subject: draft.paymentConfirmationEmailSubject?.trim() || null,
              body: draft.paymentConfirmationEmailBody?.trim() || null,
            },
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      await refreshWorkspaces();
    } catch (e) {
      setPaywallError((prev) => ({ ...prev, [wsId]: e.message }));
    } finally {
      setPaywallSaving((prev) => ({ ...prev, [wsId]: false }));
    }
  }

  function togglePaywallGroup(wsId, groupKey, targetList) {
    setPaywallDraft((prev) => {
      const draft = prev[wsId];
      if (!draft) return prev;
      // Remove from all lists first (mutual exclusivity)
      const allLists = ['demoGroups', 'level2Groups', 'level3Groups'];
      const updated = { ...draft };
      allLists.forEach((list) => {
        updated[list] = (draft[list] ?? []).filter((g) => g !== groupKey);
      });
      // Add to target list only if it wasn't already there (toggle off if re-clicking)
      const wasInTarget = (draft[targetList] ?? []).includes(groupKey);
      if (!wasInTarget) {
        updated[targetList] = [...(updated[targetList] ?? []), groupKey];
      }
      return { ...prev, [wsId]: updated };
    });
  }

  async function saveLinkedInUrl(wsId) {
    const url = (linkedInUrlDraft[wsId] ?? '').trim();
    if (url && !url.startsWith('https://www.linkedin.com/')) {
      setLinkedInError((prev) => ({ ...prev, [wsId]: 'Must be a LinkedIn URL (https://www.linkedin.com/…)' }));
      return;
    }
    setLinkedInSaving((prev) => ({ ...prev, [wsId]: true }));
    setLinkedInError((prev) => ({ ...prev, [wsId]: null }));
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(wsId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ linkedInUrl: url || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      await refreshWorkspaces();
    } catch (e) {
      setLinkedInError((prev) => ({ ...prev, [wsId]: e.message }));
    } finally {
      setLinkedInSaving((prev) => ({ ...prev, [wsId]: false }));
    }
  }

  function openWsCatalog(ws) {
    const isOpen = catalogOpen[ws.id];
    setCatalogOpen((prev) => ({ ...prev, [ws.id]: !isOpen }));
    if (!isOpen && !catalogDraft[ws.id]) {
      setCatalogDraft((prev) => ({
        ...prev,
        [ws.id]: {
          inheritGlobalCatalog: ws.inheritGlobalCatalog !== false,
          tags: ws.tags ?? [],
          assetTypes: ws.assetTypes ?? [],
        },
      }));
      setWsNewTag((prev) => ({ ...prev, [ws.id]: { label: '', value: '' } }));
      setWsNewAssetType((prev) => ({ ...prev, [ws.id]: '' }));
    }
  }

  async function saveWsCatalog(wsId) {
    const draft = catalogDraft[wsId];
    if (!draft) return;
    setCatalogSaving((prev) => ({ ...prev, [wsId]: true }));
    setCatalogError((prev) => ({ ...prev, [wsId]: null }));
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(wsId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          inheritGlobalCatalog: draft.inheritGlobalCatalog,
          tags: draft.tags,
          assetTypes: draft.assetTypes,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      await refreshWorkspaces();
      // Sync draft to saved data
      setCatalogDraft((prev) => ({ ...prev, [wsId]: draft }));
    } catch (e) {
      setCatalogError((prev) => ({ ...prev, [wsId]: e.message }));
    } finally {
      setCatalogSaving((prev) => ({ ...prev, [wsId]: false }));
    }
  }

  function wsAddTag(wsId) {
    const nt = wsNewTag[wsId] ?? { label: '', value: '' };
    if (!nt.label.trim() || !nt.value.trim()) return;
    setCatalogDraft((prev) => ({
      ...prev,
      [wsId]: {
        ...prev[wsId],
        tags: [...(prev[wsId].tags ?? []), { label: nt.label.trim(), value: nt.value.trim() }],
      },
    }));
    setWsNewTag((prev) => ({ ...prev, [wsId]: { label: '', value: '' } }));
  }

  function wsRemoveTag(wsId, idx) {
    setCatalogDraft((prev) => ({
      ...prev,
      [wsId]: { ...prev[wsId], tags: (prev[wsId].tags ?? []).filter((_, i) => i !== idx) },
    }));
  }

  function wsAddAssetType(wsId) {
    const val = wsNewAssetType[wsId] ?? '';
    if (!val.trim()) return;
    setCatalogDraft((prev) => ({
      ...prev,
      [wsId]: {
        ...prev[wsId],
        assetTypes: [...(prev[wsId].assetTypes ?? []), val.trim()],
      },
    }));
    setWsNewAssetType((prev) => ({ ...prev, [wsId]: '' }));
  }

  function wsRemoveAssetType(wsId, idx) {
    setCatalogDraft((prev) => ({
      ...prev,
      [wsId]: {
        ...prev[wsId],
        assetTypes: (prev[wsId].assetTypes ?? []).filter((_, i) => i !== idx),
      },
    }));
  }

  // When a folder ID is entered in the create form, auto-fetch its Drive name
  useEffect(() => {
    const id = wsForm.driveFolderId.trim();
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) return;
    // Only auto-fill name if user hasn't typed one
    if (wsForm.name) return;
    setFolderLookupLoading(true);
    fetch(`/api/folders?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.name) setWsForm((f) => ({ ...f, name: f.name || data.name }));
      })
      .catch(() => {})
      .finally(() => setFolderLookupLoading(false));
  }, [wsForm.driveFolderId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSyncName(workspace) {
    setSyncingId(workspace.id);
    try {
      const res = await fetch(`/api/folders?id=${encodeURIComponent(workspace.driveFolderId)}`);
      const data = await res.json();
      if (!res.ok || !data.name) throw new Error(data.error ?? 'Folder not found');
      const token = await getToken();
      const patch = await fetch(`/api/workspaces?id=${encodeURIComponent(workspace.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: data.name }),
      });
      if (!patch.ok) {
        const b = await patch.json().catch(() => ({}));
        throw new Error(b.error ?? 'Update failed');
      }
      await refreshWorkspaces();
    } catch (e) {
      setWsError(e.message);
    } finally {
      setSyncingId(null);
    }
  }

  async function handleCreateWorkspace(e) {
    e.preventDefault();
    setWsFormError(null);
    setWsFormLoading(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(wsForm),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setWsForm({ name: '', driveFolderId: '' });
      await refreshWorkspaces();
    } catch (e) {
      setWsFormError(e.message);
    } finally {
      setWsFormLoading(false);
    }
  }

  async function handleDeleteWorkspace(id, name) {
    if (!window.confirm(`Delete workspace "${name}"? This cannot be undone.`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Delete failed');
      }
      await refreshWorkspaces();
    } catch (e) {
      setWsError(e.message);
    }
  }

  async function handleAddUser(workspaceId) {
    const uid = addUserSel[workspaceId];
    if (!uid) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(workspaceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ addUser: uid }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to add user');
      }
      setAddUserSel((prev) => ({ ...prev, [workspaceId]: '' }));
      await refreshWorkspaces();
    } catch (e) {
      setWsError(e.message);
    }
  }

  async function handleRemoveUser(workspaceId, uid) {
    try {
      const token = await getToken();
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(workspaceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ removeUser: uid }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to remove user');
      }
      await refreshWorkspaces();
    } catch (e) {
      setWsError(e.message);
    }
  }

  function emailForUid(uid) {
    return users.find((u) => u.uid === uid)?.email ?? uid;
  }

  function userForUid(uid) {
    return users.find((u) => u.uid === uid);
  }

  function currentAccessLevel(uid, wsId) {
    return users.find((u) => u.uid === uid)?.paidWorkspaces?.[wsId] ?? 0;
  }

  async function handleSetAccessLevel(wsId, uid) {
    const key = `${wsId}:${uid}`;
    const level = accessLevelSel[key] ?? currentAccessLevel(uid, wsId);
    setAccessLevelSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const token = await getToken();
      const res = await fetch(`/api/users?uid=${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId: wsId, accessLevel: level }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to set access level');
      }
      await refreshUsers();
      setAccessLevelSel((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      setWsError(e.message);
    } finally {
      setAccessLevelSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <section className="admin-section">
      <h2 className="admin-section-title">Workspaces</h2>

      {/* ── App Settings card ── */}
      <div className="catalog-card catalog-card--global">
        <button
          className="catalog-card-header"
          onClick={() => setAppSettingsOpen((v) => !v)}
        >
          <span className="catalog-card-title">App Settings</span>
          <span className="catalog-chevron">{appSettingsOpen ? '▲' : '▼'}</span>
        </button>

        {appSettingsOpen && (
          <div className="catalog-panel">
            <div style={{ maxWidth: '480px', marginBottom: '1rem' }}>
              <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>App login URL</p>
              <input
                className="admin-input"
                type="url"
                placeholder="https://your-app.com/login"
                value={appConfig.continueUrl}
                onChange={(e) => setAppConfig((c) => ({ ...c, continueUrl: e.target.value }))}
              />
              <p className="ws-settings-hint" style={{ marginTop: '0.375rem' }}>
                Used as the redirect URL after a user sets their password via a welcome email.
                Must be an <code>https://</code> URL.
              </p>
            </div>
            {appConfigError && <p className="admin-form-error" style={{ marginBottom: '0.5rem' }}>{appConfigError}</p>}
            <div className="catalog-save-row">
              <button
                className="admin-btn admin-btn--primary"
                onClick={saveAppConfig}
                disabled={appConfigSaving}
              >
                {appConfigSaving ? 'Saving…' : 'Save App Settings'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Global Catalog card ── */}
      <div className="catalog-card catalog-card--global">
        <button
          className="catalog-card-header"
          onClick={() => setGlobalCatalogOpen((v) => !v)}
        >
          <span className="catalog-card-title">Global Catalog</span>
          <span className="catalog-card-meta">
            {gcDraft.tags.length} tags · {gcDraft.assetTypes.length} asset types
          </span>
          <span className="catalog-chevron">{globalCatalogOpen ? '▲' : '▼'}</span>
        </button>

        {globalCatalogOpen && (
          <div className="catalog-panel">
            <div className="catalog-columns">
              {/* Tags */}
              <div className="catalog-col">
                <h4 className="catalog-col-title">Tags (Steps)</h4>
                <ul className="catalog-item-list">
                  {gcDraft.tags.map((t, i) => (
                    <li key={i} className="catalog-item-row">
                      <span className="catalog-item-label">{t.label}</span>
                      <code className="catalog-item-value">{t.value}</code>
                      <button className="catalog-remove-btn" onClick={() => gcRemoveTag(i)}>✕</button>
                    </li>
                  ))}
                </ul>
                <div className="catalog-add-row">
                  <input
                    className="admin-input catalog-input-sm"
                    placeholder="Label (e.g. 8. Follow-up)"
                    value={gcNewTag.label}
                    onChange={(e) => setGcNewTag((t) => ({ ...t, label: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), gcAddTag())}
                  />
                  <input
                    className="admin-input catalog-input-sm"
                    placeholder="Value (e.g. Module/8-Followup)"
                    value={gcNewTag.value}
                    onChange={(e) => setGcNewTag((t) => ({ ...t, value: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), gcAddTag())}
                  />
                  <button className="admin-btn admin-btn--secondary admin-btn--sm" onClick={gcAddTag}>Add</button>
                </div>
              </div>

              {/* Asset Types */}
              <div className="catalog-col">
                <h4 className="catalog-col-title">Asset Types</h4>
                <ul className="catalog-item-list">
                  {gcDraft.assetTypes.map((t, i) => (
                    <li key={i} className="catalog-item-row">
                      <span className="catalog-item-label">{t}</span>
                      <button className="catalog-remove-btn" onClick={() => gcRemoveAssetType(i)}>✕</button>
                    </li>
                  ))}
                </ul>
                <div className="catalog-add-row">
                  <input
                    className="admin-input catalog-input-sm"
                    placeholder="e.g. Lesson - Case Study"
                    value={gcNewAssetType}
                    onChange={(e) => setGcNewAssetType(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), gcAddAssetType())}
                  />
                  <button className="admin-btn admin-btn--secondary admin-btn--sm" onClick={gcAddAssetType}>Add</button>
                </div>
              </div>
            </div>

            {gcError && <p className="admin-form-error" style={{ marginTop: '0.5rem' }}>{gcError}</p>}
            <div className="catalog-save-row">
              <button
                className="admin-btn admin-btn--primary"
                onClick={saveGlobalCatalog}
                disabled={gcSaving}
              >
                {gcSaving ? 'Saving…' : 'Save Global Catalog'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create workspace form */}
      <form className="admin-form" onSubmit={handleCreateWorkspace}>
        <div className="admin-form-row">
          <div className="admin-input-wrap">
            <input
              className="admin-input"
              type="text"
              placeholder="Google Drive folder ID"
              value={wsForm.driveFolderId}
              onChange={(e) => setWsForm((f) => ({ ...f, driveFolderId: e.target.value, name: '' }))}
              required
            />
          </div>
          <div className="admin-input-wrap">
            <input
              className="admin-input"
              type="text"
              placeholder={folderLookupLoading ? 'Fetching name from Drive…' : 'Workspace name'}
              value={wsForm.name}
              onChange={(e) => setWsForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <button className="admin-btn admin-btn--primary" type="submit" disabled={wsFormLoading || folderLookupLoading}>
            {wsFormLoading ? 'Creating…' : 'Create Workspace'}
          </button>
        </div>
        {wsFormError && <p className="admin-form-error">{wsFormError}</p>}
      </form>

      {wsLoadError && (
        <div className="admin-error" style={{ marginTop: '0.75rem' }}>
          <div>
            <strong>Could not load workspaces:</strong> {wsLoadError}
            {wsLoadError.includes('Firestore') && (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#c9d1d9' }}>
                Go to the{' '}
                <a
                  href="https://console.firebase.google.com/project/jhg-academy/firestore"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#58a6ff' }}
                >
                  Firebase Console → Firestore
                </a>{' '}
                and create a database (Native mode, any region).
              </p>
            )}
          </div>
          <button className="admin-retry-btn" onClick={refreshWorkspaces}>Retry</button>
        </div>
      )}
      {wsError && <p className="admin-form-error" style={{ marginTop: '0.75rem' }}>{wsError}</p>}

      {/* Workspace list */}
      {workspaces.length === 0 ? (
        <p className="admin-empty-msg">No workspaces yet. Create one above.</p>
      ) : (
        <div className="ws-list">
          {workspaces.map((ws) => {
            const isOpen = expanded[ws.id] ?? false;
            const assignedUids = ws.userIds ?? [];
            const unassigned = users.filter((u) => !assignedUids.includes(u.uid));

            return (
              <div key={ws.id} className="ws-card">
                <div className="ws-card-header">
                  <div className="ws-card-info">
                    <span className="ws-card-name">{ws.name}</span>
                    <span className="ws-card-folder">
                      Drive: <code>{ws.driveFolderId}</code>
                    </span>
                    <span className="ws-card-count">
                      {assignedUids.length} user{assignedUids.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="ws-card-actions">
                    <button
                      className="admin-btn admin-btn--secondary"
                      disabled={syncingId === ws.id}
                      onClick={() => handleSyncName(ws)}
                      title="Sync workspace name from Google Drive folder"
                    >
                      {syncingId === ws.id ? 'Syncing…' : 'Sync Name'}
                    </button>
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setExpanded((prev) => ({ ...prev, [ws.id]: !isOpen }))}
                    >
                      {isOpen ? 'Hide Users' : 'Manage Users'}
                    </button>
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => openWsCatalog(ws)}
                    >
                      {catalogOpen[ws.id] ? 'Hide Catalog' : 'Catalog'}
                    </button>
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => openSettings(ws)}
                    >
                      {settingsOpen[ws.id] ? 'Hide Settings' : 'Settings'}
                    </button>
                    <button
                      className="admin-btn admin-btn--danger"
                      onClick={() => handleDeleteWorkspace(ws.id, ws.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="ws-users-panel">
                    {/* Assigned users */}
                    {assignedUids.length === 0 ? (
                      <p className="ws-no-users">No users assigned yet.</p>
                    ) : (
                      <ul className="ws-user-list">
                        {assignedUids.map((uid) => {
                          const user = userForUid(uid);
                          const isLearner = user?.role === 'learner';
                          const key = `${ws.id}:${uid}`;
                          const curLevel = currentAccessLevel(uid, ws.id);
                          const selLevel = accessLevelSel[key] ?? curLevel;
                          return (
                            <li key={uid} className="ws-user-row">
                              <span className="ws-user-email">
                                {emailForUid(uid)}
                                {isLearner && (
                                  <span
                                    className={`ws-user-access-badge${
                                      curLevel === 3
                                        ? ' ws-user-access--l3'
                                        : curLevel === 2
                                        ? ' ws-user-access--l2'
                                        : ' ws-user-access--none'
                                    }`}
                                  >
                                    {curLevel === 3
                                      ? 'Level 3'
                                      : curLevel === 2
                                      ? 'Level 2'
                                      : 'No access'}
                                  </span>
                                )}
                              </span>
                              {isLearner && (
                                <div className="ws-promote-row">
                                  <select
                                    className="admin-select admin-select--sm"
                                    value={selLevel}
                                    onChange={(e) =>
                                      setAccessLevelSel((prev) => ({
                                        ...prev,
                                        [key]: Number(e.target.value),
                                      }))
                                    }
                                  >
                                    <option value={0}>No access</option>
                                    <option value={2}>Level 2 — Self-Paced</option>
                                    <option value={3}>Level 3 — Cohort</option>
                                  </select>
                                  <button
                                    className="admin-btn admin-btn--primary admin-btn--sm"
                                    disabled={accessLevelSaving[key] || selLevel === curLevel}
                                    onClick={() => handleSetAccessLevel(ws.id, uid)}
                                  >
                                    {accessLevelSaving[key] ? 'Saving…' : 'Set'}
                                  </button>
                                </div>
                              )}
                              <button
                                className="admin-btn admin-btn--danger admin-btn--sm"
                                onClick={() => handleRemoveUser(ws.id, uid)}
                              >
                                Remove
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* Add user */}
                    {unassigned.length > 0 && (
                      <div className="ws-add-user-row">
                        <select
                          className="admin-select"
                          value={addUserSel[ws.id] ?? ''}
                          onChange={(e) =>
                            setAddUserSel((prev) => ({ ...prev, [ws.id]: e.target.value }))
                          }
                        >
                          <option value="">— Select user to add —</option>
                          {unassigned.map((u) => (
                            <option key={u.uid} value={u.uid}>{u.email}</option>
                          ))}
                        </select>
                        <button
                          className="admin-btn admin-btn--primary"
                          disabled={!addUserSel[ws.id]}
                          onClick={() => handleAddUser(ws.id)}
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Per-workspace Custom Catalog panel ── */}
                {catalogOpen[ws.id] && (
                  <div className="ws-catalog-panel">
                    <div className="catalog-inherit-row">
                      <label className="catalog-toggle-label">
                        <input
                          type="checkbox"
                          checked={catalogDraft[ws.id]?.inheritGlobalCatalog ?? true}
                          onChange={(e) =>
                            setCatalogDraft((prev) => ({
                              ...prev,
                              [ws.id]: { ...prev[ws.id], inheritGlobalCatalog: e.target.checked },
                            }))
                          }
                        />
                        Inherit global catalog (merge workspace additions with global defaults)
                      </label>
                    </div>
                    <div className="catalog-columns">
                      {/* Custom Tags */}
                      <div className="catalog-col">
                        <h4 className="catalog-col-title">Custom Tags</h4>
                        <ul className="catalog-item-list">
                          {(catalogDraft[ws.id]?.tags ?? []).map((t, i) => (
                            <li key={i} className="catalog-item-row">
                              <span className="catalog-item-label">{t.label}</span>
                              <code className="catalog-item-value">{t.value}</code>
                              <button
                                className="catalog-remove-btn"
                                onClick={() => wsRemoveTag(ws.id, i)}
                              >✕</button>
                            </li>
                          ))}
                          {(catalogDraft[ws.id]?.tags ?? []).length === 0 && (
                            <li className="catalog-empty">No custom tags yet</li>
                          )}
                        </ul>
                        <div className="catalog-add-row">
                          <input
                            className="admin-input catalog-input-sm"
                            placeholder="Label"
                            value={wsNewTag[ws.id]?.label ?? ''}
                            onChange={(e) =>
                              setWsNewTag((prev) => ({
                                ...prev,
                                [ws.id]: { ...(prev[ws.id] ?? { label: '', value: '' }), label: e.target.value },
                              }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), wsAddTag(ws.id))}
                          />
                          <input
                            className="admin-input catalog-input-sm"
                            placeholder="Value"
                            value={wsNewTag[ws.id]?.value ?? ''}
                            onChange={(e) =>
                              setWsNewTag((prev) => ({
                                ...prev,
                                [ws.id]: { ...(prev[ws.id] ?? { label: '', value: '' }), value: e.target.value },
                              }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), wsAddTag(ws.id))}
                          />
                          <button
                            className="admin-btn admin-btn--secondary admin-btn--sm"
                            onClick={() => wsAddTag(ws.id)}
                          >Add</button>
                        </div>
                      </div>

                      {/* Custom Asset Types */}
                      <div className="catalog-col">
                        <h4 className="catalog-col-title">Custom Asset Types</h4>
                        <ul className="catalog-item-list">
                          {(catalogDraft[ws.id]?.assetTypes ?? []).map((t, i) => (
                            <li key={i} className="catalog-item-row">
                              <span className="catalog-item-label">{t}</span>
                              <button
                                className="catalog-remove-btn"
                                onClick={() => wsRemoveAssetType(ws.id, i)}
                              >✕</button>
                            </li>
                          ))}
                          {(catalogDraft[ws.id]?.assetTypes ?? []).length === 0 && (
                            <li className="catalog-empty">No custom asset types yet</li>
                          )}
                        </ul>
                        <div className="catalog-add-row">
                          <input
                            className="admin-input catalog-input-sm"
                            placeholder="e.g. Workshop"
                            value={wsNewAssetType[ws.id] ?? ''}
                            onChange={(e) =>
                              setWsNewAssetType((prev) => ({ ...prev, [ws.id]: e.target.value }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), wsAddAssetType(ws.id))}
                          />
                          <button
                            className="admin-btn admin-btn--secondary admin-btn--sm"
                            onClick={() => wsAddAssetType(ws.id)}
                          >Add</button>
                        </div>
                      </div>
                    </div>

                    {catalogError[ws.id] && (
                      <p className="admin-form-error" style={{ marginTop: '0.5rem' }}>
                        {catalogError[ws.id]}
                      </p>
                    )}
                    <div className="catalog-save-row">
                      <button
                        className="admin-btn admin-btn--primary"
                        onClick={() => saveWsCatalog(ws.id)}
                        disabled={catalogSaving[ws.id]}
                      >
                        {catalogSaving[ws.id] ? 'Saving…' : 'Save Catalog'}
                      </button>
                    </div>
                  </div>
                )}
                {/* ── Per-workspace Settings panel (LinkedIn URL) ── */}
                {settingsOpen[ws.id] && (
                  <div className="ws-settings-panel">
                    <h4 className="ws-settings-title">Workspace Settings</h4>
                    <div className="ws-settings-field">
                      <label className="ws-settings-label">LinkedIn Company Page URL</label>
                      <p className="ws-settings-hint">
                        Used for the LinkedIn "Add to Profile" button on learner certificates.
                        Example: <code>https://www.linkedin.com/company/90697682/</code>
                      </p>
                      <div className="ws-settings-input-row">
                        <input
                          className="admin-input"
                          type="url"
                          placeholder="https://www.linkedin.com/company/90697682/"
                          value={linkedInUrlDraft[ws.id] ?? ws.linkedInUrl ?? ''}
                          onChange={(e) =>
                            setLinkedInUrlDraft((prev) => ({ ...prev, [ws.id]: e.target.value }))
                          }
                        />
                        <button
                          className="admin-btn admin-btn--primary"
                          onClick={() => saveLinkedInUrl(ws.id)}
                          disabled={linkedInSaving[ws.id]}
                        >
                          {linkedInSaving[ws.id] ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                      {linkedInError[ws.id] && (
                        <p className="admin-form-error" style={{ marginTop: '0.375rem' }}>
                          {linkedInError[ws.id]}
                        </p>
                      )}
                    </div>

                    {/* ── Paywall Config ── */}
                    <div className="ws-settings-field" style={{ marginTop: '1.25rem' }}>
                      <label className="ws-settings-label">Paywall</label>
                      <p className="ws-settings-hint">
                        Control which lesson groups require payment. Learners see locked groups in the sidebar.
                        Level 2 (Self-Paced) and Level 3 (Cohort) are separate tiers — purchasing Level 3 also grants Level 2 access.
                        Demo groups are freely accessible as a free preview (Level 1).
                      </p>

                      <label className="catalog-toggle-label" style={{ marginBottom: '0.75rem' }}>
                        <input
                          type="checkbox"
                          checked={paywallDraft[ws.id]?.enabled ?? false}
                          onChange={(e) =>
                            setPaywallDraft((prev) => ({
                              ...prev,
                              [ws.id]: { ...(prev[ws.id] ?? {}), enabled: e.target.checked },
                            }))
                          }
                        />
                        Enable paywall for this workspace
                      </label>

                      <label className="catalog-toggle-label" style={{ marginBottom: '0.75rem' }}>
                        <input
                          type="checkbox"
                          checked={paywallDraft[ws.id]?.registrationEnabled ?? false}
                          onChange={(e) =>
                            setPaywallDraft((prev) => ({
                              ...prev,
                              [ws.id]: { ...(prev[ws.id] ?? {}), registrationEnabled: e.target.checked },
                            }))
                          }
                        />
                        Enable learner self-registration
                      </label>

                      {paywallDraft[ws.id]?.registrationEnabled && (
                        <div className="ws-settings-input-row" style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input
                            className="admin-input"
                            type="text"
                            readOnly
                            value={`${window.location.origin}/register/${ws.id}`}
                            onFocus={(e) => e.target.select()}
                          />
                          <button
                            type="button"
                            className="admin-btn"
                            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/register/${ws.id}`);
                              setRegUrlCopied((prev) => ({ ...prev, [ws.id]: true }));
                              setTimeout(() => setRegUrlCopied((prev) => ({ ...prev, [ws.id]: false })), 2000);
                            }}
                          >
                            {regUrlCopied[ws.id] ? 'Copied!' : 'Copy link'}
                          </button>
                        </div>
                      )}

                      {paywallDraft[ws.id]?.enabled && (
                        <>
                          {/* ── Payment integration fields ── */}
                          <div className="ws-settings-input-row" style={{ marginBottom: '0.5rem' }}>
                            <input
                              className="admin-input"
                              type="text"
                              placeholder="Self-Paced Product ID"
                              value={paywallDraft[ws.id]?.selfPacedProductId ?? ''}
                              onChange={(e) =>
                                setPaywallDraft((prev) => ({
                                  ...prev,
                                  [ws.id]: { ...(prev[ws.id] ?? {}), selfPacedProductId: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <div className="ws-settings-input-row" style={{ marginBottom: '0.5rem' }}>
                            <input
                              className="admin-input"
                              type="text"
                              placeholder="Cohort Product ID"
                              value={paywallDraft[ws.id]?.cohortProductId ?? ''}
                              onChange={(e) =>
                                setPaywallDraft((prev) => ({
                                  ...prev,
                                  [ws.id]: { ...(prev[ws.id] ?? {}), cohortProductId: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <div className="ws-settings-input-row" style={{ marginBottom: '0.5rem' }}>
                            <input
                              className="admin-input"
                              type="password"
                              placeholder={
                                ws.paywallConfig?.webhookSecretConfigured
                                  ? '\u25cf Webhook secret configured \u2014 enter new value to change'
                                  : 'Auto-generated on save (or enter your own)'
                              }
                              value={paywallDraft[ws.id]?.webhookSecret ?? ''}
                              autoComplete="new-password"
                              onChange={(e) =>
                                setPaywallDraft((prev) => ({
                                  ...prev,
                                  [ws.id]: { ...(prev[ws.id] ?? {}), webhookSecret: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <div className="ws-settings-input-row" style={{ marginBottom: '0.75rem' }}>
                            <input
                              className="admin-input"
                              type="url"
                              placeholder="Zapier webhook URL (called after successful purchase)"
                              value={paywallDraft[ws.id]?.zapierWebhookUrl ?? ''}
                              onChange={(e) =>
                                setPaywallDraft((prev) => ({
                                  ...prev,
                                  [ws.id]: { ...(prev[ws.id] ?? {}), zapierWebhookUrl: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <p className="ws-settings-hint" style={{ marginBottom: '1rem' }}>
                            Payment events should POST to <code>/api/webhooks/payment</code> with
                            <code> workspaceId</code>, <code>productId</code>, and <code>secret</code>.
                            The Zapier webhook URL above is called by this app after each successful purchase.
                          </p>

                          {/* ── Paywall Copy accordion ── */}
                          <div className="email-tab-section">
                            <button
                              type="button"
                              className="email-tab-header"
                              onClick={() => setPaywallCopyOpen((prev) => ({ ...prev, [ws.id]: !prev[ws.id] }))}
                            >
                              <span>Paywall Copy</span>
                              <span className="email-tab-chevron">{paywallCopyOpen[ws.id] ? '▲' : '▼'}</span>
                            </button>
                            {paywallCopyOpen[ws.id] && (
                              <div className="email-tab-body">
                                <p className="ws-settings-hint" style={{ marginBottom: '0.75rem' }}>
                                  Text shown on the paywall modal when a learner hits a locked lesson group.
                                </p>
                                <div className="ws-settings-input-row" style={{ marginBottom: '0.5rem' }}>
                                  <input
                                    className="admin-input"
                                    type="url"
                                    placeholder="Payment URL"
                                    value={paywallDraft[ws.id]?.paymentUrl ?? ''}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), paymentUrl: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                                <div className="ws-settings-input-row" style={{ marginBottom: '0.5rem' }}>
                                  <input
                                    className="admin-input"
                                    type="text"
                                    placeholder="Modal title (default: folder name)"
                                    value={paywallDraft[ws.id]?.paywallTitle ?? ''}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), paywallTitle: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                                <div className="ws-settings-input-row" style={{ marginBottom: '0.5rem' }}>
                                  <RichTextEditor
                                    key={`${ws.id}-desc`}
                                    initialContent={paywallDraft[ws.id]?.paywallDescription ?? ''}
                                    onChange={(md) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), paywallDescription: md },
                                      }))
                                    }
                                  />
                                </div>
                                <div className="ws-settings-input-row">
                                  <input
                                    className="admin-input"
                                    type="text"
                                    placeholder='CTA button text (default: "Get Access →")'
                                    value={paywallDraft[ws.id]?.paywallCtaText ?? ''}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), paywallCtaText: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* ── Password Set Email accordion ── */}
                          <div className="email-tab-section">
                            <button
                              type="button"
                              className="email-tab-header"
                              onClick={() => setPwdEmailOpen((prev) => ({ ...prev, [ws.id]: !prev[ws.id] }))}
                            >
                              <span>Password Set Email</span>
                              <span className="email-tab-chevron">{pwdEmailOpen[ws.id] ? '▲' : '▼'}</span>
                            </button>
                            {pwdEmailOpen[ws.id] && (
                              <div className="email-tab-body">
                                <p className="ws-settings-hint" style={{ marginBottom: '0.75rem' }}>
                                  Sent to new paid learners after a successful payment. Use <code>{'{{name}}'}</code> and <code>{'{{link}}'}</code> (password-set link).
                                </p>
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Subject</p>
                                <div className="ws-settings-input-row" style={{ marginBottom: '0.75rem' }}>
                                  <input
                                    className="admin-input"
                                    type="text"
                                    placeholder="Welcome! Set your password to get started"
                                    value={paywallDraft[ws.id]?.welcomeEmailSubject ?? ''}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), welcomeEmailSubject: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Body (HTML)</p>
                                <div className="ws-settings-input-row">
                                  <textarea
                                    className="admin-input"
                                    rows={6}
                                    placeholder={`<p>Hi {{name}},</p>\n<p>Click below to set your password:</p>\n<p><a href="{{link}}">Set your password</a></p>`}
                                    value={paywallDraft[ws.id]?.welcomeEmailBody ?? ''}
                                    style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8125rem' }}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), welcomeEmailBody: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* ── Email Verification accordion ── */}
                          <div className="email-tab-section" style={{ marginBottom: '1rem' }}>
                            <button
                              type="button"
                              className="email-tab-header"
                              onClick={() => setVerifyEmailOpen((prev) => ({ ...prev, [ws.id]: !prev[ws.id] }))}
                            >
                              <span>Email Verification</span>
                              <span className="email-tab-chevron">{verifyEmailOpen[ws.id] ? '▲' : '▼'}</span>
                            </button>
                            {verifyEmailOpen[ws.id] && (
                              <div className="email-tab-body">
                                <p className="ws-settings-hint" style={{ marginBottom: '0.75rem' }}>
                                  Sent to self-registered (free) learners when they create an account. Use <code>{'{{name}}'}</code> and <code>{'{{link}}'}</code> (email verification link).
                                </p>
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Subject</p>
                                <div className="ws-settings-input-row" style={{ marginBottom: '0.75rem' }}>
                                  <input
                                    className="admin-input"
                                    type="text"
                                    placeholder="Verify your email to get started"
                                    value={paywallDraft[ws.id]?.verificationEmailSubject ?? ''}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), verificationEmailSubject: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Body (HTML)</p>
                                <div className="ws-settings-input-row">
                                  <textarea
                                    className="admin-input"
                                    rows={6}
                                    placeholder={`<p>Hi {{name}},</p>\n<p>Click below to verify your email:</p>\n<p><a href="{{link}}">Verify email</a></p>`}
                                    value={paywallDraft[ws.id]?.verificationEmailBody ?? ''}
                                    style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8125rem' }}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), verificationEmailBody: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* ── Payment Confirmation Email accordion ── */}
                          <div className="email-tab-section" style={{ marginBottom: '1rem' }}>
                            <button
                              type="button"
                              className="email-tab-header"
                              onClick={() => setPaymentConfirmationEmailOpen((prev) => ({ ...prev, [ws.id]: !prev[ws.id] }))}
                            >
                              <span>Payment Confirmation Email</span>
                              <span className="email-tab-chevron">{paymentConfirmationEmailOpen[ws.id] ? '▲' : '▼'}</span>
                            </button>
                            {paymentConfirmationEmailOpen[ws.id] && (
                              <div className="email-tab-body">
                                <p className="ws-settings-hint" style={{ marginBottom: '0.75rem' }}>
                                  Sent to new paid learners after payment with order details and receipt download link. Use <code>{'{{name}}'}</code>, <code>{'{{date}}'}</code>, <code>{'{{accessLevel}}'}</code>, and <code>{'{{receiptUrl}}'}</code> placeholders.
                                </p>
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Subject</p>
                                <div className="ws-settings-input-row" style={{ marginBottom: '0.75rem' }}>
                                  <input
                                    className="admin-input"
                                    type="text"
                                    placeholder="Payment Received — Download Receipt"
                                    value={paywallDraft[ws.id]?.paymentConfirmationEmailSubject ?? ''}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), paymentConfirmationEmailSubject: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Body (HTML)</p>
                                <div className="ws-settings-input-row">
                                  <textarea
                                    className="admin-input"
                                    rows={10}
                                    placeholder={`<p>Hi {{name}},</p>\n<p>Thank you for your payment! Your order has been confirmed.</p>\n<p><strong>Order Details:</strong></p>\n<ul>\n<li>Date: {{date}}</li>\n<li>Access Level: {{accessLevel}}</li>\n</ul>\n<p><a href="{{receiptUrl}}" style="display: inline-block; background-color: #c2001f; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none;">↓ Download Receipt</a></p>\n<p>You will receive a separate email with instructions to set your password and access your account.</p>`}
                                    value={paywallDraft[ws.id]?.paymentConfirmationEmailBody ?? ''}
                                    style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8125rem' }}
                                    onChange={(e) =>
                                      setPaywallDraft((prev) => ({
                                        ...prev,
                                        [ws.id]: { ...(prev[ws.id] ?? {}), paymentConfirmationEmailBody: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {paywallGroupsLoading[ws.id] ? (
                            <p className="ws-settings-hint">Loading groups&hellip;</p>
                          ) : (paywallAvailGroups[ws.id] ?? []).length === 0 ? (
                            <p className="ws-settings-hint">No groups found. Check that the workspace Drive folder is set up correctly.</p>
                          ) : (
                            <div className="paywall-groups-grid">
                              <div className="paywall-groups-col">
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Demo Groups</p>
                                <p className="ws-settings-hint">Level 1 &mdash; free preview, accessible to all learners.</p>
                                {(paywallAvailGroups[ws.id] ?? []).map((g) => (
                                  <label key={g} className="paywall-group-label">
                                    <input
                                      type="checkbox"
                                      checked={(paywallDraft[ws.id]?.demoGroups ?? []).includes(g)}
                                      onChange={() => togglePaywallGroup(ws.id, g, 'demoGroups')}
                                    />
                                    {g === '__root__' ? '(Root \u2014 top-level files)' : g}
                                  </label>
                                ))}
                              </div>
                              <div className="paywall-groups-col">
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Level 2 &mdash; Self-Paced</p>
                                <p className="ws-settings-hint">Requires self-paced subscription.</p>
                                {(paywallAvailGroups[ws.id] ?? []).map((g) => (
                                  <label key={g} className="paywall-group-label">
                                    <input
                                      type="checkbox"
                                      checked={(paywallDraft[ws.id]?.level2Groups ?? []).includes(g)}
                                      onChange={() => togglePaywallGroup(ws.id, g, 'level2Groups')}
                                    />
                                    {g === '__root__' ? '(Root \u2014 top-level files)' : g}
                                  </label>
                                ))}
                              </div>
                              <div className="paywall-groups-col">
                                <p className="ws-settings-label" style={{ marginBottom: '0.375rem' }}>Level 3 &mdash; Cohort</p>
                                <p className="ws-settings-hint">Requires cohort subscription (also unlocks Level 2).</p>
                                {(paywallAvailGroups[ws.id] ?? []).map((g) => (
                                  <label key={g} className="paywall-group-label">
                                    <input
                                      type="checkbox"
                                      checked={(paywallDraft[ws.id]?.level3Groups ?? []).includes(g)}
                                      onChange={() => togglePaywallGroup(ws.id, g, 'level3Groups')}
                                    />
                                    {g === '__root__' ? '(Root \u2014 top-level files)' : g}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {paywallError[ws.id] && (
                        <p className="admin-form-error" style={{ marginTop: '0.375rem' }}>
                          {paywallError[ws.id]}
                        </p>
                      )}
                      <div style={{ marginTop: '0.75rem' }}>
                        <button
                          className="admin-btn admin-btn--primary"
                          onClick={() => savePaywallConfig(ws.id)}
                          disabled={paywallSaving[ws.id]}
                        >
                          {paywallSaving[ws.id] ? 'Saving\u2026' : 'Save Paywall'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add user form state
  const [form, setForm] = useState({ email: '', password: '', role: 'editor' });
  const [formError, setFormError] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  // Redirect non-admins immediately
  useEffect(() => {
    if (role && role !== 'admin') navigate('/graph', { replace: true });
  }, [role, navigate]);

  const getToken = useCallback(() => user?.getIdToken(), [user]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      setUsers(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (role === 'admin') fetchUsers();
  }, [role, fetchUsers]);

  async function handleAddUser(e) {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setForm({ email: '', password: '', role: 'editor' });
      await fetchUsers();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleRoleChange(uid, newRole) {
    try {
      const token = await getToken();
      const res = await fetch(`/api/users?uid=${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Update failed');
      }
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, role: newRole } : u))
      );
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(uid, email) {
    if (!window.confirm(`Delete user "${email}"? This cannot be undone.`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/users?uid=${encodeURIComponent(uid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Delete failed');
      }
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
    } catch (e) {
      setError(e.message);
    }
  }

  const [activeTab, setActiveTab] = useState('workspaces');

  if (role && role !== 'admin') return null;

  const tabs = [
    { id: 'workspaces', label: 'Workspaces' },
    { id: 'users', label: 'Users' },
    { id: 'questions', label: 'Questions' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'early-access', label: 'Early Access' },
    { id: 'badges', label: 'Badges' },
  ];

  return (
    <div className="admin-page">
      <h1 className="admin-title">Admin</h1>

      <div className="admin-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`admin-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'workspaces' && (
        <WorkspacesSection users={users} getToken={getToken} refreshUsers={fetchUsers} />
      )}

      {activeTab === 'questions' && (
        <QuestionManager getToken={getToken} />
      )}

      {activeTab === 'early-access' && (
        <EarlyAccessManager getToken={getToken} />
      )}

      {activeTab === 'badges' && (
        <BadgeManager getToken={getToken} />
      )}

      {activeTab === 'feedback' && (
        <FeedbackDashboard getToken={getToken} users={users} />
      )}

      {activeTab === 'users' && (
      <>
      {/* ── Add user form ── */}
      <section className="admin-section">
        <h2 className="admin-section-title">Add User</h2>
        <form className="admin-form" onSubmit={handleAddUser}>
          <div className="admin-form-row">
            <input
              className="admin-input"
              type="email"
              placeholder="Email address"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              autoComplete="off"
            />
            <input
              className="admin-input"
              type="password"
              placeholder="Password (min 8 chars)"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <select
              className="admin-select"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button className="admin-btn admin-btn--primary" type="submit" disabled={formLoading}>
              {formLoading ? 'Adding…' : 'Add User'}
            </button>
          </div>
          {formError && <p className="admin-form-error">{formError}</p>}
        </form>
      </section>

      {/* ── User list ── */}
      <section className="admin-section">
        <h2 className="admin-section-title">Users</h2>

        {error && (
          <div className="admin-error">
            {error}
            <button className="admin-retry-btn" onClick={fetchUsers}>Retry</button>
          </div>
        )}

        {loading ? (
          <div className="admin-loading"><div className="spinner" /></div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid} className={u.uid === user?.uid ? 'admin-table-row--self' : ''}>
                  <td className="admin-td-email">
                    {u.email}
                    {u.uid === user?.uid && <span className="admin-self-badge">you</span>}
                  </td>
                  <td>
                    <select
                      className="admin-select admin-select--inline"
                      value={u.role}
                      disabled={u.uid === user?.uid}
                      onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="admin-td-date">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <button
                      className="admin-btn admin-btn--danger"
                      disabled={u.uid === user?.uid}
                      onClick={() => handleDelete(u.uid, u.email)}
                      title={u.uid === user?.uid ? "You can't delete yourself" : 'Delete user'}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr><td colSpan={4} className="admin-empty">No users found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
      </>
      )}
    </div>
  );
}
