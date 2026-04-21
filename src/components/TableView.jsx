import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import './TableView.css';

const TAG_FILTER_OPTIONS = [
  { label: 'All Tags', value: '' },
  { label: 'Preparation', value: '0. preparation' },
  { label: 'Focus', value: '1. focus' },
  { label: 'Value', value: '2. value' },
  { label: 'Profile', value: '3. profile' },
  { label: 'Applications', value: '4. applications' },
  { label: 'Network', value: '5. network' },
  { label: 'Interviews', value: '6. interviews' },
  { label: 'Deal', value: '7. deal' },
  { label: 'Other', value: 'other' },
];

const ASSET_FILTER_OPTIONS = [
  { label: 'All Asset Types', value: '' },
  { label: 'Infographic', value: 'Infographic' },
  { label: 'Lesson - Text', value: 'Lesson - Text' },
  { label: 'Lesson - Example', value: 'Lesson - Example' },
  { label: 'Lesson - Video', value: 'Lesson - Video' },
  { label: 'Homework - Instructions', value: 'Homework - Instructions' },
  { label: 'Homework - Template example', value: 'Homework - Template example' },
  { label: 'Homework - AI Prompt', value: 'Homework - AI Prompt' },
];

function normalizeCategory(cat) {
  if (!cat) return '';
  const c = cat.toLowerCase();
  if (c.includes('infographic')) return 'Infographic';
  if (c.includes('lesson') && c.includes('text')) return 'Lesson - Text';
  if (c.includes('lesson') && c.includes('example')) return 'Lesson - Example';
  if (c.includes('lesson') && c.includes('video')) return 'Lesson - Video';
  if (c.includes('homework') && c.includes('template')) return 'Homework - Template example';
  if (c.includes('homework') && (c.includes('instruction') || c.includes('exercise'))) return 'Homework - Instructions';
  if (c.includes('homework') && (c.includes('ai') || c.includes('prompt'))) return 'Homework - AI Prompt';
  return cat;
}

export default function TableView({ nodes }) {
  const navigate = useNavigate();
  const [tagFilter, setTagFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');

  const rows = useMemo(() => {
    return (nodes ?? [])
      .filter((n) => !n.isTagNode)
      .filter((n) => !tagFilter || n.module === tagFilter)
      .filter((n) => {
        if (!assetFilter) return true;
        return (n.categories ?? []).some((c) => normalizeCategory(c) === assetFilter);
      });
  }, [nodes, tagFilter, assetFilter]);

  return (
    <div className="table-view">
      <div className="table-filters">
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          {TAG_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
          {ASSET_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="table-count">{rows.length} file{rows.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="table-scroll">
        <table className="table-main">
          <thead>
            <tr>
              <th>File Name</th>
              <th>Tag</th>
              <th>Asset Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const assetTypes = (n.categories ?? [])
                .map(normalizeCategory)
                .filter(Boolean);
              return (
                <tr key={n.id} onClick={() => navigate(`/file/${n.id}`)}>
                  <td className="col-name">{n.title}</td>
                  <td className="col-tag">
                    <span className="tag-pill">
                      {n.module.replace(/^\d+\.\s+/, '')}
                    </span>
                  </td>
                  <td className="col-asset">
                    {assetTypes.length > 0
                      ? assetTypes.map((t) => <span key={t} className="asset-pill">{t}</span>)
                      : <span className="empty-cell">—</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="empty-state">No files match the selected filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
