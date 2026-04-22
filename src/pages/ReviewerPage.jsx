import { useWorkspace } from '../contexts/WorkspaceContext';
import './ReviewerPage.css';

export default function ReviewerPage() {
  const { currentWorkspace } = useWorkspace();

  return (
    <div className="rv-welcome">
      <div className="rv-welcome-inner">
        <p className="rv-welcome-icon" aria-hidden="true">&#128196;</p>
        <h1 className="rv-welcome-heading">Ready to review?</h1>
        <p className="rv-welcome-text">
          Select a document from the sidebar to get started.
        </p>
        {currentWorkspace && (
          <span className="rv-welcome-workspace">{currentWorkspace.name}</span>
        )}
      </div>
    </div>
  );
}

