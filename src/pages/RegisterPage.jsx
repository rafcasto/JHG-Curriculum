import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import './RegisterPage.css';

export default function RegisterPage() {
  const { workspaceId } = useParams();
  const [workspaceName, setWorkspaceName] = useState('');
  const [pageState, setPageState] = useState('loading'); // 'loading' | 'unavailable' | 'form' | 'success'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/register?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.registrationEnabled) {
          setWorkspaceName(data.name);
          setPageState('form');
        } else {
          setPageState('unavailable');
        }
      })
      .catch(() => setPageState('unavailable'));
  }, [workspaceId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // 1. Create account via server API
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, name, email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Registration failed');

      // 2. Sign in briefly to establish a session, then sign out — user must
      //    verify their email (sent by the server) before accessing the app
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await signOut(auth);
      void credential; // suppress lint warning

      setPageState('success');
    } catch (err) {
      const messages = {
        'auth/email-already-in-use': 'An account with this email already exists.',
        'auth/weak-password': 'Password is too weak. Please use at least 8 characters.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/too-many-requests': 'Too many attempts. Please try again later.',
      };
      setError(messages[err.code] ?? err.message ?? 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (pageState === 'loading') {
    return (
      <div className="register-container">
        <div className="loading-screen">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (pageState === 'unavailable') {
    return (
      <div className="register-container">
        <div className="register-card">
          <div className="register-logo">
            <span className="register-logo-icon">⬡</span>
            <h1>AI Academy</h1>
          </div>
          <p className="register-unavailable">Registration is not available for this workspace.</p>
          <Link to="/login" className="register-link register-link--block">Back to Sign In</Link>
        </div>
      </div>
    );
  }

  if (pageState === 'success') {
    return (
      <div className="register-container">
        <div className="register-card">
          <div className="register-logo">
            <span className="register-logo-icon">⬡</span>
            <h1>Check your inbox</h1>
            <p>We sent a verification link to <strong>{email}</strong></p>
          </div>
          <p className="register-success-body">
            Click the link in that email to verify your address, then{' '}
            <Link to="/login" className="register-link">sign in</Link> to access {workspaceName}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="register-container">
      <div className="register-card">
        <div className="register-logo">
          <span className="register-logo-icon">⬡</span>
          <h1>AI Academy</h1>
          <p>Create your account — {workspaceName}</p>
        </div>

        <form onSubmit={handleSubmit} className="register-form">
          {error && <div className="register-error" role="alert">{error}</div>}

          <div className="register-field">
            <label htmlFor="reg-name">Full Name</label>
            <input
              id="reg-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              autoComplete="name"
            />
          </div>

          <div className="register-field">
            <label htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="register-field">
            <label htmlFor="reg-password">Password</label>
            <div className="register-password-wrapper">
              <input
                id="reg-password"
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
                className="register-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button type="submit" className="register-button" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="register-signin-prompt">
          Already have an account?{' '}
          <Link to="/login" className="register-link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
