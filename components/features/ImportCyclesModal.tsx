'use client';

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { mapSheetRow, validateRow, CycleImportRow } from '@/lib/cycleOutcome';
import { downloadCycleSampleTemplate } from '@/lib/export';

interface ImportCyclesModalProps {
  projectId: string;
  onClose: () => void;
  /** Called after a successful import so the parent can refetch the cycles list. */
  onImported: () => void;
}

interface ParsedRow {
  raw: Record<string, unknown>;
  mapped: CycleImportRow;
  errors: string[];
}

interface ImportResult {
  created: number;
  totalRows: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

// Upload an .xlsx/.csv of testing cycles, preview what will import, then bulk-
// create them. The column schema + a sample template live in lib/cycleOutcome
// / lib/export so a file exported from the app re-imports cleanly.
export function ImportCyclesModal({ projectId, onClose, onImported }: ImportCyclesModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const validRows = rows.filter(r => r.errors.length === 0);
  const invalidRows = rows.filter(r => r.errors.length > 0);

  const onFile = async (file: File) => {
    setParseError('');
    setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        setParseError('That file has no sheets.');
        setRows([]);
        return;
      }
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: false,
      });
      const parsed: ParsedRow[] = raw.map(r => {
        const mapped = mapSheetRow(r);
        return { raw: r, mapped, errors: validateRow(mapped).errors };
      });
      setRows(parsed);
      if (parsed.length === 0) setParseError('No rows found in the first sheet.');
    } catch (e) {
      setParseError((e as Error).message || 'Could not read that file.');
      setRows([]);
    }
  };

  const doImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      const res = await api.post<ImportResult>('/api/cycles/import', {
        projectId,
        rows: validRows.map(r => r.raw),
      });
      setResult(res);
      onImported();
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-text">Import testing cycles</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {!result && (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-3">
                <p className="text-[12.5px] text-text-2">
                  Need the format? Download the sample with every column explained.
                </p>
                <button
                  type="button"
                  onClick={downloadCycleSampleTemplate}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text transition-colors hover:bg-surface-2"
                >
                  <i className="ti ti-download text-[13px]" />
                  Sample .xlsx
                </button>
              </div>

              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-surface px-4 py-7 text-text-3 transition-colors hover:border-primary hover:text-primary-text"
                >
                  <i className="ti ti-file-spreadsheet text-[26px] opacity-70" />
                  <span className="text-[13px] font-medium">
                    {fileName || 'Choose an .xlsx or .csv file'}
                  </span>
                  <span className="text-[11.5px]">Columns are matched by header name.</span>
                </button>
              </div>

              {parseError && (
                <p className="rounded-lg bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger">
                  {parseError}
                </p>
              )}

              {rows.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-4 text-[12.5px]">
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <i className="ti ti-circle-check text-[14px]" />
                      {validRows.length} ready
                    </span>
                    {invalidRows.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-danger">
                        <i className="ti ti-alert-circle text-[14px]" />
                        {invalidRows.length} will be skipped
                      </span>
                    )}
                  </div>

                  <div className="max-h-[260px] overflow-auto rounded-lg border border-border">
                    <table className="w-full border-collapse text-[11.5px]">
                      <thead className="sticky top-0 bg-surface-2 text-text-2">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Module → Feature</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Type</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Issues</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Outcome</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 50).map((r, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1.5 text-text-2">{r.mapped.date || '—'}</td>
                            <td className="px-2 py-1.5 text-text">
                              {[r.mapped.module, r.mapped.feature].filter(Boolean).join(' → ') ||
                                '—'}
                            </td>
                            <td className="px-2 py-1.5 text-text-2">{r.mapped.cycleType || '—'}</td>
                            <td className="px-2 py-1.5 text-text-2">
                              {r.mapped.critical + r.mapped.major + r.mapped.minor}
                            </td>
                            <td className="px-2 py-1.5 text-text-2">
                              {r.mapped.outcome || 'auto'}
                            </td>
                            <td className="px-2 py-1.5">
                              {r.errors.length === 0 ? (
                                <span className="text-success">ready</span>
                              ) : (
                                <span className="text-danger" title={r.errors.join('; ')}>
                                  {r.errors.join('; ')}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 50 && (
                      <p className="px-2 py-1.5 text-[11px] text-text-3">
                        …and {rows.length - 50} more rows.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-success-bg px-4 py-3 text-[13px] text-success-text">
                <i className="ti ti-circle-check mr-1.5" />
                Imported {result.created} of {result.totalRows} rows.
                {result.skipped > 0 && ` ${result.skipped} skipped.`}
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-[220px] overflow-auto rounded-lg border border-border px-3 py-2 text-[12px] text-text-2">
                  {result.errors.map((e, i) => (
                    <p key={i}>
                      Row {e.row}: <span className="text-danger">{e.reason}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[7px] border border-border bg-surface px-3.5 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2"
          >
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={doImport}
              disabled={importing || validRows.length === 0}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {importing && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
              <i className="ti ti-upload text-[14px]" />
              Import {validRows.length > 0 ? validRows.length : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
