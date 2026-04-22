import { useEffect, useState, useCallback } from 'react';
import GraphView, { DEFAULT_SETTINGS, buildModuleColors } from '../components/GraphView';
import GraphSettings from '../components/GraphSettings';
import TableView from '../components/TableView';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './GraphPage.css';

export default function GraphPage() {
  const { currentWorkspace } = useWorkspace();
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [settings, setSettings]   = useState(DEFAULT_SETTINGS);
  const [counts, setCounts]       = useState({ nodes: 0, links: 0 });
  const [view, setView]           = useState('graph'); // 'graph' | 'table'

  useEffect(() => {
    setLoading(true);
    setError(null);
    setGraphData(null);
    const folderId = currentWorkspace?.driveFolderId;
    const url = folderId
      ? `/api/graph?folderId=${encodeURIComponent(folderId)}`
      : '/api/graph';
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`Graph load failed (${r.status})`); return r.json(); })
      .then(setGraphData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentWorkspace]);

  const handleSettingsChange = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  if (loading) {
    return (
      <div className="graph-loading">
        <div className="spinner" />
        <p>Building knowledge graph…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="graph-error">
        <p>Failed to load graph: {error}</p>
      </div>
    );
  }

  const modules = [...new Set(graphData.nodes.filter((n) => !n.isTagNode).map((n) => n.module))]
    .sort((a, b) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)));
  const moduleColors = buildModuleColors(modules);

  return (
    <div className="graph-page">

      {/* ── View toggle toolbar ── */}
      <div className="graph-toolbar">
        <div className="view-toggle">
          <button
            className={view === 'graph' ? 'active' : ''}
            onClick={() => setView('graph')}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="4" cy="4" r="2.5" />
              <circle cx="12" cy="4" r="2.5" />
              <circle cx="8" cy="12" r="2.5" />
              <line x1="4" y1="4" x2="12" y2="4" stroke="currentColor" strokeWidth="1.2" />
              <line x1="4" y1="4" x2="8" y2="12" stroke="currentColor" strokeWidth="1.2" />
              <line x1="12" y1="4" x2="8" y2="12" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            Graph
          </button>
          <button
            className={view === 'table' ? 'active' : ''}
            onClick={() => setView('table')}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="1" width="14" height="3" rx="1" />
              <rect x="1" y="6" width="14" height="3" rx="1" opacity="0.7" />
              <rect x="1" y="11" width="14" height="3" rx="1" opacity="0.5" />
            </svg>
            Table
          </button>
        </div>
        {view === 'graph' && (
          <span className="graph-toolbar-counts">{counts.nodes} nodes · {counts.links} links</span>
        )}
      </div>

      {/* ── Graph view ── */}
      {view === 'graph' && (
        <div className="graph-canvas">
          <GraphView
            graphData={graphData}
            settings={settings}
            onCounts={setCounts}
          />
          <GraphSettings
            settings={settings}
            onChange={handleSettingsChange}
            nodeCount={counts.nodes}
            linkCount={counts.links}
          />
        </div>
      )}

      {/* ── Table view ── */}
      {view === 'table' && <TableView nodes={graphData.nodes} />}

      {/* ── Module legend (graph only) ── */}
      {view === 'graph' && (
        <div className="graph-legend">
          {modules.map((m) => (
            <span key={m} className="legend-item">
              <span className="legend-dot" style={{ background: moduleColors[m] ?? '#8b949e' }} />
              {m.replace(/^\d+\.\s+/, '')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
