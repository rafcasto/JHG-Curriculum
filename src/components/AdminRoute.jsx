import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/** Allows only users with the admin role. Redirects others to /graph. */
export default function AdminRoute({ children }) {
  const { role, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  return role === 'admin' ? children : <Navigate to="/graph" replace />;
}
