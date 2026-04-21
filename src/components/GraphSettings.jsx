import { useState } from 'react';
import './GraphSettings.css';

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="gs-section">
      <button className="gs-section-header" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className="gs-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="gs-section-body">{children}</div>}
    </div>
  );
}

function Slider({ label, min, max, step = 1, value, onChange, format }) {
  const display = format ? format(value) : value;
  return (
    <label className="gs-slider-row">
      <span className="gs-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="gs-range"
      />
      <span className="gs-value">{display}</span>
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="gs-toggle-row">
      <span className="gs-label">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        className={`gs-switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      />
    </label>
  );
}

function RadioGroup({ label, options, value, onChange }) {
  return (
    <div className="gs-radio-group">
      <span className="gs-label">{label}</span>
      <div className="gs-radio-options">
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`gs-radio-btn${value === opt.value ? ' active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * GraphSettings panel — collapsible right-side drawer.
 *
 * Props:
 *   settings  — current settings object (DEFAULT_SETTINGS shape from GraphView)
 *   onChange  — fn(patch) called with partial settings update
 *   nodeCount — visible node count shown in header
 *   linkCount — visible link count shown in header
 */
export default function GraphSettings({ settings, onChange, nodeCount, linkCount }) {
  const [open, setOpen] = useState(false);

  const patch = (key, val) => onChange({ [key]: val });

  return (
    <>
      {/* gear toggle button */}
      <button
        className="gs-toggle-btn"
        onClick={() => setOpen((o) => !o)}
        title="Graph settings"
        aria-label="Graph settings"
      >
        ⚙
      </button>

      <div className={`gs-drawer${open ? ' gs-drawer--open' : ''}`}>
        <div className="gs-header">
          <span className="gs-title">Graph</span>
          <span className="gs-counts">{nodeCount ?? 0} nodes · {linkCount ?? 0} links</span>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <Section title="Filters">
          <label className="gs-search-row">
            <span className="gs-label">Search</span>
            <input
              type="text"
              className="gs-search-input"
              placeholder="Filter nodes…"
              value={settings.searchQuery}
              onChange={(e) => patch('searchQuery', e.target.value)}
            />
          </label>
          <Toggle
            label="Show orphans"
            checked={settings.showOrphans}
            onChange={(v) => patch('showOrphans', v)}
          />
        </Section>

        {/* ── Groups ──────────────────────────────────────────────────── */}
        <Section title="Groups">
          <RadioGroup
            label="Color by"
            value={settings.colorBy}
            onChange={(v) => patch('colorBy', v)}
            options={[
              { value: 'module', label: 'Module' },
              { value: 'type',   label: 'Type'   },
            ]}
          />
        </Section>

        {/* ── Display ─────────────────────────────────────────────────── */}
        <Section title="Display">
          <Slider
            label="Node size"
            min={0.5} max={2} step={0.1}
            value={settings.nodeSizeScale}
            onChange={(v) => patch('nodeSizeScale', v)}
            format={(v) => v.toFixed(1) + '×'}
          />
          <Slider
            label="Link thickness"
            min={0.5} max={4} step={0.5}
            value={settings.linkThickness}
            onChange={(v) => patch('linkThickness', v)}
            format={(v) => v + 'px'}
          />
          <RadioGroup
            label="Labels"
            value={settings.showLabels}
            onChange={(v) => patch('showLabels', v)}
            options={[
              { value: 'always', label: 'Always' },
              { value: 'zoom',   label: 'On zoom' },
              { value: 'never',  label: 'Never'   },
            ]}
          />
        </Section>

        {/* ── Forces ──────────────────────────────────────────────────── */}
        <Section title="Forces" defaultOpen={false}>
          <Slider
            label="Repel"
            min={-1000} max={-10} step={10}
            value={settings.repelForce}
            onChange={(v) => patch('repelForce', v)}
            format={(v) => v}
          />
          <Slider
            label="Link force"
            min={0.1} max={2} step={0.1}
            value={settings.linkForce}
            onChange={(v) => patch('linkForce', v)}
            format={(v) => v.toFixed(1)}
          />
          <Slider
            label="Link distance"
            min={30} max={400} step={10}
            value={settings.linkDistance}
            onChange={(v) => patch('linkDistance', v)}
            format={(v) => v + 'px'}
          />
          <Slider
            label="Center force"
            min={0} max={1} step={0.05}
            value={settings.centerForce}
            onChange={(v) => patch('centerForce', v)}
            format={(v) => v.toFixed(2)}
          />
        </Section>
      </div>

      {/* Backdrop on mobile */}
      {open && <div className="gs-backdrop" onClick={() => setOpen(false)} />}
    </>
  );
}
