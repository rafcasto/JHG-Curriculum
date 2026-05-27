import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { useLayoutEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { UserProfileProvider } from './contexts/UserProfileContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import GraphPage from './pages/GraphPage';
import FilePage from './pages/FilePage';
import AdminPage from './pages/AdminPage';
import ReviewerPage from './pages/ReviewerPage';
import ProfilePage from './pages/ProfilePage';
import CertificatesPage from './pages/CertificatesPage';
import CertificatePage from './pages/CertificatePage';
import AdminRoute from './components/AdminRoute';

/** Redirects to /review for reviewers and learners, /graph for everyone else. */
function RoleRedirect() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    if (loading) return;
    if (role === 'reviewer' || role === 'learner') {
      navigate('/review', { replace: true });
    } else {
      navigate('/graph', { replace: true });
    }
  }, [loading, role, navigate]);
  return null;
}

/** Blocks reviewers and learners from accessing a route — redirects them to /review. */
function ReviewerBlock({ children }) {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    if (loading) return;
    if (role === 'reviewer' || role === 'learner') {
      navigate('/review', { replace: true });
    }
  }, [loading, role, navigate]);
  if (loading) return null;
  if (role === 'reviewer' || role === 'learner') return null;
  return children;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <UserProfileProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />

              {/* Public certificate page — no auth required */}
              <Route path="/certificate/:uid" element={<CertificatePage />} />

              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/graph" element={<ReviewerBlock><GraphPage /></ReviewerBlock>} />
                <Route path="/file/:id" element={<FilePage />} />
                <Route path="/review" element={<ReviewerPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/certificates" element={<CertificatesPage />} />
                <Route
                  path="/admin/users"
                  element={
                    <AdminRoute>
                      <AdminPage />
                    </AdminRoute>
                  }
                />
                <Route path="/" element={<RoleRedirect />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          </UserProfileProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App
