import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspace, setCurrentWorkspaceState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [globalCatalog, setGlobalCatalog] = useState({ tags: [], assetTypes: [] });

  // Fetch global catalog once on mount (no auth required)
  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .then((data) => {
        setGlobalCatalog({
          tags: data.tags ?? [],
          assetTypes: data.assetTypes ?? [],
        });
      })
      .catch(() => {});
  }, []);

  // Computed active tags for the current workspace:
  //   inheritGlobalCatalog !== false → deduped union of global + workspace tags
  //   inheritGlobalCatalog === false → workspace-only tags
  //   no workspace selected         → global only
  const activeTags = useMemo(() => {
    const wsTags = currentWorkspace?.tags ?? [];
    const inherit = currentWorkspace?.inheritGlobalCatalog !== false;
    if (!currentWorkspace || inherit) {
      const map = new Map();
      [...globalCatalog.tags, ...wsTags].forEach((t) => map.set(t.value, t));
      return [...map.values()];
    }
    return wsTags;
  }, [currentWorkspace, globalCatalog.tags]);

  const activeAssetTypes = useMemo(() => {
    const wsTypes = currentWorkspace?.assetTypes ?? [];
    const inherit = currentWorkspace?.inheritGlobalCatalog !== false;
    if (!currentWorkspace || inherit) {
      return [...new Set([...globalCatalog.assetTypes, ...wsTypes])];
    }
    return wsTypes;
  }, [currentWorkspace, globalCatalog.assetTypes]);

  const fetchWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setCurrentWorkspaceState(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/workspaces', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      setWorkspaces(data);

      // Restore persisted workspace selection, fallback to first workspace
      const saved = localStorage.getItem(`workspace_${user.uid}`);
      const match = data.find((w) => w.id === saved);
      setCurrentWorkspaceState(match ?? data[0] ?? null);
    } catch (e) {
      console.error('[WorkspaceContext]', e.message);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  function setCurrentWorkspace(workspace) {
    setCurrentWorkspaceState(workspace);
    if (user && workspace) {
      localStorage.setItem(`workspace_${user.uid}`, workspace.id);
    }
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        setCurrentWorkspace,
        loading,
        error,
        refreshWorkspaces: fetchWorkspaces,
        globalCatalog,
        activeTags,
        activeAssetTypes,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
