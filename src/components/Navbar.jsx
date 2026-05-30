import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useTheme } from '../contexts/ThemeContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import './Navbar.css';

export default function Navbar() {
  const { user, role, signOut } = useAuth();
  const { workspaces, currentWorkspace, setCurrentWorkspace } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const dropdownRef = useRef(null);
  const profileMenuRef = useRef(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSignOut() {
    setProfileMenuOpen(false);
    await signOut();
    navigate('/login', { replace: true });
  }

  function handleWorkspaceSelect(ws) {
    setCurrentWorkspace(ws);
    setDropdownOpen(false);
    navigate(role === 'reviewer' || role === 'learner' ? '/review' : '/graph');
  }

  const workspaceLabel = currentWorkspace?.name ?? 'AI Academy';
  const multiWorkspace = workspaces.length > 1;

  const initials = profile?.firstName && profile?.lastName
    ? `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase()
    : (user?.email?.[0] ?? '?').toUpperCase();

  const displayName = profile?.firstName
    ? `${profile.firstName} ${profile.lastName ?? ''}`.trim()
    : user?.email ?? '';


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
          <button className="navbar-brand" onClick={() => navigate(role === 'reviewer' || role === 'learner' ? '/review' : '/graph')}>
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
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* Profile avatar + dropdown */}
        <div className="profile-menu-wrap" ref={profileMenuRef}>
          <button
            className="profile-avatar-btn"
            onClick={() => setProfileMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={profileMenuOpen}
            title="Account"
          >
            {profile?.photoURL ? (
              <img src={profile.photoURL} alt={displayName} className="profile-avatar-img" />
            ) : (
              <span className={`profile-avatar-initials profile-avatar-initials--${role ?? 'viewer'}`}>
                {initials}
              </span>
            )}
          </button>

          {profileMenuOpen && (
            <div className="profile-menu" role="menu">
              <div className="profile-menu-header">
                <span className="profile-menu-header-avatar">
                  {profile?.photoURL ? (
                    <img src={profile.photoURL} alt={displayName} className="profile-menu-header-img" />
                  ) : (
                    <span className={`profile-avatar-initials profile-avatar-initials--${role ?? 'viewer'}`}>
                      {initials}
                    </span>
                  )}
                </span>
                <span className="profile-menu-header-text">
                  <span className="profile-menu-display-name">{displayName}</span>
                  <span className="profile-menu-email">{user?.email}</span>
                </span>
              </div>
              <div className="profile-menu-divider" />
              <button
                className="profile-menu-item"
                role="menuitem"
                onClick={() => { setProfileMenuOpen(false); navigate('/profile'); }}
              >
                <svg className="profile-menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Your profile
              </button>
              <button
                className="profile-menu-item"
                role="menuitem"
                onClick={() => { setProfileMenuOpen(false); navigate('/certificates'); }}
              >
                <svg className="profile-menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="6" />
                  <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
                </svg>
                Certificates &amp; badges
              </button>
              <div className="profile-menu-divider" />
              <button
                className="profile-menu-item"
                role="menuitem"
                onClick={handleSignOut}
              >
                <svg className="profile-menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
