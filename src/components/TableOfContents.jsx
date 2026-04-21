import { useEffect, useRef, useState, useMemo } from 'react';
import './TableOfContents.css';

/** Convert a heading string to a URL-safe id, matching the heading renderers in FilePage. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
}

/** Strip YAML frontmatter (---…---) so its keys don't appear as headings. */
function stripFrontmatter(raw = '') {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return raw;
  return raw.slice(end + 4).replace(/^\n/, '');
}

/** Parse H1/H2/H3 headings from a markdown string. */
function parseHeadings(content) {
  const body = stripFrontmatter(content);
  const headingRe = /^(#{1,3})\s+(.+)$/gm;
  const results = [];
  let match;
  while ((match = headingRe.exec(body)) !== null) {
    const level = match[1].length;
    const text = match[2].trim().replace(/\*\*|__|~~|`/g, ''); // strip simple inline markdown
    results.push({ level, text, id: slugify(text) });
  }
  return results;
}

export default function TableOfContents({ content, scrollRef }) {
  const headings = useMemo(() => parseHeadings(content), [content]);
  const [activeId, setActiveId] = useState(null);
  const observerRef = useRef(null);

  useEffect(() => {
    if (headings.length < 2) return;

    // Clean up any previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const handleIntersect = (entries) => {
      // Find the topmost intersecting heading
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) {
        setActiveId(visible[0].target.id);
      }
    };

    const observer = new IntersectionObserver(handleIntersect, {
      root: scrollRef?.current ?? null,
      rootMargin: '-10% 0px -70% 0px',
      threshold: 0,
    });

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    observerRef.current = observer;
    return () => observer.disconnect();
  }, [headings, scrollRef]);

  if (headings.length < 2) return null;

  const handleClick = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  };

  return (
    <nav className="toc-panel" aria-label="On this page">
      <p className="toc-label">ON THIS PAGE</p>
      <ul className="toc-list">
        {headings.map(({ level, text, id }) => (
          <li
            key={id}
            className={`toc-item toc-item--h${level}${activeId === id ? ' toc-item--active' : ''}`}
          >
            <button
              className="toc-link"
              onClick={() => handleClick(id)}
              title={text}
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
