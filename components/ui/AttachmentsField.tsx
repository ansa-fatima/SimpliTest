'use client';

import { useRef, useState } from 'react';
import { fileToDataUrl, formatBytes, cn } from '@/lib/utils';
import { CaseAttachment } from '@/types';
import { Ico } from '@/components/features/tc-icons';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Used by the Test Case form (create + edit) so the two flows can't quietly
// drift apart on what "an attachment" means. Files ride inline as base64 data
// URLs (same trick as User.avatarUrl) -- no object storage, so a modest
// per-file cap and a small max count keep the JSON column reasonable.
//
// Styled with the `.tcv3` dropzone/attach-row classes (testcase-v3.css), so it
// must render inside a `.tcv3` container. Supports click-to-browse and
// drag-and-drop.
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
  const [drag, setDrag] = useState(false);
  const full = attachments.length >= MAX_ATTACHMENTS;

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

  const browse = () => {
    if (!busy && !full) inputRef.current?.click();
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={cn('dropzone', drag && 'drag', (busy || full) && 'disabled')}
        onClick={browse}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            browse();
          }
        }}
        onDragOver={e => {
          e.preventDefault();
          if (!full) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault();
          setDrag(false);
          if (!full) addFiles(e.dataTransfer.files);
        }}
      >
        <div className="dz-icon">
          <Ico name="upload-cloud" />
        </div>
        <div>
          <b>Drop files here</b> or <span className="browse">browse</span> to upload
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--t-4)', marginTop: 6 }}>
          Screenshots, design specs, requirement docs · Any file type · up to 5 MB · max 5 files
        </div>
      </div>
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
      {error && <p className="attach-error">{error}</p>}

      {attachments.length > 0 && (
        <div className="attach-list">
          {attachments.map((a, i) => (
            <div key={`${a.name}-${i}`} className="attach-row">
              <Ico name="file" />
              <span className="name">{a.name}</span>
              <span className="size">{formatBytes(a.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => onChange(attachments.filter((_, idx) => idx !== i))}
              >
                <Ico name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
