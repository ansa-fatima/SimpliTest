'use client';

import { useRef, useState } from 'react';
import { fileToDataUrl, formatBytes } from '@/lib/utils';
import { CaseAttachment } from '@/types';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Shared by NewTestCaseModal and TestCaseEdit so the two forms can't quietly
// drift apart on what "an attachment" means. Files ride inline as base64
// data URLs (same trick as User.avatarUrl) -- no object storage, so a modest
// per-file cap and a small max count keep the JSON column reasonable.
export function AttachmentsField({
  attachments,
  onChange,
}: {
  attachments: CaseAttachment[];
  onChange: (next: CaseAttachment[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setError(`Max ${MAX_ATTACHMENTS} attachments per case.`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    const tooBig = picked.find(f => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setError(`"${tooBig.name}" is over the 5 MB per-file limit.`);
      return;
    }
    setBusy(true);
    try {
      const next: CaseAttachment[] = await Promise.all(
        picked.map(async f => ({ name: f.name, dataUrl: await fileToDataUrl(f), size: f.size })),
      );
      onChange([...attachments, ...next]);
    } catch {
      setError('Could not read one of those files.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy || attachments.length >= MAX_ATTACHMENTS}
        className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-strong bg-surface-2 px-3 py-4 text-center transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <i
          className={
            busy
              ? 'ti ti-loader-2 animate-spin text-[18px] text-text-3'
              : 'ti ti-upload text-[18px] text-text-3'
          }
        />
        <span className="text-[12px] text-text-2">
          <b className="font-semibold text-text">Drop files</b> or click to browse
        </span>
        <span className="text-[10.5px] text-text-3">Any file type · up to 5 MB · max 5 files</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {error && <p className="text-[11px] text-danger">{error}</p>}

      {attachments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {attachments.map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5"
            >
              <i className="ti ti-paperclip flex-shrink-0 text-[13px] text-text-3" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-text">{a.name}</span>
              <span className="flex-shrink-0 text-[10.5px] text-text-3">{formatBytes(a.size)}</span>
              <button
                type="button"
                onClick={() => onChange(attachments.filter((_, idx) => idx !== i))}
                className="flex-shrink-0 text-text-3 hover:text-danger"
              >
                <i className="ti ti-x text-[13px]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
