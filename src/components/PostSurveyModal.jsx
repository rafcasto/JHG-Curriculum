import FeedbackForm from './FeedbackForm';
import './ReviewModal.css';

/**
 * Modal wrapper for the post-reading feedback form.
 * Includes a close button so the reviewer can keep reading if needed.
 *
 * Props:
 *   documentId     — Drive file ID
 *   user           — Firebase Auth user object
 *   submission     — current submission (must be status 'draft')
 *   reviewDuration — elapsed review time in seconds
 *   onSubmitted    — called with updated submission on success
 *   onClose        — called when the close button is clicked
 */
export default function PostSurveyModal({
  documentId,
  user,
  submission,
  reviewDuration,
  onSubmitted,
  onClose,
}) {
  return (
    <div className="rmodal-backdrop">
      <div className="rmodal-card rmodal-card--large">
        <button className="rmodal-close" onClick={onClose} aria-label="Close survey">
          ✕
        </button>
        <FeedbackForm
          documentId={documentId}
          user={user}
          submission={submission}
          reviewDuration={reviewDuration}
          onSubmitted={onSubmitted}
        />
      </div>
    </div>
  );
}
