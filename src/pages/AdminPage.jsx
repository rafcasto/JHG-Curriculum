import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import './AdminPage.css';

const ROLES = ['admin', 'editor', 'viewer'];

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

  if (role && role !== 'admin') return null;

  return (
    <div className="admin-page">
      <h1 className="admin-title">User Management</h1>

      {/* Add user form */}
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

      {/* User list */}
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
    </div>
  );
}
