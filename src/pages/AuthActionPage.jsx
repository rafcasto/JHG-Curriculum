/**
 * /auth/action
 *
 * Custom Firebase Auth action handler. Firebase console must be configured to
 * use this URL as the "Custom action URL" for both Password Reset and Email
 * Verification templates:
 *   Firebase Console → Authentication → Email Templates → Customize action URL
 *   → https://[your-domain]/auth/action
 *
 * URL params supplied by Firebase:
 *   mode        resetPassword | verifyEmail | recoverEmail
 *   oobCode     one-time action code
 *   continueUrl post-completion redirect (from actionCodeSettings.url)
 *   apiKey      Firebase project key (unused here — SDK handles it)
 *   lang        locale (unused)
 */

import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  applyActionCode,
  confirmPasswordReset,
  signInWithEmailAndPassword,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { auth } from '../firebase';
import './AuthActionPage.css';

// ── Shared card shell ────────────────────────────────────────────────────────
function ActionCard({ children }) {
  return (
    <div className="auth-action-container">
      <div className="auth-action-card">
        <div className="auth-action-logo">
          <span className="auth-action-logo-icon">⬡</span>
          <h1>AI Academy</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── verifyEmail mode ─────────────────────────────────────────────────────────
function VerifyEmailHandler({ oobCode, continueUrl }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!oobCode) {
      setErrorMsg('Missing verification code.');
      setStatus('error');
      return;
    }
    applyActionCode(auth, oobCode)
      .then(() => {
        // Small delay so the user sees the success state before being redirected
        setTimeout(() => {
          navigate(continueUrl ?? '/login?verified=true', { replace: true });
        }, 1800);
        setStatus('success');
      })
      .catch((err) => {
        const messages = {
          'auth/invalid-action-code': 'This verification link is invalid or has already been used.',
          'auth/expired-action-code': 'This verification link has expired. Please request a new one.',
          'auth/user-disabled': 'This account has been disabled.',
        };
        setErrorMsg(messages[err.code] ?? err.message ?? 'Verification failed.');
        setStatus('error');
      });
  }, [oobCode, continueUrl, navigate]);

  if (status === 'loading') {
    return (
      <ActionCard>
        <div className="auth-action-spinner-wrap">
          <div className="auth-action-spinner" />
          <p className="auth-action-subtext">Verifying your email&hellip;</p>
        </div>
      </ActionCard>
    );
  }

  if (status === 'success') {
    return (
      <ActionCard>
        <div className="auth-action-result auth-action-result--success">
          <span className="auth-action-result-icon">✓</span>
          <h2>Email verified</h2>
          <p>Redirecting you to sign in&hellip;</p>
        </div>
      </ActionCard>
    );
  }

  return (
    <ActionCard>
      <div className="auth-action-result auth-action-result--error">
        <span className="auth-action-result-icon">✕</span>
        <h2>Verification failed</h2>
        <p>{errorMsg}</p>
        <Link to="/login" className="auth-action-btn auth-action-btn--primary">Go to Login</Link>
      </div>
    </ActionCard>
  );
}

// ── resetPassword mode ───────────────────────────────────────────────────────
function ResetPasswordHandler({ oobCode, continueUrl }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | form | submitting | success | error
  const [errorMsg, setErrorMsg] = useState('');

  // Verify the oobCode is valid before showing the form
  useEffect(() => {
    if (!oobCode) {
      setErrorMsg('Missing reset code.');
      setStatus('error');
      return;
    }
    verifyPasswordResetCode(auth, oobCode)
      .then((accountEmail) => {
        setEmail(accountEmail);
        setStatus('form');
      })
      .catch((err) => {
        const messages = {
          'auth/invalid-action-code': 'This password-set link is invalid or has already been used.',
          'auth/expired-action-code': 'This password-set link has expired. Please request a new one.',
          'auth/user-disabled': 'This account has been disabled.',
        };
        setErrorMsg(messages[err.code] ?? err.message ?? 'Invalid link.');
        setStatus('error');
      });
  }, [oobCode]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    setErrorMsg('');
    setStatus('submitting');
    try {
      await confirmPasswordReset(auth, oobCode, password);

      // Auto sign-in so the learner lands directly on the platform
      try {
        await signInWithEmailAndPassword(auth, email, password);
        navigate(continueUrl ?? '/', { replace: true });
      } catch {
        // Sign-in failed (e.g. network) — fall back to login page with success message
        navigate('/login?password_set=true', { replace: true });
      }
    } catch (err) {
      const messages = {
        'auth/invalid-action-code': 'This link is invalid or has already been used.',
        'auth/expired-action-code': 'This link has expired. Please request a new one.',
        'auth/weak-password': 'Password is too weak. Please choose a stronger password.',
      };
      setErrorMsg(messages[err.code] ?? err.message ?? 'Failed to set password.');
      setStatus('form');
    }
  }

  if (status === 'loading') {
    return (
      <ActionCard>
        <div className="auth-action-spinner-wrap">
          <div className="auth-action-spinner" />
          <p className="auth-action-subtext">Loading&hellip;</p>
        </div>
      </ActionCard>
    );
  }

  if (status === 'error') {
    return (
      <ActionCard>
        <div className="auth-action-result auth-action-result--error">
          <span className="auth-action-result-icon">✕</span>
          <h2>Invalid link</h2>
          <p>{errorMsg}</p>
          <Link to="/login" className="auth-action-btn auth-action-btn--primary">Go to Login</Link>
        </div>
      </ActionCard>
    );
  }

  return (
    <ActionCard>
      <div className="auth-action-body">
        <h2 className="auth-action-heading">Set your password</h2>
        {email && (
          <p className="auth-action-subtext">
            Setting password for <strong>{email}</strong>
          </p>
        )}
        <form onSubmit={handleSubmit} className="auth-action-form">
          {errorMsg && (
            <div className="auth-action-alert auth-action-alert--error" role="alert">
              {errorMsg}
            </div>
          )}
          <div className="auth-action-field">
            <label htmlFor="aa-password">New password</label>
            <div className="auth-action-password-wrap">
              <input
                id="aa-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="auth-action-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          <div className="auth-action-field">
            <label htmlFor="aa-confirm">Confirm password</label>
            <input
              id="aa-confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            className="auth-action-btn auth-action-btn--primary"
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? 'Setting password\u2026' : 'Set Password'}
          </button>
        </form>
      </div>
    </ActionCard>
  );
}

// ── Root component ───────────────────────────────────────────────────────────
export default function AuthActionPage() {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const oobCode = searchParams.get('oobCode');
  const continueUrl = searchParams.get('continueUrl');

  if (mode === 'verifyEmail') {
    return <VerifyEmailHandler oobCode={oobCode} continueUrl={continueUrl} />;
  }

  if (mode === 'resetPassword') {
    return <ResetPasswordHandler oobCode={oobCode} continueUrl={continueUrl} />;
  }

  // Unknown or missing mode
  return (
    <ActionCard>
      <div className="auth-action-result auth-action-result--error">
        <span className="auth-action-result-icon">✕</span>
        <h2>Invalid link</h2>
        <p>This link is invalid or has expired. Please request a new one from the login page.</p>
        <Link to="/login" className="auth-action-btn auth-action-btn--primary">Go to Login</Link>
      </div>
    </ActionCard>
  );
}
