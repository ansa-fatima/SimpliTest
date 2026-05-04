'use client';

import { TestCase } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { priorityBadge, severityBadge, typeBadge } from '@/lib/utils';

interface TestCaseViewProps {
  tc: TestCase;
  currentKey: string;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function TestCaseView({ tc, currentKey, onBack, onEdit, onDelete, onDuplicate }: TestCaseViewProps) {
  const [mod, feat] = currentKey.split(':');

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          ← Back
        </button>
        <div className="flex-1 text-xs text-slate-400">
          {mod} / {feat} / <span className="font-mono font-semibold text-slate-800">{tc.id}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="danger" onClick={onDelete}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M10 8v5M6 8v5M3 4l1 9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-9"/></svg>
            Delete
          </Button>
          <Button variant="default" onClick={onDuplicate}>Duplicate</Button>
          <Button variant="primary" onClick={onEdit}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg>
            Edit
          </Button>
        </div>
      </div>

      {/* Props bar */}
      <div className="flex flex-wrap bg-white border-b border-slate-200">
        {[
          { label: 'Case ID', content: <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{tc.id}</span> },
          { label: 'Module', content: <span className="text-xs font-semibold text-slate-800">{mod}</span> },
          { label: 'Feature', content: <span className="text-xs font-semibold text-slate-800">{tc.feature}</span> },
          { label: 'Priority', content: <Badge className={priorityBadge(tc.priority)}>{tc.priority}</Badge> },
          { label: 'Severity', content: <Badge className={severityBadge(tc.severity)}>{tc.severity}</Badge> },
          { label: 'Test type', content: <Badge className={typeBadge(tc.type)}>{tc.type}</Badge> },
        ].map(({ label, content }) => (
          <div key={label} className="flex flex-col gap-1 px-4 py-2.5 border-r border-slate-100 last:border-r-0">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{label}</span>
            {content}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
        {/* Title */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">Title</p>
          <h2 className="text-lg font-bold text-slate-900">{tc.title}</h2>
        </div>
        <hr className="border-slate-100" />

        {/* Description */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">Description</p>
          <p className="text-sm text-slate-700 leading-relaxed">{tc.desc || '—'}</p>
        </div>
        <hr className="border-slate-100" />

        {/* Steps */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">Steps</p>
          {tc.steps.length === 1 && /<\/?[a-z][\s\S]*>/i.test(tc.steps[0]) ? (
            <div
              className="rich-editor text-sm text-slate-700 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: tc.steps[0] }}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {tc.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-blue-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-slate-700 leading-relaxed flex-1">{step}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <hr className="border-slate-100" />

        {/* Expected result */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">Expected result</p>
          <p className="text-sm text-slate-700 leading-relaxed">{tc.expected || '—'}</p>
        </div>
        <hr className="border-slate-100" />

        {/* Meta */}
        <div className="flex items-center gap-5">
          <span className="text-xs text-slate-400">📅 Created {tc.created}</span>
          <span className="text-xs text-slate-400">👤 {tc.author}</span>
          <span className="text-xs text-slate-400">✏️ Updated {tc.updatedFull}</span>
        </div>
      </div>
    </div>
  );
}
