import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import GraphPage from './pages/GraphPage';
import FilePage from './pages/FilePage';
import AdminPage from './pages/AdminPage';
import ReviewerPage from './pages/ReviewerPage';
import AdminRoute from './components/AdminRoute';

/** Redirects to /review for reviewers, /graph for everyone else. */
function RoleRedirect() {
  const { role, loading } = useAuth();
  if (loading) return null;
  if (role === 'reviewer') return <Navigate to="/review" replace />;
  return <Navigate to="/graph" replace />;
}

/** Blocks reviewers from accessing a route — redirects them to /review. */
function ReviewerBlock({ children }) {
  const { role, loading } = useAuth();
  if (loading) return null;
  if (role === 'reviewer') return <Navigate to="/review" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

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
      </WorkspaceProvider>
    </AuthProvider>
  );
}

export default App
