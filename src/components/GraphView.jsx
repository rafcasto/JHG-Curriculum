import { useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

const TYPE_COLORS = {
  roadmap:  '#f0883e',
  lesson:   '#58a6ff',
  toolkit:  '#3fb950',
  analysis: '#bc8cff',
  default:  '#8b949e',
};

const MODULE_PALETTE = [
  '#f0883e', '#58a6ff', '#3fb950', '#bc8cff',
  '#e3b341', '#f78166', '#56d364', '#79c0ff',
  '#ff7b72', '#d2a8ff', '#7ee787', '#ffa657',
];

export function buildModuleColors(sortedNames) {
  const colors = {};
  sortedNames.filter((n) => n !== 'other').forEach((name, i) => {
    colors[name] = MODULE_PALETTE[i % MODULE_PALETTE.length];
  });
  colors['other'] = '#8b949e';
  return colors;
}

function getNodeColor(node, colorBy = 'module', moduleColors = {}, tagNodeFill = 'rgba(255,255,255,0.08)') {
  if (node.isTagNode) return tagNodeFill;
  if (colorBy === 'type') return TYPE_COLORS[node.type] ?? TYPE_COLORS.default;
  return moduleColors[node.module] ?? TYPE_COLORS[node.type] ?? TYPE_COLORS.default;
}

// Default settings — keeps behaviour identical to previous version when no settings passed
export const DEFAULT_SETTINGS = {
  repelForce:    -220,
  linkForce:     0.4,
  linkDistance:  120,
  centerForce:   0.0,   // additive; 0 = rely on forceCenter only
  nodeSizeScale: 1,
  linkThickness: 1,
  showOrphans:   true,
  showLabels:    'zoom',   // 'always' | 'zoom' | 'never'
  colorBy:       'module', // 'module' | 'type'
  searchQuery:   '',
};

/**
 * GraphView — Obsidian-style D3 force graph
 *
 * Props:
 *   graphData   { nodes, links }   — full graph from /api/graph
 *   documents   legacy flat array  — fallback (no links)
 *   settings    object             — display/force settings (DEFAULT_SETTINGS shape)
 *   localMode   { centerNodeId, depth }  — render N-hop subgraph around a node
 *   onCounts    fn({ nodes, links })     — called with visible counts after render
 */
export default function GraphView({ graphData, documents, settings: settingsProp, localMode, onCounts }) {
  const svgRef    = useRef(null);
  const zoomRef   = useRef(null);
  const navigate  = useNavigate();
  const { theme } = useTheme();
  const settings  = useMemo(() => ({ ...DEFAULT_SETTINGS, ...(settingsProp ?? {}) }), [settingsProp]);

  // Normalise input into { nodes, links }
  const rawData = graphData ?? {
    nodes: (documents ?? []).map((d) => ({
      id: d.id,
      title: d.title ?? d.id,
      path: d.path ?? '',
      type: d.type ?? 'lesson',
      module: d.module ?? 'other',
      categories: [],
    })),
    links: [],
  };

  const buildGraph = useCallback(() => {
    if (!rawData?.nodes?.length || !svgRef.current) return;

    // Read theme-aware colors from CSS variables
    const st = getComputedStyle(document.documentElement);
    const C = {
      bg:         st.getPropertyValue('--bg-primary').trim(),
      bgSecondary:st.getPropertyValue('--bg-secondary').trim(),
      border:     st.getPropertyValue('--border-color').trim(),
      textMuted:  st.getPropertyValue('--text-secondary').trim(),
      textBody:   st.getPropertyValue('--text-body').trim(),
      textPrimary:st.getPropertyValue('--text-primary').trim(),
      accent:     st.getPropertyValue('--accent').trim(),
      gold:       st.getPropertyValue('--color-gold').trim(),
      dotFill:    theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)',
      tagNodeFill:theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
    };

    const container = svgRef.current.parentElement;
    const W = container.clientWidth  || 900;
    const H = container.clientHeight || 700;

    const sortedModuleNames = [...new Set(rawData.nodes.filter((n) => !n.isTagNode).map((n) => n.module))]
      .sort((a, b) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)));
    const moduleColors = buildModuleColors(sortedModuleNames);
    // ── Local mode: BFS to collect visible node IDs ───────────────────────
    let visibleIds = null;
    if (localMode?.centerNodeId) {
      const { centerNodeId, depth = 1 } = localMode;
      const adj = new Map();
      rawData.links.forEach((l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (!adj.has(s)) adj.set(s, []);
        if (!adj.has(t)) adj.set(t, []);
        adj.get(s).push(t);
        adj.get(t).push(s);
      });
      visibleIds = new Set([centerNodeId]);
      let frontier = [centerNodeId];
      for (let d = 0; d < depth; d++) {
        const next = [];
        frontier.forEach((id) => (adj.get(id) ?? []).forEach((nb) => {
          if (!visibleIds.has(nb)) { visibleIds.add(nb); next.push(nb); }
        }));
        frontier = next;
      }
    }

    // ── Filter nodes/links ────────────────────────────────────────────────
    let nodes = rawData.nodes.map((n) => ({ ...n }));
    let links = rawData.links.map((l) => ({ ...l }));

    if (visibleIds) {
      nodes = nodes.filter((n) => visibleIds.has(n.id));
      links = links.filter((l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return visibleIds.has(s) && visibleIds.has(t);
      });
    }

    // Degree map (before orphan pruning, so sizing is stable)
    const degree = new Map(nodes.map((n) => [n.id, 0]));
    links.forEach((l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      degree.set(s, (degree.get(s) ?? 0) + 1);
      degree.set(t, (degree.get(t) ?? 0) + 1);
    });

    // Orphan filter
    if (!settings.showOrphans) {
      const orphanIds = new Set(nodes.filter((n) => (degree.get(n.id) ?? 0) === 0).map((n) => n.id));
      nodes = nodes.filter((n) => !orphanIds.has(n.id));
    }

    // Search filter — dim non-matching, don't remove
    const query = (settings.searchQuery ?? '').trim().toLowerCase();
    const matchesSearch = (n) => n.isTagNode || !query || n.title.toLowerCase().includes(query);

    onCounts?.({ nodes: nodes.length, links: links.length });

    const maxDeg = Math.max(1, ...degree.values());
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const nodeRadius = (id) => {
      if (nodeById.get(id)?.isTagNode) return 5;
      return (5 + (degree.get(id) ?? 0) / maxDeg * 14) * (settings.nodeSizeScale ?? 1);
    };

    // Adjacency for hover
    const adjacentTo = (nodeId) => {
      const nb = new Set([nodeId]);
      links.forEach((l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (s === nodeId) nb.add(t);
        if (t === nodeId) nb.add(s);
      });
      return nb;
    };

    // ── SVG setup ─────────────────────────────────────────────────────────
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', W)
      .attr('height', H)
      .style('background', C.bg);

    const defs = svg.append('defs');

    // Dot grid background pattern
    const patId = 'dot-grid';
    const pat = defs.append('pattern')
      .attr('id', patId)
      .attr('width', 20)
      .attr('height', 20)
      .attr('patternUnits', 'userSpaceOnUse');
    pat.append('circle')
      .attr('cx', 1).attr('cy', 1).attr('r', 0.8)
      .attr('fill', C.dotFill);

    svg.insert('rect', ':first-child')
      .attr('width', W).attr('height', H)
      .attr('fill', `url(#${patId})`);

    // Glow filter (per-node, colour set dynamically)
    const glowFilter = defs.append('filter')
      .attr('id', 'node-glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    glowFilter.append('feGaussianBlur')
      .attr('in', 'SourceGraphic')
      .attr('stdDeviation', '4')
      .attr('result', 'blur');
    const gm = glowFilter.append('feMerge');
    gm.append('feMergeNode').attr('in', 'blur');
    gm.append('feMergeNode').attr('in', 'blur');
    gm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Zoom behaviour
    const zoom = d3.zoom()
      .scaleExtent([0.05, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        // Fade labels based on zoom level
        if (settings.showLabels === 'zoom') {
          const k = event.transform.k;
          const labelOpacity = Math.min(1, Math.max(0, (k - 0.5) / 0.7));
          nodeEl?.selectAll('text').attr('opacity', (n) =>
            n.isTagNode ? 1 : (!matchesSearch(n) ? 0 : labelOpacity)
          );
        }
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    const g = svg.append('g');

    // ── Zoom-to-fit button ────────────────────────────────────────────────
    const fitBtn = svg.append('g')
      .attr('class', 'zoom-fit-btn')
      .attr('transform', `translate(${W - 44}, 12)`)
      .attr('cursor', 'pointer')
      .style('user-select', 'none');
    fitBtn.append('rect')
      .attr('width', 32).attr('height', 32).attr('rx', 6)
      .attr('fill', C.bgSecondary).attr('stroke', C.border).attr('stroke-width', 1);
    fitBtn.append('text')
      .attr('x', 16).attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('font-size', '14px')
      .attr('fill', C.textMuted)
      .attr('pointer-events', 'none')
      .text('⊡');
    fitBtn.on('click', () => {
      const ns = nodes.filter((n) => n.x != null);
      if (!ns.length) return;
      const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y);
      const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40;
      const y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
      const scale = Math.min(0.9, Math.min(W / (x1 - x0), H / (y1 - y0)));
      const tx = W / 2 - scale * (x0 + x1) / 2;
      const ty = H / 2 - scale * (y0 + y1) / 2;
      svg.transition().duration(600).call(
        zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
    });

    // Click background clears highlight
    svg.on('click', () => resetHighlight());

    // ── Simulation ────────────────────────────────────────────────────────
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((n) => n.id)
        .distance(settings.linkDistance)
        .strength(settings.linkForce))
      .force('charge', d3.forceManyBody().strength(settings.repelForce))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide((n) => nodeRadius(n.id) + 6));

    if (settings.centerForce > 0) {
      simulation
        .force('cx', d3.forceX(W / 2).strength(settings.centerForce))
        .force('cy', d3.forceY(H / 2).strength(settings.centerForce));
    }

    if (!localMode) {
      // Module clustering (global graph only)
      simulation
        .force('moduleX', d3.forceX((n) => {
          const idx = parseInt(n.module?.[0]) || 0;
          return W * 0.15 + (idx % 4) * (W * 0.22);
        }).strength(0.04))
        .force('moduleY', d3.forceY((n) => {
          const idx = parseInt(n.module?.[0]) || 0;
          return H * 0.25 + Math.floor(idx / 4) * (H * 0.4);
        }).strength(0.04));
    } else {
      // Pin center node to canvas center
      const center = nodes.find((n) => n.id === localMode.centerNodeId);
      if (center) { center.fx = W / 2; center.fy = H / 2; }
    }

    // ── Links ─────────────────────────────────────────────────────────────
    const linkEl = g.append('g')
      .attr('fill', 'none')
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('stroke', (l) => l.type === 'wiki' ? C.accent : C.border)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', settings.linkThickness)
      .attr('stroke-dasharray', (l) => l.type === 'tag' ? '4 3' : null);

    // ── Node groups ───────────────────────────────────────────────────────
    const nodeEl = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', (n) => n.isTagNode ? 'default' : 'pointer')
      .call(
        d3.drag()
          .on('start', (event, n) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            n.fx = n.x; n.fy = n.y;
          })
          .on('drag', (event, n) => { n.fx = event.x; n.fy = event.y; })
          .on('end', (event, n) => {
            if (!event.active) simulation.alphaTarget(0);
            // Keep center node pinned in local mode
            if (localMode?.centerNodeId === n.id) return;
            n.fx = null; n.fy = null;
          })
      );

    // Glow halo (behind the main circle)
    nodeEl.append('circle')
      .attr('class', 'node-halo')
      .attr('r', (n) => nodeRadius(n.id) + 4)
      .attr('fill', (n) => getNodeColor(n, settings.colorBy, moduleColors, C.tagNodeFill))
      .attr('opacity', 0)
      .attr('filter', 'url(#node-glow)');;

    // Main circle
    nodeEl.append('circle')
      .attr('class', 'node-circle')
      .attr('r', (n) => nodeRadius(n.id))
      .attr('fill', (n) => n.isTagNode ? C.tagNodeFill : getNodeColor(n, settings.colorBy, moduleColors))
      .attr('stroke', (n) => n.isTagNode ? C.gold : (n.id === localMode?.centerNodeId ? C.textPrimary : C.bg))
      .attr('stroke-width', (n) => n.isTagNode ? 1.5 : (n.id === localMode?.centerNodeId ? 2.5 : 1.5))
      .attr('stroke-dasharray', (n) => n.isTagNode ? '3 2' : null)
      .attr('opacity', (n) => matchesSearch(n) ? 1 : 0.12);

    // Labels
    const labelOpacityInit = settings.showLabels === 'always' ? 1
      : settings.showLabels === 'never' ? 0 : 0;

    nodeEl.append('text')
      .attr('class', 'node-label')
      .attr('dy', (n) => nodeRadius(n.id) + 13)
      .attr('text-anchor', 'middle')
      .attr('font-size', (n) => n.isTagNode ? '8px' : '9px')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('fill', (n) => n.isTagNode ? C.gold : C.textBody)
      .attr('opacity', (n) => n.isTagNode ? 1 : (matchesSearch(n) ? labelOpacityInit : 0))
      .attr('pointer-events', 'none')
      .text((n) => {
        if (n.isTagNode) {
          const label = '#' + n.title;
          return label.length > 20 ? label.slice(0, 18) + '\u2026' : label;
        }
        return n.title.length > 28 ? n.title.slice(0, 26) + '\u2026' : n.title;
      });

    // Search: pulse matching nodes (tag nodes keep their own styling)
    if (query) {
      nodeEl.filter((n) => matchesSearch(n) && !n.isTagNode)
        .select('.node-circle')
        .attr('stroke', C.gold)
        .attr('stroke-width', 2);
      nodeEl.filter((n) => matchesSearch(n))
        .select('.node-label')
        .attr('opacity', 1);
    }

    // ── Highlight helpers ──────────────────────────────────────────────────
    function resetHighlight() {
      nodeEl.select('.node-halo').attr('opacity', 0);
      nodeEl.select('.node-circle')
        .attr('opacity', (n) => (n.isTagNode || matchesSearch(n)) ? 1 : 0.12)
        .attr('stroke-width', (n) => {
          if (n.isTagNode) return 1.5;
          if (query && matchesSearch(n)) return 2;
          return n.id === localMode?.centerNodeId ? 2.5 : 1.5;
        })
        .attr('stroke', (n) => {
          if (n.isTagNode) return C.gold;
          if (query && matchesSearch(n)) return C.gold;
          return n.id === localMode?.centerNodeId ? C.textPrimary : C.bg;
        });
      nodeEl.select('.node-label').attr('opacity', (n) => {
        if (n.isTagNode) return 1;
        if (settings.showLabels === 'never') return 0;
        return matchesSearch(n) ? (settings.showLabels === 'always' ? 1 : 0) : 0;
      });
      linkEl
        .attr('stroke', (l) => l.type === 'wiki' ? C.accent : C.border)
        .attr('stroke-opacity', 0.35)
        .attr('stroke-width', settings.linkThickness);
    }

    // ── Hover ──────────────────────────────────────────────────────────────
    nodeEl
      .on('mouseenter', (event, n) => {
        event.stopPropagation();
        const nb = adjacentTo(n.id);
        const connLinks = new Set(
          links.filter((l) => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return s === n.id || t === n.id;
          })
        );

        nodeEl.select('.node-halo')
          .attr('opacity', (d) => d.id === n.id ? 0.25 : 0);
        nodeEl.select('.node-circle')
          .attr('opacity', (d) => nb.has(d.id) ? 1 : 0.1);
        nodeEl.select('.node-label')
          .attr('opacity', (d) => nb.has(d.id) ? 1 : 0.03)
          .attr('fill', (d) => d.id === n.id ? C.textPrimary : C.textBody);

        linkEl
          .attr('stroke', (l) => connLinks.has(l) ? getNodeColor(n, settings.colorBy, moduleColors, C.tagNodeFill) : C.border)
          .attr('stroke-opacity', (l) => connLinks.has(l) ? 0.85 : 0.05)
          .attr('stroke-width', (l) => connLinks.has(l) ? Math.max(settings.linkThickness, 2) : settings.linkThickness);
      })
      .on('mouseleave', resetHighlight)
      .on('click', (event, n) => {
        event.stopPropagation();
        if (n.isTagNode) return;
        navigate(`/file/${n.id}`);
      });

    // ── Tick ──────────────────────────────────────────────────────────────
    function linkPath(l) {
      const sx = l.source.x ?? 0, sy = l.source.y ?? 0;
      const tx = l.target.x ?? 0, ty = l.target.y ?? 0;
      const dx = tx - sx, dy = ty - sy;
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.8;
      return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`;
    }

    simulation.on('tick', () => {
      linkEl.attr('d', linkPath);
      nodeEl.attr('transform', (n) => `translate(${n.x ?? 0},${n.y ?? 0})`);
    });

    return () => simulation.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(rawData),
    JSON.stringify(settings),
    JSON.stringify(localMode),
    navigate,
    theme,
  ]);

  useEffect(() => {
    const cleanup = buildGraph();
    return cleanup;
  }, [buildGraph]);

  useEffect(() => {
    const ro = new ResizeObserver(() => buildGraph());
    if (svgRef.current?.parentElement) ro.observe(svgRef.current.parentElement);
    return () => ro.disconnect();
  }, [buildGraph]);

  return <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
