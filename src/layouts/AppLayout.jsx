import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import { fetchAllDocuments } from '../hooks/useDocuments';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import './AppLayout.css';

export default function AppLayout() {
  const { currentWorkspace } = useWorkspace();
  const { role } = useAuth();
  const isReviewer = role === 'reviewer';
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshDocuments = useCallback(() => {
    if (isReviewer) return;
    fetchAllDocuments(currentWorkspace?.driveFolderId ?? null).then(setDocuments).catch(console.error);
  }, [currentWorkspace, isReviewer]);

  useEffect(() => {
    if (isReviewer) { setLoading(false); return; }
    setLoading(true);
    fetchAllDocuments(currentWorkspace?.driveFolderId ?? null)
      .then(setDocuments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentWorkspace, isReviewer]);

  return (
    <div className="app-layout">
      <Navbar />
      <div className="app-body">
        {!isReviewer && <Sidebar documents={documents} loading={loading} onRefresh={refreshDocuments} />}
        <main className="app-main">
          <Outlet context={{ refreshDocuments }} />
        </main>
      </div>
    </div>
  );
}
