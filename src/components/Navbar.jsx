import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './Navbar.css';

export default function Navbar() {
  const { user, role, signOut } = useAuth();
  const { workspaces, currentWorkspace, setCurrentWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  function handleWorkspaceSelect(ws) {
    setCurrentWorkspace(ws);
    setDropdownOpen(false);
    navigate(role === 'reviewer' ? '/review' : '/graph');
  }

  const workspaceLabel = currentWorkspace?.name ?? 'JHG Academy';
  const multiWorkspace = workspaces.length > 1;

  return (
    <header className="navbar">
      <div className="navbar-brand-area" ref={dropdownRef}>
        {multiWorkspace ? (
          <div className="workspace-switcher">
            <button
              className="workspace-switcher-btn"
              onClick={() => setDropdownOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
            >
              <span className="navbar-icon">⬡</span>
              <span className="workspace-name">{workspaceLabel}</span>
              <span className="workspace-caret" aria-hidden="true">▾</span>
            </button>
            {dropdownOpen && (
              <ul className="workspace-dropdown" role="listbox">
                {workspaces.map((ws) => (
                  <li key={ws.id} role="option" aria-selected={ws.id === currentWorkspace?.id}>
                    <button
                      className={`workspace-dropdown-item${ws.id === currentWorkspace?.id ? ' active' : ''}`}
                      onClick={() => handleWorkspaceSelect(ws)}
                    >
                      {ws.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <button className="navbar-brand" onClick={() => navigate('/graph')}>
            <span className="navbar-icon">⬡</span>
            {workspaceLabel}
          </button>
        )}
      </div>

      <div className="navbar-right">
        {role === 'admin' && (
          <button className="navbar-users-link" onClick={() => navigate('/admin/users')}>
            Users
          </button>
        )}
        {role === 'reviewer' && (
          <button className="navbar-users-link" onClick={() => navigate('/review')}>
            My Documents
          </button>
        )}
        {role === 'admin' && <span className="role-badge">Admin</span>}
        {role === 'editor' && <span className="role-badge role-badge--editor">Editor</span>}
        {role === 'reviewer' && <span className="role-badge role-badge--reviewer">Reviewer</span>}
        <span className="navbar-email">{user?.email}</span>
        <button className="signout-btn" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
