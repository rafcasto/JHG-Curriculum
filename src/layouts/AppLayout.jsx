import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import ReviewerSidebar from '../components/ReviewerSidebar';
import { fetchAllDocuments } from '../hooks/useDocuments';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import './AppLayout.css';

export default function AppLayout() {
  const { currentWorkspace } = useWorkspace();
  const { role, user } = useAuth();
  const isReviewer = role === 'reviewer';

  // ── Editor / Admin: Drive documents ────────────────────────────────────
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshDocuments = useCallback(() => {
    if (isReviewer) return;
    fetchAllDocuments(currentWorkspace?.driveFolderId ?? null).then(setDocuments).catch(console.error);
  }, [currentWorkspace, isReviewer]);

  const updateDocumentTitle = useCallback((docId, newTitle) => {
    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, title: newTitle } : d));
  }, []);

  useEffect(() => {
    if (isReviewer) { setLoading(false); return; }
    setLoading(true);
    fetchAllDocuments(currentWorkspace?.driveFolderId ?? null)
      .then(setDocuments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentWorkspace, isReviewer]);

  // ── Reviewer: assigned documents + submission statuses ─────────────────
  const [reviewDocs, setReviewDocs] = useState([]);
  const [reviewSubmissions, setReviewSubmissions] = useState({});
  const [reviewLoading, setReviewLoading] = useState(false);

  const loadReviewerData = useCallback(async () => {
    if (!isReviewer || !currentWorkspace?.id || !user) return;
    setReviewLoading(true);
    try {
      const token = await user.getIdToken();

      // Fetch assigned docs and Drive file list in parallel
      const [docsRes, driveFiles] = await Promise.all([
        fetch(
          `/api/documents?workspaceId=${encodeURIComponent(currentWorkspace.id)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        fetchAllDocuments(currentWorkspace?.driveFolderId ?? null).catch(() => []),
      ]);

      if (!docsRes.ok) return;
      const docs = await docsRes.json();

      // Build driveFileId → path map so we can group by folder (module) like editors
      const pathMap = {};
      for (const f of driveFiles) {
        pathMap[f.id] = f.path ?? '';
      }

      // Enrich each reviewer doc with its Drive path
      const enrichedDocs = docs.map((d) => ({
        ...d,
        drivePath: pathMap[d.driveFileId] ?? '',
      }));

      setReviewDocs(enrichedDocs);

      const subResults = await Promise.allSettled(
        docs.map(async (doc) => {
          const res = await fetch(
            `/api/submissions?documentId=${encodeURIComponent(doc.driveFileId)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const data = res.ok ? await res.json() : null;
          return { driveFileId: doc.driveFileId, submission: data };
        })
      );
      const subMap = {};
      for (const r of subResults) {
        if (r.status === 'fulfilled' && r.value.submission) {
          subMap[r.value.driveFileId] = r.value.submission;
        }
      }
      setReviewSubmissions(subMap);
    } catch {
      // non-fatal
    } finally {
      setReviewLoading(false);
    }
  }, [isReviewer, currentWorkspace, user]);

  useEffect(() => {
    loadReviewerData();
  }, [loadReviewerData]);

  /** Called from FilePage when a reviewer's submission changes (warmup or complete). */
  const onReviewSubmissionUpdated = useCallback((driveFileId, submission) => {
    setReviewSubmissions((prev) => ({ ...prev, [driveFileId]: submission }));
  }, []);

  return (
    <div className="app-layout">
      <Navbar />
      <div className="app-body">
        {isReviewer ? (
          <ReviewerSidebar
            documents={reviewDocs}
            submissions={reviewSubmissions}
            loading={reviewLoading}
          />
        ) : (
          <Sidebar documents={documents} loading={loading} onRefresh={refreshDocuments} onDocumentRenamed={updateDocumentTitle} />
        )}
        <main className="app-main">
          <Outlet context={{ refreshDocuments, onReviewSubmissionUpdated, reviewDocs, reviewLoading }} />
        </main>
      </div>
    </div>
  );
}
