import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './CertificatesPage.css';

const MODULE_DEFS = [
  { key: '0. preparation', label: 'Preparation', icon: '📚' },
  { key: '1. focus',       label: 'Focus',       icon: '🎯' },
  { key: '2. value',       label: 'Value',       icon: '💡' },
  { key: '3. profile',     label: 'Profile',     icon: '👤' },
  { key: '4. applications',label: 'Applications',icon: '📝' },
  { key: '5. network',     label: 'Network',     icon: '🌐' },
  { key: '6. interviews',  label: 'Interviews',  icon: '🎤' },
  { key: '7. deal',        label: 'Deal',        icon: '🤝' },
];

function inferModule(drivePath) {
  const lower = (drivePath ?? '').toLowerCase();
  return MODULE_DEFS.find((m) => lower.startsWith(m.key)) ?? null;
}

function extractLinkedInCompanyId(url) {
  if (!url) return null;
  const match = url.match(/\/company\/(\d+)/);
  return match ? match[1] : null;
}

function buildLinkedInUrl({ workspaceName, awardedAt, certUrl, linkedInUrl }) {
  const orgId = extractLinkedInCompanyId(linkedInUrl);
  const date = awardedAt ? new Date(awardedAt) : new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: workspaceName ?? 'Curriculum Certificate',
    issueYear: String(year),
    issueMonth: String(month),
    certUrl,
  });
  if (orgId) params.set('organizationId', orgId);
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

export default function CertificatesPage() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { currentWorkspace } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [certData, setCertData] = useState(null);       // { completedCount, totalLessons, certificate }
  const [moduleSummary, setModuleSummary] = useState([]); // [{ key, label, icon, total, completed }]

  useEffect(() => {
    if (!currentWorkspace?.id || !user) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const token = await user.getIdToken();

        // Fetch certificate status + workspace documents + drive files in parallel
        const [certRes, docsRes, driveRes] = await Promise.all([
          fetch(`/api/certificates?workspaceId=${encodeURIComponent(currentWorkspace.id)}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/documents?workspaceId=${encodeURIComponent(currentWorkspace.id)}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          currentWorkspace.driveFolderId
            ? fetch(`/api/files?folderId=${encodeURIComponent(currentWorkspace.driveFolderId)}`)
            : Promise.resolve({ ok: true, json: async () => [] }),
        ]);

        if (cancelled) return;

        const [certJson, docsJson, driveFiles] = await Promise.all([
          certRes.json(),
          docsRes.json(),
          driveRes.json(),
        ]);

        if (!certRes.ok) throw new Error(certJson.error ?? 'Failed to fetch certificate');

        // Build driveFileId → path map
        const pathMap = {};
        if (Array.isArray(driveFiles)) {
          for (const f of driveFiles) pathMap[f.id] = f.path ?? '';
        }

        // Fetch batch submissions for all documents
        const docs = Array.isArray(docsJson) ? docsJson : [];
        let submissions = {};
        if (docs.length > 0) {
          const docIds = docs.map((d) => d.id).join(',');
          const subsRes = await fetch(
            `/api/submissions?documentIds=${encodeURIComponent(docIds)}&batch=true`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (subsRes.ok) submissions = await subsRes.json();
        }

        if (cancelled) return;

        // Compute per-module stats
        const moduleMap = {};
        for (const mod of MODULE_DEFS) {
          moduleMap[mod.key] = { ...mod, total: 0, completed: 0 };
        }

        for (const doc of docs) {
          const drivePath = pathMap[doc.driveFileId] ?? '';
          const mod = inferModule(drivePath);
          if (!mod) continue;
          const bucket = moduleMap[mod.key];
          if (!bucket) continue;
          bucket.total += 1;
          const sub = submissions[doc.id];
          if (sub?.status === 'complete') bucket.completed += 1;
        }

        const summary = MODULE_DEFS.map((m) => moduleMap[m.key]).filter((m) => m.total > 0);

        setCertData(certJson);
        setModuleSummary(summary);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [currentWorkspace?.id, user]);

  const displayName = profile?.firstName
    ? `${profile.firstName} ${profile.lastName ?? ''}`.trim()
    : user?.email ?? '';

  const certUrl = `${window.location.origin}/certificate/${user?.uid}`;
  const linkedInUrl = currentWorkspace?.linkedInUrl;

  if (loading) {
    return (
      <div className="certificates-page">
        <p className="certificates-loading">Loading certificates…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="certificates-page">
        <p className="certificates-error">{error}</p>
      </div>
    );
  }

  const { completedCount = 0, totalLessons = 0, certificate } = certData ?? {};
  const progressPct = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  return (
    <div className="certificates-page">
      <h1 className="certificates-title">Certificates &amp; Badges</h1>

      {/* ── Overall Certificate ─────────────────────────────────────── */}
      <section className="cert-section">
        <h2 className="cert-section-title">Certificate of Completion</h2>

        {certificate ? (
          <div className="cert-card cert-card--earned">
            <div className="cert-card-icon">🎓</div>
            <div className="cert-card-body">
              <p className="cert-card-name">{displayName}</p>
              <p className="cert-card-course">
                {certificate.workspaceName ?? currentWorkspace?.name}
              </p>
              <p className="cert-card-meta">
                Completed {certificate.totalLessons} lessons ·{' '}
                {new Date(certificate.awardedAt).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </p>
            </div>
            <div className="cert-card-actions">
              {linkedInUrl ? (
                <a
                  className="cert-linkedin-btn"
                  href={buildLinkedInUrl({
                    workspaceName: certificate.workspaceName ?? currentWorkspace?.name,
                    awardedAt: certificate.awardedAt,
                    certUrl,
                    linkedInUrl,
                  })}
                  target="_blank"
                  rel="noreferrer"
                >
                  <svg className="cert-linkedin-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  Add to LinkedIn Profile
                </a>
              ) : (
                <a
                  className="cert-view-btn"
                  href={certUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Certificate
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="cert-card cert-card--progress">
            <div className="cert-card-icon">📖</div>
            <div className="cert-card-body">
              <p className="cert-progress-label">
                {completedCount} of {totalLessons} lessons completed
              </p>
              <div className="cert-progress-bar-wrap">
                <div className="cert-progress-bar" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="cert-progress-sub">
                Complete all lessons to earn your certificate of completion.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Module Badges ───────────────────────────────────────────── */}
      {moduleSummary.length > 0 && (
        <section className="cert-section">
          <h2 className="cert-section-title">Module Badges</h2>
          <div className="badges-grid">
            {moduleSummary.map((mod) => {
              const earned = mod.completed === mod.total && mod.total > 0;
              return (
                <div key={mod.key} className={`badge-card ${earned ? 'badge-card--earned' : ''}`}>
                  <span className="badge-icon">{mod.icon}</span>
                  <span className="badge-label">{mod.label}</span>
                  <span className="badge-progress">
                    {mod.completed}/{mod.total}
                  </span>
                  {earned && <span className="badge-check">✓</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
