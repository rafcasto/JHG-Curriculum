import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import { fetchAllDocuments } from '../hooks/useDocuments';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './AppLayout.css';

export default function AppLayout() {
  const { currentWorkspace } = useWorkspace();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshDocuments = useCallback(() => {
    if (!currentWorkspace) return;
    fetchAllDocuments(currentWorkspace.driveFolderId).then(setDocuments).catch(console.error);
  }, [currentWorkspace]);

  useEffect(() => {
    if (!currentWorkspace) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAllDocuments(currentWorkspace.driveFolderId)
      .then(setDocuments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentWorkspace]);

  return (
    <div className="app-layout">
      <Navbar />
      <div className="app-body">
        <Sidebar documents={documents} loading={loading} onRefresh={refreshDocuments} />
        <main className="app-main">
          <Outlet context={{ refreshDocuments }} />
        </main>
      </div>
    </div>
  );
}
