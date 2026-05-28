import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { sendEmailVerification, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, role, loading } = useAuth();
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handleResend() {
    try {
      await sendEmailVerification(user);
      setResent(true);
    } catch {
      // ignore — likely too many requests
    }
  }

  async function handleCheckVerified() {
    setChecking(true);
    try {
      await user.reload();
    } finally {
      setChecking(false);
    }
    window.location.reload();
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Only learners who self-registered need email verification.
  // All other roles (admin, editor, viewer, reviewer) bypass this gate.
  if (role === 'learner' && !user.emailVerified) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
        background: 'var(--bg-primary)',
      }}>
        <span style={{ fontSize: '2.5rem' }}>✉️</span>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Verify your email</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: '360px' }}>
          We sent a verification link to{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{user.email}</strong>.
          Check your inbox and click the link to continue.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={handleResend}
            disabled={resent}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              cursor: resent ? 'default' : 'pointer',
              fontSize: '0.875rem',
              padding: '0.5rem 1rem',
              opacity: resent ? 0.6 : 1,
            }}
          >
            {resent ? 'Sent!' : 'Resend email'}
          </button>
          <button
            onClick={handleCheckVerified}
            disabled={checking}
            style={{
              background: '#238636',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: checking ? 'default' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
              padding: '0.5rem 1rem',
              opacity: checking ? 0.6 : 1,
            }}
          >
            {checking ? 'Checking…' : "I've verified my email"}
          </button>
        </div>
        <button
          onClick={() => signOut(auth)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            padding: '0.25rem',
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return children;
}
