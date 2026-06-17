'use client';

import { useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { parseCSV } from '@/lib/csv';
import { cn } from '@/lib/utils';

interface PortalSuggestion {
  name: string;
  modules: { name: string; suites: { name: string }[] }[];
}

interface ImportCsvModalProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  /** Called after a successful import so the parent can refetch the in-page tree. */
  onImported: (summary: ImportSummary) => void;
  /** Existing portals from the workspace — populates suggestion dropdowns when the
   *  CSV has no "Section Hierarchy" column and the user has to pick a target. */
  portalSuggestions?: PortalSuggestion[];
}

interface ImportSummary {
  createdPortals: number;
  createdModules: number;
  createdSuites: number;
  createdCases: number;
  skipped: { row: number; reason: string }[];
  totalRows: number;
}

interface HierarchyPreview {
  portal: string;
  module: string;
  suite: string;
  count: number;
}

export function ImportCsvModal({
  projectId,
  projectName,
  onClose,
  onImported,
  portalSuggestions = [],
}: ImportCsvModalProps) {
  // Fallback target — used when the CSV has no "Section Hierarchy" column.
  const [fbPortal, setFbPortal] = useState('');
  const [fbModule, setFbModule] = useState('');
  const [fbSuite, setFbSuite] = useState('General');
  const inputRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Browser-side preview parsing — never hits the API. ──
  const preview = useMemo(() => {
    if (!csvText) return null;
    try {
      const rows = parseCSV(csvText);
      if (rows.length < 2) {
        return { error: 'CSV looks empty — at least a header + one row required.' as const };
      }
      const header = rows[0].map(h => h.trim());
      const titleIdx = header.indexOf('Title');
      const hierIdx = header.indexOf('Section Hierarchy');
      const sectionIdx = header.indexOf('Section');
      if (titleIdx < 0) {
        return { error: 'Missing required column "Title"' as const };
      }

      const groups = new Map<string, HierarchyPreview>();
      let totalCases = 0;
      const needsFallback = hierIdx < 0; // no hierarchy column at all → need user-supplied target

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!(r[titleIdx] || '').trim()) continue;
        totalCases++;

        let portal: string;
        let moduleName: string;
        let suite: string;

        if (hierIdx >= 0 && (r[hierIdx] || '').trim()) {
          // Per-row hierarchy
          let parts = (r[hierIdx] || '')
            .split('>')
            .map(s => s.trim())
            .filter(Boolean);
          if (parts.length > 0 && parts[0].toLowerCase() === projectName.toLowerCase()) {
            parts = parts.slice(1);
          }
          suite = parts[parts.length - 1] || fbSuite || 'General';
          moduleName = parts[parts.length - 2] || fbModule || 'Default module';
          portal =
            parts.slice(0, parts.length - 2).join(' / ') ||
            (parts.length === 1 ? fbPortal || 'Default portal' : parts[0]) ||
            fbPortal ||
            'Default portal';
        } else if (sectionIdx >= 0 && (r[sectionIdx] || '').trim()) {
          // Single-section column → suite. Portal/module come from fallback.
          portal = fbPortal || 'Default portal';
          moduleName = fbModule || 'Default module';
          suite = (r[sectionIdx] || '').trim();
        } else {
          // No row hierarchy — everything pivots on fallback.
          portal = fbPortal || 'Default portal';
          moduleName = fbModule || 'Default module';
          suite = fbSuite || 'General';
        }

        const key = `${portal}|${moduleName}|${suite}`;
        const existing = groups.get(key);
        if (existing) existing.count++;
        else groups.set(key, { portal, module: moduleName, suite, count: 1 });
      }

      return {
        totalCases,
        totalRows: rows.length - 1,
        needsFallback,
        // True if fallback is required but not fully filled (button disabled).
        fallbackIncomplete:
          needsFallback && (!fbPortal.trim() || !fbModule.trim() || !fbSuite.trim()),
        groups: Array.from(groups.values()).sort((a, b) =>
          a.portal === b.portal
            ? a.module === b.module
              ? a.suite.localeCompare(b.suite)
              : a.module.localeCompare(b.module)
            : a.portal.localeCompare(b.portal),
        ),
      };
    } catch (e) {
      return { error: `Failed to parse CSV: ${(e as Error).message}` as const };
    }
  }, [csvText, projectName, fbPortal, fbModule, fbSuite]);

  const ingest = (file: File) => {
    setError(null);
    setResult(null);
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Please pick a .csv file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File is larger than 10 MB');
      return;
    }
    setFileName(file.name);
    file
      .text()
      .then(setCsvText)
      .catch(e => setError((e as Error).message));
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) ingest(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) ingest(f);
  };

  const submit = async () => {
    if (!csvText || importing) return;
    setImporting(true);
    setError(null);
    try {
      const summary = await api.post<ImportSummary>('/api/test-cases/import-csv', {
        projectId,
        csv: csvText,
        fallback: {
          portalName: fbPortal.trim() || undefined,
          moduleName: fbModule.trim() || undefined,
          suiteName: fbSuite.trim() || undefined,
        },
      });
      setResult(summary);
      onImported(summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-text">Import test cases from CSV</h2>
            <p className="mt-0.5 text-[12px] text-text-3">
              Auto-creates Portal / Module / Suite from the{' '}
              <span className="font-mono">Section Hierarchy</span> column, then inserts each test
              case.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="rounded p-1 text-text-3 hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {result ? (
            // ── Success view ───────────────────────────────────
            <SuccessView result={result} />
          ) : (
            <>
              {/* Drop zone */}
              <div
                onDrop={onDrop}
                onDragOver={e => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-10 transition-colors',
                  dragOver
                    ? 'border-primary bg-primary-light/50'
                    : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <i className="ti ti-file-upload text-[32px] text-text-3" />
                <p className="text-[13px] font-medium text-text">
                  {fileName ? fileName : 'Drop a CSV here, or click to browse'}
                </p>
                <p className="text-[11px] text-text-3">.csv files up to 10 MB · max 10,000 rows</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={onFilePick}
                />
              </div>

              {/* Expected format hint */}
              <details className="mt-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-2">
                <summary className="cursor-pointer font-medium">
                  Expected columns (TestRail export format)
                </summary>
                <p className="mt-2 leading-relaxed">
                  <strong>Required:</strong> <code className="rounded bg-surface px-1">Title</code>,{' '}
                  <code className="rounded bg-surface px-1">Section Hierarchy</code>.
                </p>
                <p className="mt-1 leading-relaxed">
                  <strong>Optional:</strong> Description, Expected Result, Steps, Preconditions,
                  Priority, Severity, Test Type, Created By.
                </p>
                <p className="mt-1 leading-relaxed">
                  <strong>Section Hierarchy</strong> is split on{' '}
                  <code className="rounded bg-surface px-1">{' > '}</code>. The first segment
                  matching your workspace name is stripped automatically.
                </p>
              </details>

              {/* Fallback target — surfaced when the CSV has no "Section Hierarchy" column */}
              {preview && !('error' in preview) && preview.needsFallback && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                  <div className="mb-2 flex items-start gap-2">
                    <i className="ti ti-info-circle mt-0.5 text-[14px] text-amber-600" />
                    <div>
                      <p className="text-[12.5px] font-semibold text-amber-800">
                        No <span className="font-mono">Section Hierarchy</span> column found
                      </p>
                      <p className="text-[11.5px] text-amber-700/90">
                        Pick where these {preview.totalCases} test case
                        {preview.totalCases === 1 ? '' : 's'} should land. The folders will be
                        created if they don&apos;t exist yet.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <FallbackInput
                      label="Portal"
                      value={fbPortal}
                      onChange={setFbPortal}
                      placeholder="e.g. Admin Web"
                      suggestions={portalSuggestions.map(p => p.name)}
                    />
                    <FallbackInput
                      label="Module"
                      value={fbModule}
                      onChange={setFbModule}
                      placeholder="e.g. Academic"
                      suggestions={
                        portalSuggestions
                          .find(p => p.name.toLowerCase() === fbPortal.toLowerCase())
                          ?.modules.map(m => m.name) ?? []
                      }
                    />
                    <FallbackInput
                      label="Suite"
                      value={fbSuite}
                      onChange={setFbSuite}
                      placeholder="General"
                      suggestions={
                        portalSuggestions
                          .find(p => p.name.toLowerCase() === fbPortal.toLowerCase())
                          ?.modules.find(m => m.name.toLowerCase() === fbModule.toLowerCase())
                          ?.suites.map(s => s.name) ?? []
                      }
                    />
                  </div>
                </div>
              )}

              {/* Preview */}
              {preview && 'error' in preview && (
                <div className="mt-3 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
                  {preview.error}
                </div>
              )}
              {preview && !('error' in preview) && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
                      Preview · {preview.totalCases} test case
                      {preview.totalCases === 1 ? '' : 's'} across {preview.groups.length} suite
                      {preview.groups.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border">
                    <table className="w-full text-[12px]">
                      <thead className="bg-surface-2">
                        <tr>
                          <th className="border-b border-border px-3 py-2 text-left font-medium text-text-3">
                            Portal
                          </th>
                          <th className="border-b border-border px-3 py-2 text-left font-medium text-text-3">
                            Module
                          </th>
                          <th className="border-b border-border px-3 py-2 text-left font-medium text-text-3">
                            Suite
                          </th>
                          <th className="w-[60px] border-b border-border px-3 py-2 text-right font-medium text-text-3">
                            Cases
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.groups.map((g, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-3 py-1.5 text-text">{g.portal}</td>
                            <td className="px-3 py-1.5 text-text-2">{g.module}</td>
                            <td className="px-3 py-1.5 text-text-2">{g.suite}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-text">
                              {g.count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[11px] text-text-3">
                    Any of these that don&apos;t exist yet will be created inside{' '}
                    <span className="font-medium text-text">{projectName}</span>.
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-3 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
          {result ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-[7px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={importing}
                className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={
                  !csvText ||
                  importing ||
                  (preview !== null && 'error' in preview) ||
                  (preview !== null && !('error' in preview) && preview.fallbackIncomplete)
                }
                className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
                <i className="ti ti-upload text-[13px]" />
                Import
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SuccessView({ result }: { result: ImportSummary }) {
  return (
    <div>
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <i className="ti ti-circle-check text-[20px] text-emerald-600" />
        <div>
          <p className="text-[13px] font-semibold text-emerald-700">Import complete</p>
          <p className="text-[12px] text-emerald-700/80">
            {result.createdCases} test case{result.createdCases === 1 ? '' : 's'} added to your
            workspace.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <SuccessCard label="Portals" value={result.createdPortals} icon="ti-app-window" />
        <SuccessCard label="Modules" value={result.createdModules} icon="ti-folder-plus" />
        <SuccessCard label="Suites" value={result.createdSuites} icon="ti-folders" />
        <SuccessCard
          label="Test cases"
          value={result.createdCases}
          icon="ti-clipboard-check"
          highlight
        />
      </div>

      {result.skipped.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-3">
            Skipped rows ({result.skipped.length})
          </p>
          <div className="max-h-[160px] overflow-y-auto rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-2">
            {result.skipped.slice(0, 50).map((s, i) => (
              <p key={i}>
                Row {s.row}: <span className="text-text-3">{s.reason}</span>
              </p>
            ))}
            {result.skipped.length > 50 && (
              <p className="mt-1 italic text-text-3">…and {result.skipped.length - 50} more.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FallbackInput({
  label,
  value,
  onChange,
  placeholder,
  suggestions,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suggestions: string[];
}) {
  // Free-text input with a datalist of existing names so typing matches existing entities
  // (idempotent on the backend) while still allowing the user to type a brand-new name.
  const id = `dl-fb-${label.toLowerCase()}`;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-amber-700/80">
        {label}
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        list={id}
        className="rounded border border-amber-200 bg-white px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
      />
      <datalist id={id}>
        {suggestions.map(s => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  );
}

function SuccessCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number;
  icon: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        highlight ? 'border-primary bg-primary-light/40' : 'border-border bg-surface',
      )}
    >
      <div className="flex items-center gap-1 text-text-3">
        <i className={cn('ti', icon, 'text-[14px]')} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p
        className={cn(
          'mt-0.5 text-[20px] font-semibold tabular-nums',
          highlight ? 'text-primary-text' : 'text-text',
        )}
      >
        {value}
      </p>
    </div>
  );
}
