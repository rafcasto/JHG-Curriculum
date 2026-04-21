import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import { fetchAllDocuments } from '../hooks/useDocuments';
import './AppLayout.css';

export default function AppLayout() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshDocuments = useCallback(() => {
    fetchAllDocuments().then(setDocuments).catch(console.error);
  }, []);

  useEffect(() => {
    fetchAllDocuments()
      .then(setDocuments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
