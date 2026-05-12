'use client';

import { useRef, useEffect } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

interface ToolbarButton {
  cmd: string;
  arg?: string;
  label: string;
  title: string;
  className?: string;
}

const BUTTONS: ToolbarButton[] = [
  { cmd: 'bold', label: 'B', title: 'Bold (Ctrl+B)', className: 'font-bold' },
  { cmd: 'italic', label: 'I', title: 'Italic (Ctrl+I)', className: 'italic' },
  { cmd: 'underline', label: 'U', title: 'Underline (Ctrl+U)', className: 'underline' },
  { cmd: 'insertUnorderedList', label: '• List', title: 'Bullet list' },
  { cmd: 'insertOrderedList', label: '1. List', title: 'Numbered list' },
  { cmd: 'formatBlock', arg: 'H3', label: 'H', title: 'Heading', className: 'font-bold' },
  { cmd: 'formatBlock', arg: 'P', label: '¶', title: 'Paragraph' },
  { cmd: 'removeFormat', label: '⨯', title: 'Clear formatting' },
];

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Start writing…',
  minHeight = 180,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const exec = (cmd: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const handleInput = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const isEmpty = !value || value === '<br>' || value === '<p><br></p>';

  return (
    <div className="rounded-lg border border-slate-200 bg-white transition-colors focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 px-2 py-1.5">
        {BUTTONS.map((b, i) => (
          <button
            key={i}
            type="button"
            title={b.title}
            onMouseDown={e => {
              e.preventDefault();
              exec(b.cmd, b.arg);
            }}
            className={`min-w-[26px] cursor-pointer rounded px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-blue-600 ${b.className || ''}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      {/* Editor */}
      <div className="relative">
        {isEmpty && (
          <span className="pointer-events-none absolute left-3 top-3 select-none text-xs text-slate-400">
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleInput}
          style={{ minHeight }}
          className="rich-editor px-3 py-2.5 text-sm leading-relaxed text-slate-800 outline-none"
        />
      </div>
    </div>
  );
}
