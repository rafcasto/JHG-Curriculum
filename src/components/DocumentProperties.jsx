import { useState, useMemo } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './DocumentProperties.css';

// ── Frontmatter helpers ───────────────────────────────────────────────────────

/** Split raw file content into the YAML frontmatter block and the markdown body.
 *  Mirrors the same function in FilePage so changes stay in sync. */
function splitFrontmatter(raw = '') {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: '', body: raw };
  return {
    frontmatter: raw.slice(0, end + 4),
    body: raw.slice(end + 4).replace(/^\n/, ''),
  };
}

/** Parse the tags array from a frontmatter block string.
 *  Handles the standard multi-line YAML list format used in this codebase. */
function parseTagsFromFrontmatter(frontmatter) {
  if (!frontmatter) return [];
  // frontmatter is "---\n…\n---"; inner content is between the delimiters
  const inner = frontmatter.slice(4, -4);
  const tags = [];
  const tagsBlock = inner.match(/^tags:\n((?:[ \t]+-[ \t]+.+\n?)*)/m);
  if (tagsBlock) {
    for (const line of tagsBlock[1].split('\n')) {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m) tags.push(m[1].trim());
    }
  }
  return tags;
}

/** Return a new frontmatter block string with the tags array replaced.
 *  Handles multiline-list, inline-scalar, and missing tags key. */
function rebuildFrontmatterWithTags(frontmatter, newTags) {
  const newTagsBlock = newTags.length > 0
    ? `tags:\n${newTags.map(t => `  - ${t}`).join('\n')}`
    : '';

  if (!frontmatter) {
    return newTagsBlock ? `---\n${newTagsBlock}\n---` : '';
  }

  const inner = frontmatter.slice(4, -4);

  // Multiline list: "tags:\n  - X\n  - Y\n" — may or may not have trailing newline
  const multilineRe = /^tags:\n(?:[ \t]+-[ \t]+.+\n?)*/m;
  // Inline / scalar: "tags: something"
  const inlineRe = /^tags:[ \t]*.+$/m;

  let newInner;
  if (multilineRe.test(inner)) {
    newInner = inner.replace(multilineRe, (match) => {
      // Preserve the trailing separator newline so subsequent keys stay separated
      const sep = match.endsWith('\n') ? '\n' : '';
      return newTagsBlock ? newTagsBlock + sep : '';
    });
  } else if (inlineRe.test(inner)) {
    newInner = inner.replace(inlineRe, newTagsBlock);
  } else if (newTagsBlock) {
    newInner = inner ? inner + '\n' + newTagsBlock : newTagsBlock;
  } else {
    newInner = inner;
  }

  // Tidy up: collapse 3+ consecutive newlines, strip leading blank lines
  newInner = newInner.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return `---\n${newInner}\n---`;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * DocumentProperties — collapsible panel for viewing/editing file tags.
 *
 * Props:
 *   content   string   — full raw file content (frontmatter + body)
 *   onChange  fn(str)  — called with updated full content when tags change
 *   readOnly  bool     — if true, tags are shown but not editable
 */
export default function DocumentProperties({ content, onChange, readOnly }) {
  const [expanded, setExpanded] = useState(false);
  const { activeTags } = useWorkspace();

  const { frontmatter, body } = useMemo(() => splitFrontmatter(content), [content]);
  const currentTags = useMemo(() => parseTagsFromFrontmatter(frontmatter), [frontmatter]);

  function handleAddTag(tagValue) {
    if (!tagValue || currentTags.includes(tagValue)) return;
    const newTags = [...currentTags, tagValue];
    const newFm = rebuildFrontmatterWithTags(frontmatter, newTags);
    onChange(newFm ? newFm + '\n' + body : body);
  }

  function handleRemoveTag(tagValue) {
    const newTags = currentTags.filter(t => t !== tagValue);
    const newFm = rebuildFrontmatterWithTags(frontmatter, newTags);
    onChange(newFm ? newFm + '\n' + body : body);
  }

  function getLabelForTag(value) {
    return activeTags.find(t => t.value === value)?.label ?? value;
  }

  const availableTags = activeTags.filter(t => !currentTags.includes(t.value));

  return (
    <div className="doc-props">
      <button
        className={`doc-props-toggle${expanded ? ' doc-props-toggle--open' : ''}`}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span className="doc-props-arrow" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="doc-props-toggle-title">Document Properties</span>
        {!expanded && currentTags.length > 0 && (
          <span className="doc-props-summary" aria-hidden="true">
            {currentTags.slice(0, 3).map(t => (
              <span key={t} className="doc-props-chip doc-props-chip--preview">
                {getLabelForTag(t)}
              </span>
            ))}
            {currentTags.length > 3 && (
              <span className="doc-props-more">+{currentTags.length - 3}</span>
            )}
          </span>
        )}
      </button>

      {expanded && (
        <div className="doc-props-body">
          <div className="doc-props-row">
            <span className="doc-props-label">Tags</span>
            <div className="doc-props-tags">
              {currentTags.map(tag => (
                <span key={tag} className="doc-props-chip">
                  <span className="doc-props-chip-label">{getLabelForTag(tag)}</span>
                  {!readOnly && (
                    <button
                      className="doc-props-chip-remove"
                      onClick={() => handleRemoveTag(tag)}
                      aria-label={`Remove tag ${getLabelForTag(tag)}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {!readOnly && availableTags.length > 0 && (
                <select
                  className="doc-props-add-select"
                  value=""
                  onChange={(e) => { if (e.target.value) handleAddTag(e.target.value); }}
                  aria-label="Add a tag"
                >
                  <option value="">+ Add tag…</option>
                  {availableTags.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              )}
              {currentTags.length === 0 && (
                <span className="doc-props-empty">
                  {readOnly ? 'No tags' : 'No tags — select one above'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
