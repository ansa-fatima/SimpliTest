'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/client';

interface CycleCase {
  id: string;
  caseNum: number;
  title: string;
  priority: 'High' | 'Medium' | 'Low';
  severity: 'Critical' | 'Major' | 'Minor';
  type: string;
  module: string;
  feature: string;
  notes: string;
  executedAt: string | null;
}

interface ReportBreakdown {
  byPriority: Record<'High' | 'Medium' | 'Low', number>;
  bySeverity: Record<'Critical' | 'Major' | 'Minor', number>;
  cases: CycleCase[];
}

interface CycleReport {
  cycle: {
    id: string;
    name: string;
    description: string;
    status: 'Active' | 'Completed' | 'Archived';
    scopeType: 'All' | 'Module' | 'Feature' | 'Custom';
    scopeName: string | null;
    createdAt: string;
    targetDate: string | null;
  };
  total: number;
  done: number;
  percent: number;
  passPercent: number;
  counts: { NotRun: number; Passed: number; Failed: number; Blocked: number; Skipped: number };
  failed: ReportBreakdown;
  blocked: ReportBreakdown;
  skipped: ReportBreakdown;
}

interface CycleReportModalProps {
  cycleId: string;
  onClose: () => void;
}

export function CycleReportModal({ cycleId, onClose }: CycleReportModalProps) {
  const [report, setReport] = useState<CycleReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<CycleReport>(`/api/cycles/${cycleId}/report`);
        setReport(r);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [cycleId]);

  const copyAsText = async () => {
    if (!report) return;
    const txt = formatPlainText(report);
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback: show in a prompt for manual copy
      window.prompt('Copy this summary:', txt);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-[720px] max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-bold text-slate-900">Test Run Summary</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Snapshot for sharing in QA channels</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" onClick={copyAsText} disabled={!report}>
              {copied ? '✓ Copied' : '📋 Copy text'}
            </Button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded p-1 cursor-pointer transition-colors text-lg">✕</button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading summary…</div>
        )}
        {error && (
          <div className="flex items-center justify-center py-16 text-sm text-red-500">{error}</div>
        )}

        {report && (
          <div className="px-6 py-5 flex flex-col gap-5">
            {/* Cycle header */}
            <div>
              <h3 className="text-lg font-bold text-slate-900">{report.cycle.name}</h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 flex-wrap">
                <StatusPill report={report} />
                <span>·</span>
                <span><strong className="text-slate-700">Scope:</strong> {report.cycle.scopeType}{report.cycle.scopeName ? ` — ${report.cycle.scopeName}` : ''}</span>
                <span>·</span>
                <span>{new Date(report.cycle.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Counts grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <CountCard label="Total" value={report.total} tone="neutral" />
              <CountCard label="Passed" value={report.counts.Passed} tone="positive" />
              <CountCard label="Failed" value={report.counts.Failed} tone="negative" />
              <CountCard label="Blocked" value={report.counts.Blocked} tone="warning" />
              <CountCard label="Skipped/Not Run" value={report.counts.Skipped + report.counts.NotRun} tone="neutral" />
            </div>

            {/* Pass rate / progress */}
            <div className="flex items-center gap-4 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Pass rate</p>
                <p className="text-2xl font-bold text-green-600">{report.passPercent}%</p>
              </div>
              <div className="h-10 w-px bg-slate-200" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Completion</p>
                <p className="text-2xl font-bold text-blue-600">{report.percent}%</p>
                <p className="text-[10px] text-slate-400">{report.done} of {report.total} executed</p>
              </div>
            </div>

            {/* Failed breakdown */}
            {report.counts.Failed > 0 && (
              <BreakdownSection title="Failed" tone="red" data={report.failed} />
            )}

            {/* Blocked breakdown */}
            {report.counts.Blocked > 0 && (
              <BreakdownSection title="Blocked" tone="amber" data={report.blocked} />
            )}

            {report.counts.Failed === 0 && report.counts.Blocked === 0 && (
              <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                ✓ No failed or blocked cases — looking good!
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ report }: { report: CycleReport }) {
  const { circle, label } = statusFor(report);
  const cls = label === 'Failed'
    ? 'bg-red-50 text-red-700 border border-red-200'
    : 'bg-green-50 text-green-700 border border-green-200';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-px rounded ${cls}`}>
      <span className="text-sm">{circle}</span> {label}
    </span>
  );
}

function CountCard({ label, value, tone }: { label: string; value: number; tone: 'positive' | 'negative' | 'warning' | 'neutral' }) {
  const cls =
    tone === 'positive' ? 'text-green-700 bg-green-50 border-green-200' :
    tone === 'negative' ? 'text-red-700 bg-red-50 border-red-200' :
    tone === 'warning'  ? 'text-amber-700 bg-amber-50 border-amber-200' :
                          'text-slate-700 bg-slate-50 border-slate-200';
  return (
    <div className={`border rounded-lg px-3 py-2.5 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70 font-semibold">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function BreakdownSection({ title, tone, data }: { title: string; tone: 'red' | 'amber'; data: ReportBreakdown }) {
  const sectionCls = tone === 'red' ? 'border-red-200' : 'border-amber-200';
  const headerCls = tone === 'red' ? 'text-red-700' : 'text-amber-700';

  return (
    <div className={`border-l-4 ${sectionCls} pl-4`}>
      <h4 className={`text-sm font-bold ${headerCls} mb-2`}>{title} ({data.cases.length})</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
        <BreakdownList label="Priority" rows={[
          ['High', data.byPriority.High, 'text-red-700'],
          ['Medium', data.byPriority.Medium, 'text-amber-700'],
          ['Low', data.byPriority.Low, 'text-green-700'],
        ]} />
        <BreakdownList label="Severity" rows={[
          ['Critical', data.bySeverity.Critical, 'text-red-700'],
          ['Major', data.bySeverity.Major, 'text-amber-700'],
          ['Minor', data.bySeverity.Minor, 'text-green-700'],
        ]} />
      </div>

      <div className="flex flex-col divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
        {data.cases.map(c => (
          <div key={c.id} className="px-3 py-2 hover:bg-slate-50">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-slate-400 font-semibold whitespace-nowrap">
                TC-{String(c.caseNum).padStart(4, '0')}
              </span>
              <span className="text-sm font-semibold text-slate-800 flex-1 truncate" title={c.title}>{c.title}</span>
              <span className={`text-[10px] uppercase font-semibold px-1.5 py-px rounded whitespace-nowrap ${
                c.priority === 'High' ? 'bg-red-100 text-red-700' :
                c.priority === 'Medium' ? 'bg-amber-100 text-amber-700' :
                                          'bg-green-100 text-green-700'
              }`}>{c.priority}</span>
              <span className={`text-[10px] uppercase font-semibold px-1.5 py-px rounded whitespace-nowrap ${
                c.severity === 'Critical' ? 'bg-red-100 text-red-700' :
                c.severity === 'Major' ? 'bg-amber-100 text-amber-700' :
                                          'bg-green-100 text-green-700'
              }`}>{c.severity}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {c.module} / {c.feature}
              {c.notes && <> · <span className="text-slate-600">{c.notes}</span></>}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BreakdownList({ label, rows }: { label: string; rows: [string, number, string][] }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
      <p className="text-xs font-bold text-slate-700 mb-1.5">{label}:</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map(([k, v, cls]) => (
          <li key={k} className="flex items-center justify-between text-xs">
            <span className={`font-semibold ${cls}`}>{k}:</span>
            <span className={`font-mono font-bold ${cls}`}>{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Status is "Failed" if anything failed or is blocked, "Passed" otherwise.
function statusFor(r: CycleReport): { circle: string; label: string; slack: string } {
  if (r.counts.Failed > 0 || r.counts.Blocked > 0)
    return { circle: '🔴', label: 'Failed', slack: ':red_circle:' };
  return { circle: '🟢', label: 'Passed', slack: ':large_green_circle:' };
}

function combineSeverity(r: CycleReport) {
  return {
    Critical: r.failed.bySeverity.Critical + r.blocked.bySeverity.Critical,
    Major:    r.failed.bySeverity.Major    + r.blocked.bySeverity.Major,
    Minor:    r.failed.bySeverity.Minor    + r.blocked.bySeverity.Minor,
  };
}

function combinePriority(r: CycleReport) {
  return {
    High:   r.failed.byPriority.High   + r.blocked.byPriority.High,
    Medium: r.failed.byPriority.Medium + r.blocked.byPriority.Medium,
    Low:    r.failed.byPriority.Low    + r.blocked.byPriority.Low,
  };
}


function formatPlainText(r: CycleReport): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const { slack, label } = statusFor(r);
  const sev = combineSeverity(r);
  const pri = combinePriority(r);
  return [
    `Status: ${slack} ${label}`,
    `Total Test Cases: ${pad(r.total)}`,
    `Failed: ${pad(r.counts.Failed)}`,
    `Blocked: ${pad(r.counts.Blocked)}`,
    ``,
    `Severity:`,
    `Critical: ${pad(sev.Critical)}`,
    `Major: ${pad(sev.Major)}`,
    `Minor: ${pad(sev.Minor)}`,
    ``,
    `Priority:`,
    `High: ${pad(pri.High)}`,
    `Medium: ${pad(pri.Medium)}`,
    `Low: ${pad(pri.Low)}`,
  ].join('\n');
}
