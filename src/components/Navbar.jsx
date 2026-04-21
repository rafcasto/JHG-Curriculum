import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Navbar.css';

export default function Navbar() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <header className="navbar">
      <button className="navbar-brand" onClick={() => navigate('/graph')}>
        <span className="navbar-icon">⬡</span>
        JHG Academy
      </button>

      <div className="navbar-right">
        {role === 'admin' && (
          <button className="navbar-users-link" onClick={() => navigate('/admin/users')}>
            Users
          </button>
        )}
        {role === 'admin' && <span className="role-badge">Admin</span>}
        {role === 'editor' && <span className="role-badge role-badge--editor">Editor</span>}
        <span className="navbar-email">{user?.email}</span>
        <button className="signout-btn" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
