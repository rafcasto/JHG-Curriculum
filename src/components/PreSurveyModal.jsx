import WarmupQuestion from './WarmupQuestion';
import './ReviewModal.css';

/**
 * Modal wrapper for the pre-reading warmup question.
 * Has no close button — reviewer must complete the warmup to proceed.
 *
 * Props:
 *   documentId   — Drive file ID
 *   user         — Firebase Auth user object
 *   submission   — current submission (null = none yet)
 *   onSubmitted  — called with the new submission object on success
 */
export default function PreSurveyModal({ documentId, user, submission, onSubmitted }) {
  return (
    <div className="rmodal-backdrop">
      <div className="rmodal-card">
        <WarmupQuestion
          documentId={documentId}
          user={user}
          submission={submission}
          onSubmitted={onSubmitted}
        />
      </div>
    </div>
  );
}
