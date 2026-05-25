import { useState, useMemo } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './DocumentProperties.css';

// ── Frontmatter helpers ───────────────────────────────────────────────────────

/** Split raw file content into the YAML frontmatter block and the markdown body. */
function splitFrontmatter(raw = '') {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: '', body: raw };
  return {
    frontmatter: raw.slice(0, end + 4),
    body: raw.slice(end + 4).replace(/^\n/, ''),
  };
}

/** Generic: parse a YAML list key from inner frontmatter content.
 *  Handles both multiline-list and inline-scalar forms. */
function parseYamlListKey(inner, key) {
  const values = [];
  // Multiline list: "key:\n  - X\n  - Y"
  const listRe = new RegExp(`^${key}:\\n((?:[ \\t]+-[ \\t]+.+\\n?)*)`, 'm');
  const listMatch = inner.match(listRe);
  if (listMatch) {
    for (const line of listMatch[1].split('\n')) {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m) values.push(m[1].trim());
    }
    return values;
  }
  // Inline / scalar: "key: Value"
  const inlineRe = new RegExp(`^${key}:[ \\t]+(.+)$`, 'm');
  const inlineMatch = inner.match(inlineRe);
  if (inlineMatch) values.push(inlineMatch[1].trim());
  return values;
}

/** Generic: rewrite a YAML list key inside a frontmatter block string. */
function rebuildFrontmatterKey(frontmatter, key, newValues) {
  const newBlock = newValues.length > 0
    ? `${key}:\n${newValues.map(v => `  - ${v}`).join('\n')}`
    : '';

  if (!frontmatter) {
    return newBlock ? `---\n${newBlock}\n---` : '';
  }

  const inner = frontmatter.slice(4, -4);

  // Multiline list match (zero or more items)
  const multilineRe = new RegExp(`^${key}:\\n(?:[ \\t]+-[ \\t]+.+\\n?)*`, 'm');
  // Inline / scalar match
  const inlineRe = new RegExp(`^${key}:[ \\t]*.+$`, 'm');

  let newInner;
  if (multilineRe.test(inner)) {
    newInner = inner.replace(multilineRe, (match) => {
      const sep = match.endsWith('\n') ? '\n' : '';
      return newBlock ? newBlock + sep : '';
    });
  } else if (inlineRe.test(inner)) {
    newInner = inner.replace(inlineRe, newBlock);
  } else if (newBlock) {
    newInner = inner ? inner + '\n' + newBlock : newBlock;
  } else {
    newInner = inner;
  }

  newInner = newInner.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return `---\n${newInner}\n---`;
}

function parseTagsFromFrontmatter(frontmatter) {
  if (!frontmatter) return [];
  return parseYamlListKey(frontmatter.slice(4, -4), 'tags');
}

function parseCategoriesFromFrontmatter(frontmatter) {
  if (!frontmatter) return [];
  return parseYamlListKey(frontmatter.slice(4, -4), 'category');
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * DocumentProperties — collapsible panel for viewing/editing file tags and asset types.
 *
 * Props:
 *   content   string   — full raw file content (frontmatter + body)
 *   onChange  fn(str)  — called with updated full content on change
 *   readOnly  bool     — if true, values are shown but not editable
 */
export default function DocumentProperties({ content, onChange, readOnly }) {
  const [expanded, setExpanded] = useState(false);
  const { activeTags, activeAssetTypes } = useWorkspace();

  const { frontmatter, body } = useMemo(() => splitFrontmatter(content), [content]);
  const currentTags       = useMemo(() => parseTagsFromFrontmatter(frontmatter),       [frontmatter]);
  const currentCategories = useMemo(() => parseCategoriesFromFrontmatter(frontmatter), [frontmatter]);

  // ── Tag handlers ────────────────────────────────────────────────────────────
  function handleAddTag(tagValue) {
    if (!tagValue || currentTags.includes(tagValue)) return;
    const newFm = rebuildFrontmatterKey(frontmatter, 'tags', [...currentTags, tagValue]);
    onChange(newFm ? newFm + '\n' + body : body);
  }

  function handleRemoveTag(tagValue) {
    const newFm = rebuildFrontmatterKey(frontmatter, 'tags', currentTags.filter(t => t !== tagValue));
    onChange(newFm ? newFm + '\n' + body : body);
  }

  // ── Category handlers ───────────────────────────────────────────────────────
  function handleAddCategory(value) {
    if (!value || currentCategories.includes(value)) return;
    const newFm = rebuildFrontmatterKey(frontmatter, 'category', [...currentCategories, value]);
    onChange(newFm ? newFm + '\n' + body : body);
  }

  function handleRemoveCategory(value) {
    const newFm = rebuildFrontmatterKey(frontmatter, 'category', currentCategories.filter(c => c !== value));
    onChange(newFm ? newFm + '\n' + body : body);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  function getLabelForTag(value) {
    return activeTags.find(t => t.value === value)?.label ?? value;
  }

  const availableTags       = activeTags.filter(t => !currentTags.includes(t.value));
  const availableCategories = activeAssetTypes.filter(c => !currentCategories.includes(c));
  const totalCount = currentTags.length + currentCategories.length;

  return (
    <div className="doc-props">
      <button
        className={`doc-props-toggle${expanded ? ' doc-props-toggle--open' : ''}`}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span className="doc-props-arrow" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="doc-props-toggle-title">Document Properties</span>
        {!expanded && totalCount > 0 && (
          <span className="doc-props-summary" aria-hidden="true">
            {currentTags.slice(0, 2).map(t => (
              <span key={t} className="doc-props-chip doc-props-chip--tag doc-props-chip--preview">
                {getLabelForTag(t)}
              </span>
            ))}
            {currentCategories.slice(0, 2).map(c => (
              <span key={c} className="doc-props-chip doc-props-chip--cat doc-props-chip--preview">
                {c}
              </span>
            ))}
            {totalCount > 4 && (
              <span className="doc-props-more">+{totalCount - 4}</span>
            )}
          </span>
        )}
      </button>

      {expanded && (
        <div className="doc-props-body">

          {/* Tags row */}
          <div className="doc-props-row">
            <span className="doc-props-label">Tags</span>
            <div className="doc-props-tags">
              {currentTags.map(tag => (
                <span key={tag} className="doc-props-chip doc-props-chip--tag">
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

          {/* Asset Type row */}
          <div className="doc-props-row">
            <span className="doc-props-label">Asset Type</span>
            <div className="doc-props-tags">
              {currentCategories.map(cat => (
                <span key={cat} className="doc-props-chip doc-props-chip--cat">
                  <span className="doc-props-chip-label">{cat}</span>
                  {!readOnly && (
                    <button
                      className="doc-props-chip-remove"
                      onClick={() => handleRemoveCategory(cat)}
                      aria-label={`Remove asset type ${cat}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {!readOnly && availableCategories.length > 0 && (
                <select
                  className="doc-props-add-select"
                  value=""
                  onChange={(e) => { if (e.target.value) handleAddCategory(e.target.value); }}
                  aria-label="Add an asset type"
                >
                  <option value="">+ Add type…</option>
                  {availableCategories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
              {currentCategories.length === 0 && (
                <span className="doc-props-empty">
                  {readOnly ? 'No asset type' : 'No asset type — select one above'}
                </span>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

