import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Markdown } from 'tiptap-markdown';
import './RichTextEditor.css';

function ToolbarBtn({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      className={`rte-btn${active ? ' rte-btn--active' : ''}`}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
    >
      {children}
    </button>
  );
}

/**
 * Rich text editor backed by TipTap + tiptap-markdown.
 *
 * Props:
 *   initialContent — markdown string to load on mount (used only once; key by file ID)
 *   onChange(markdown) — called on every content change with the serialised markdown string
 */
export default function RichTextEditor({ initialContent = '', onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Markdown.configure({ html: false, transformCopiedText: true }),
    ],
    content: initialContent,
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.storage.markdown.getMarkdown());
    },
  });

  function addLink() {
    const prev = editor.getAttributes('link').href ?? '';
    const url = window.prompt('Link URL:', prev);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }

  function addImage() {
    const url = window.prompt('Image URL:');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }

  function insertTable() {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  if (!editor) return null;

  return (
    <div className="rte-wrapper">
      {/* Toolbar */}
      <div className="rte-toolbar">
        {/* Inline styles */}
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold (⌘B)"
        >
          <strong>B</strong>
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic (⌘I)"
        >
          <em>I</em>
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Underline (⌘U)"
        >
          <span style={{ textDecoration: 'underline' }}>U</span>
        </ToolbarBtn>

        <span className="rte-divider" />

        {/* Headings */}
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
        >
          H1
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          H2
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
        >
          H3
        </ToolbarBtn>

        <span className="rte-divider" />

        {/* Lists */}
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="2" cy="4" r="1.5" />
            <rect x="5" y="3" width="10" height="2" rx="1" />
            <circle cx="2" cy="8" r="1.5" />
            <rect x="5" y="7" width="10" height="2" rx="1" />
            <circle cx="2" cy="12" r="1.5" />
            <rect x="5" y="11" width="10" height="2" rx="1" />
          </svg>
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <text x="0" y="5" fontSize="5" fontWeight="bold">1.</text>
            <rect x="5" y="3" width="10" height="2" rx="1" />
            <text x="0" y="9" fontSize="5" fontWeight="bold">2.</text>
            <rect x="5" y="7" width="10" height="2" rx="1" />
            <text x="0" y="13" fontSize="5" fontWeight="bold">3.</text>
            <rect x="5" y="11" width="10" height="2" rx="1" />
          </svg>
        </ToolbarBtn>

        <span className="rte-divider" />

        {/* Code block */}
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive('codeBlock')}
          title="Code block"
        >
          {'</>'}
        </ToolbarBtn>

        <span className="rte-divider" />

        {/* Link, Image, Table */}
        <ToolbarBtn
          onClick={addLink}
          active={editor.isActive('link')}
          title="Insert / edit link"
        >
          Link
        </ToolbarBtn>
        <ToolbarBtn onClick={addImage} title="Insert image (URL)">
          Image
        </ToolbarBtn>
        <ToolbarBtn onClick={insertTable} title="Insert table (3×3)">
          Table
        </ToolbarBtn>
      </div>

      {/* Editor body */}
      <EditorContent editor={editor} className="rte-content" />
    </div>
  );
}
