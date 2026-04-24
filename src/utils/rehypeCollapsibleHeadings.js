/**
 * Rehype plugin: wrap h1/h2/h3 sections in <details open><summary> so they
 * are collapsible in the preview, matching Obsidian's fold-arrow behavior.
 *
 * Algorithm (recursive by heading level):
 *   groupByLevel(nodes, level) groups siblings into "sections" at `level`.
 *   Each section is: [headingNode, ...followingSiblings until next h<=level].
 *   The section body is then recursively processed at level+1.
 *   The result is wrapped in a HAST <details open> with a <summary> for the heading.
 *   Nodes before the first heading at this level pass through unchanged.
 *   h4+ are never wrapped (left as plain siblings in the section body).
 */

function makeDetails(summaryHeading, bodyNodes) {
  return {
    type: 'element',
    tagName: 'details',
    properties: { open: true },
    children: [
      {
        type: 'element',
        tagName: 'summary',
        properties: {},
        children: [summaryHeading],
      },
      ...bodyNodes,
    ],
  };
}

function isHeading(node, maxLevel) {
  if (node.type !== 'element') return false;
  const m = node.tagName.match(/^h([1-6])$/);
  return m && parseInt(m[1], 10) <= maxLevel;
}

function headingLevel(node) {
  const m = node.tagName.match(/^h([1-6])$/);
  return m ? parseInt(m[1], 10) : 99;
}

function groupByLevel(nodes, level) {
  if (level > 3) return nodes; // h4+ are not wrapped

  const result = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];

    // If this node is a heading AT the current level, start a section
    if (node.type === 'element' && headingLevel(node) === level) {
      const sectionBody = [];
      i++;

      // Collect siblings until we hit a heading of equal or higher rank
      while (i < nodes.length && !isHeading(nodes[i], level)) {
        sectionBody.push(nodes[i]);
        i++;
      }

      // Recursively wrap nested headings inside the body
      const processedBody = groupByLevel(sectionBody, level + 1);
      result.push(makeDetails(node, processedBody));
    } else {
      // Could be nodes before the first heading, or deeper-level headings
      // that weren't consumed by a parent — just pass through
      result.push(node);
      i++;
    }
  }

  return result;
}

export default function rehypeCollapsibleHeadings() {
  return function (tree) {
    tree.children = groupByLevel(tree.children, 1);
  };
}
