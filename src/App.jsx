import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import GraphPage from './pages/GraphPage';
import FilePage from './pages/FilePage';
import AdminPage from './pages/AdminPage';
import AdminRoute from './components/AdminRoute';

function App() {
  return (
    <AuthProvider>
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
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/file/:id" element={<FilePage />} />
            <Route
              path="/admin/users"
              element={
                <AdminRoute>
                  <AdminPage />
                </AdminRoute>
              }
            />
            <Route path="/" element={<Navigate to="/graph" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/graph" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App
