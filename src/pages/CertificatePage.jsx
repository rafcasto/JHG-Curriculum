import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import './CertificatePage.css';

export default function CertificatePage() {
  const { uid } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uid) return;
    fetch(`/api/certificates?uid=${encodeURIComponent(uid)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Certificate not found');
        setData(body);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [uid]);

  if (loading) {
    return (
      <div className="cert-public-page">
        <p className="cert-public-loading">Loading certificate…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cert-public-page">
        <div className="cert-public-error-card">
          <p>Certificate not found or not yet earned.</p>
        </div>
      </div>
    );
  }

  const awardDate = data.awardedAt
    ? new Date(data.awardedAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '';

  return (
    <div className="cert-public-page">
      <div className="cert-public-card">
        <div className="cert-public-header">
          <span className="cert-public-org">{data.workspaceName}</span>
        </div>

        <div className="cert-public-seal">🎓</div>

        <p className="cert-public-presents">This certifies that</p>
        <h1 className="cert-public-name">{data.displayName ?? 'Learner'}</h1>
        <p className="cert-public-body">
          has successfully completed all {data.totalLessons} lessons of
        </p>
        <h2 className="cert-public-course">{data.workspaceName}</h2>

        {awardDate && (
          <p className="cert-public-date">Awarded on {awardDate}</p>
        )}

        <div className="cert-public-footer">
          <div className="cert-public-divider" />
          <p className="cert-public-powered">Issued via JHG Academy</p>
        </div>
      </div>
    </div>
  );
}
