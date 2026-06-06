import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { canAccessGroup, getGroupAccess } from '../utils/paywallAccess';
import { getOrderedDocuments, getLockedDocumentIds } from '../utils/reviewOrder';
import './ReviewerSidebar.css';

const STATUS_META = {
  not_started: { label: 'New',         className: 'rsb-status--new' },
  in_progress:  { label: 'In progress', className: 'rsb-status--progress' },
  complete:     { label: 'Done',        className: 'rsb-status--done' },
};

function submissionStatus(submission) {
  if (!submission) return 'not_started';
  if (submission.status === 'complete') return 'complete';
  return 'in_progress';
}

/** Extract the top-level folder name from a Drive path like "1. focus/Lesson Name" */
function getFolder(drivePath) {
  if (!drivePath || !drivePath.includes('/')) return '__root__';
  const segment = drivePath.split('/')[0].trim();
  return segment || '__root__';
}

function folderLabel(key) {
  return key
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Props:
 *   documents   — array of reviewer-assigned documents from /api/documents
 *   submissions — map of driveFileId → submission object
 *   loading     — bool
 */
export default function ReviewerSidebar({ documents = [], submissions = {}, loading = false }) {
  const navigate = useNavigate();
  const { id: activeId } = useParams();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const { currentWorkspace } = useWorkspace();
  const { role } = useAuth();
  const { paidWorkspaces } = useUserProfile();
  const paywallConfig = currentWorkspace?.paywallConfig ?? null;
  const workspaceId = currentWorkspace?.id ?? null;
  const enforceSequential = currentWorkspace?.enforceSequentialReview ?? false;

  // Use the submissions prop — useOutletContext() does NOT work here because
  // ReviewerSidebar is rendered as a sibling of <Outlet>, outside the outlet tree.
  const lockedIds = useMemo(() => {
    if (!enforceSequential) return new Set();
    const ordered = getOrderedDocuments(documents);
    return getLockedDocumentIds(ordered, submissions);
  }, [enforceSequential, documents, submissions]);

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? documents.filter((d) => (d.title ?? '').toLowerCase().includes(q))
      : documents;

    const groups = {};
    filtered.forEach((d) => {
      const key = getFolder(d.drivePath);
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    Object.values(groups).forEach((arr) =>
      arr.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
    );

    return groups;
  }, [documents, search]);

  const sortedGroups = Object.keys(grouped).sort((a, b) =>
    a === '__root__' ? -1 : b === '__root__' ? 1 : a.localeCompare(b)
  );

  function toggle(key) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className="rsb-sidebar">
      <div className="rsb-header">
        <span className="rsb-title">Documents</span>
        {role !== 'learner' && (
          <input
            className="rsb-search"
            type="search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>

      <nav className="rsb-nav">
        {loading && (
          <div className="rsb-loading">
            <div className="spinner" />
          </div>
        )}

        {!loading && sortedGroups.length === 0 && (
          <p className="rsb-empty">No documents assigned yet.</p>
        )}

        {sortedGroups.map((key) => {
          const isGroupPaywallLocked = role === 'learner' && !canAccessGroup(key, paywallConfig, paidWorkspaces, workspaceId);
          const groupAccessLevel = role === 'learner' ? getGroupAccess(key, paywallConfig) : 'open';
          const paymentUrl = 
            groupAccessLevel === 'level3'
              ? (paywallConfig?.level3PaymentUrl ?? paywallConfig?.paymentUrl)
              : groupAccessLevel === 'level2'
                ? (paywallConfig?.level2PaymentUrl ?? paywallConfig?.paymentUrl)
                : (paywallConfig?.paymentUrl ?? null);

          return (
          <div key={key} className="rsb-group">
            {key !== '__root__' && (
              <button
                className="rsb-group-header"
                onClick={isGroupPaywallLocked
                  ? () => { if (paymentUrl) window.open(paymentUrl, '_blank', 'noopener,noreferrer'); }
                  : () => toggle(key)}
              >
                <span className={`rsb-chevron${collapsed[key] ? '' : ' open'}`}>›</span>
                <span className="rsb-group-name">{folderLabel(key)}</span>
                {isGroupPaywallLocked && (
                  <span className="rsb-badge rsb-status--locked">🔒</span>
                )}
                {groupAccessLevel === 'demo' && (
                  <span className="rsb-badge rsb-paywall-demo">FREE</span>
                )}
                <span className="rsb-group-count">{grouped[key].length}</span>
              </button>
            )}

            {(key === '__root__' || !collapsed[key]) && (
              <ul className="rsb-file-list">
                {grouped[key].map((doc) => {
                  const sub = submissions[doc.driveFileId];
                  const isSeqLocked = enforceSequential && lockedIds.has(doc.driveFileId);
                  // Paywall lock takes priority over sequential lock
                  const isLocked = isGroupPaywallLocked || isSeqLocked;
                  const status = isSeqLocked ? 'not_started' : submissionStatus(sub);
                  const meta = STATUS_META[status];
                  const isActive = doc.driveFileId === activeId;
                  // Frontier doc: sequential mode, not locked, not yet complete → show open lock
                  const isFrontier = enforceSequential && !isLocked && status !== 'complete';

                  return (
                    <li key={doc.id}>
                      <button
                        className={`rsb-file-btn${isActive ? ' active' : ''}${isLocked ? ' rsb-file-btn--locked' : ''}`}
                        onClick={() => {
                          if (isGroupPaywallLocked) {
                            if (paymentUrl) window.open(paymentUrl, '_blank', 'noopener,noreferrer');
                          } else if (!isSeqLocked) {
                            navigate(`/file/${doc.driveFileId}`);
                          }
                        }}
                        disabled={isSeqLocked && !isGroupPaywallLocked}
                        title={
                          isGroupPaywallLocked
                            ? `${doc.title ?? doc.driveFileId} — Requires subscription`
                            : isSeqLocked
                              ? 'Complete the previous document first'
                              : undefined
                        }
                      >
                        <span className="rsb-file-name">{doc.title}</span>
                        {isGroupPaywallLocked
                          ? <span className="rsb-badge rsb-status--locked">🔒</span>
                          : isSeqLocked
                            ? <span className="rsb-badge rsb-status--locked">🔒</span>
                            : isFrontier
                              ? <span className="rsb-badge rsb-status--frontier">🔓</span>
                              : <span className={`rsb-badge ${meta.className}`}>{meta.label}</span>
                        }
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          );
        })}
      </nav>
    </aside>
  );
}
