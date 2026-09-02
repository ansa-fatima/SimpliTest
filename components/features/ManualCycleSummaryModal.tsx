'use client';

import { useEffect, useState } from 'react';
import { TestCycle } from '@/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// ─── Manual cycle summary modal ─────────────────────────────
// Visually mirrors CycleReportModal exactly — same header, count cards, pass-rate /
// completion box, "Failed/Blocked" breakdown sections — so the two summary views feel
// identical regardless of whether the cycle is CaseBased or Manual.
//
// Shared between CyclesList (Test Runs page) and any other entry point that can
// land on a quick log (e.g. Dashboard's Recent activity, the Stability report's
// drilldown) — a quick log has no per-case TestRun rows, so it must never be
// opened in CycleView, which renders an empty "Test runs" grid for it.

export function ManualCycleSummaryModal({
  cycle,
  onClose,
  onEdit,
}: {
  cycle: TestCycle;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Derived numbers (use 0 when fields are null/undefined).
  const critical = cycle.criticalCount ?? 0;
  const major = cycle.majorCount ?? 0;
  const minor = cycle.minorCount ?? 0;
  const done = cycle.doneCount ?? 0;
  const remaining = cycle.remainingCount ?? 0;
  const issues = cycle.issueCount ?? critical + major + minor;
  const passed = cycle.passedCount ?? 0;
  const failed = cycle.failedCount ?? 0;
  const blocked = cycle.blockedCount ?? 0;
  const totalCases = passed + failed + blocked;

  // Passed only means it: no issues were found at all (not just "found and
  // since fixed" — issues > 0 counts as Failed even once fully resolved).
  const isFailed = issues > 0 || failed > 0 || blocked > 0;
  const statusPill = isFailed
    ? { circle: '🔴', label: 'Failed', cls: 'bg-red-50 text-red-700 border border-red-200' }
    : { circle: '🟢', label: 'Passed', cls: 'bg-green-50 text-green-700 border border-green-200' };

  // Pass rate / Completion %
  const passPercent = totalCases === 0 ? 0 : Math.round((passed / totalCases) * 100);
  const percent = done + remaining === 0 ? 0 : Math.round((done / (done + remaining)) * 100);

  const copy = async () => {
    const txt = formatManualCycleSummary(cycle);
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this summary:', txt);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Scope-style meta line (Module / Feature, plus env/platform/version).
  const metaParts: string[] = [];
  if (cycle.moduleName) metaParts.push(cycle.moduleName);
  if (cycle.featureName) metaParts.push(cycle.featureName);
  if (cycle.environment) metaParts.push(cycle.environment);
  if (cycle.platform) metaParts.push(cycle.platform);
  if (cycle.version) metaParts.push(cycle.version);
  if (cycle.cycleCategory) metaParts.push(cycle.cycleCategory);
  const scopeLine = metaParts.join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 pb-4 pt-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Quick Log Summary</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">Snapshot for sharing in QA channels</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" onClick={copy}>
              {copied ? '✓ Copied' : '📋 Copy text'}
            </Button>
            <Button variant="default" onClick={onEdit}>
              ✏️ Edit
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded p-1 text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          {/* Cycle header */}
          <div>
            <h3 className="text-lg font-bold text-slate-900">{cycle.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider',
                  statusPill.cls,
                )}
              >
                <span className="text-sm">{statusPill.circle}</span> {statusPill.label}
              </span>
              {scopeLine && (
                <>
                  <span>·</span>
                  <span>
                    <strong className="text-slate-700">Scope:</strong> {scopeLine}
                  </span>
                </>
              )}
              <span>·</span>
              <span>{new Date(cycle.createdAt).toLocaleDateString()}</span>
              {cycle.ticketLink && (
                <>
                  <span>·</span>
                  <span className="font-mono text-slate-600">{cycle.ticketLink}</span>
                </>
              )}
            </div>
          </div>

          {/* Counts grid — matches CycleReportModal's 5-card layout */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <CountCard label="Total issues" value={issues} tone="neutral" />
            <CountCard label="Critical" value={critical} tone="negative" />
            <CountCard label="Major" value={major} tone="warning" />
            <CountCard label="Minor" value={minor} tone="neutral" />
            <CountCard label="Remaining" value={remaining} tone="negative" />
          </div>

          {/* Pass rate / Completion — same box as detailed report. Issue
              resolution only shows once Done/Remaining have actually been
              filled in (e.g. after editing this cycle following a retest) —
              otherwise there's nothing to report progress on yet. */}
          <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Pass rate
              </p>
              <p className="text-2xl font-bold text-green-600">{passPercent}%</p>
              <p className="text-[10px] text-slate-400">
                {totalCases === 0 ? 'No test cases recorded' : `${passed} of ${totalCases} passed`}
              </p>
            </div>
            {(done > 0 || remaining > 0) && (
              <>
                <div className="h-10 w-px bg-slate-200" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Issue resolution
                  </p>
                  <p className="text-2xl font-bold text-blue-600">{percent}%</p>
                  <p className="text-[10px] text-slate-400">
                    {done} done · {remaining} remaining
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Breakdown — Failed (open) — only when there's something to show */}
          {(critical > 0 || major > 0 || minor > 0 || remaining > 0) && (
            <ManualBreakdownSection
              title="Issues"
              tone="red"
              critical={critical}
              major={major}
              minor={minor}
              done={done}
              remaining={remaining}
            />
          )}

          {/* Test-case results breakdown (Passed / Failed / Blocked) — only when set */}
          {totalCases > 0 && (
            <ManualBreakdownSection
              title="Test case results"
              tone="amber"
              passed={passed}
              failed={failed}
              blocked={blocked}
            />
          )}

          {/* "All clear" message when nothing to report */}
          {issues === 0 && totalCases === 0 && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-600">
              ✓ No issues or test-case results recorded — looking clean!
            </p>
          )}

          {/* Notes */}
          {cycle.description && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Notes
              </p>
              <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {cycle.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Matches CycleReportModal's CountCard exactly (same tones + classes).
function CountCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const cls =
    tone === 'positive'
      ? 'text-green-700 bg-green-50 border-green-200'
      : tone === 'negative'
        ? 'text-red-700 bg-red-50 border-red-200'
        : tone === 'warning'
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-slate-700 bg-slate-50 border-slate-200';
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

// Severity / category breakdown — visually mirrors CycleReportModal.BreakdownSection
// (left coloured border + 2-col grid of labelled lists), but the contents are the
// manual cycle's counts instead of per-case rows.
function ManualBreakdownSection(props: {
  title: string;
  tone: 'red' | 'amber';
  critical?: number;
  major?: number;
  minor?: number;
  done?: number;
  remaining?: number;
  passed?: number;
  failed?: number;
  blocked?: number;
}) {
  const sectionCls = props.tone === 'red' ? 'border-red-200' : 'border-amber-200';
  const headerCls = props.tone === 'red' ? 'text-red-700' : 'text-amber-700';

  const isIssues = typeof props.critical === 'number';

  return (
    <div className={`border-l-4 ${sectionCls} pl-4`}>
      <h4 className={`text-sm font-bold ${headerCls} mb-2`}>{props.title}</h4>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        {isIssues ? (
          <>
            <BreakdownList
              label="Severity"
              rows={[
                ['Critical', props.critical ?? 0, 'text-red-700'],
                ['Major', props.major ?? 0, 'text-amber-700'],
                ['Minor', props.minor ?? 0, 'text-slate-600'],
              ]}
            />
            <BreakdownList
              label="Resolution"
              rows={[
                ['Done', props.done ?? 0, 'text-green-700'],
                ['Remaining', props.remaining ?? 0, 'text-red-700'],
              ]}
            />
          </>
        ) : (
          <>
            <BreakdownList
              label="Outcome"
              rows={[
                ['Passed', props.passed ?? 0, 'text-green-700'],
                ['Failed', props.failed ?? 0, 'text-red-700'],
                ['Blocked', props.blocked ?? 0, 'text-amber-700'],
              ]}
            />
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="mb-1.5 text-xs font-bold text-slate-700">Totals:</p>
              <ul className="flex flex-col gap-0.5">
                <li className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-600">Total cases:</span>
                  <span className="font-mono font-bold text-slate-700">
                    {(props.passed ?? 0) + (props.failed ?? 0) + (props.blocked ?? 0)}
                  </span>
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BreakdownList({ label, rows }: { label: string; rows: [string, number, string][] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="mb-1.5 text-xs font-bold text-slate-700">{label}:</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map(([k, v, c]) => (
          <li key={k} className="flex items-center justify-between text-xs">
            <span className={`font-semibold ${c}`}>{k}:</span>
            <span className={`font-mono font-bold ${c}`}>{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Slack-friendly plain text. Compact single-headline format like:
//   Parent Portal/Login - iPhone - Regression V 3.7.1 (68) (completed)
//
//   Environment: QA
//   Status: :red_circle: Failed
//   Total Issues Reported: 20
//   Severity:
//   Critical: 05
//   Major: 13
//   Minor: 02
//
// Empty meta fields are skipped from the headline so it stays clean for sparse cycles.
export function formatManualCycleSummary(c: TestCycle): string {
  const pad = (n: number | undefined | null) => String(n ?? 0).padStart(2, '0');

  const critical = c.criticalCount ?? 0;
  const major = c.majorCount ?? 0;
  const minor = c.minorCount ?? 0;
  const issues = c.issueCount ?? critical + major + minor;
  const remaining = c.remainingCount ?? 0;
  const failed = c.failedCount ?? 0;
  const blocked = c.blockedCount ?? 0;

  // ── Headline: "{Module}/{Feature} - {Platform} - {Cycle} V {Version} ({status})" ──
  const modFeat =
    c.moduleName && c.featureName
      ? `${c.moduleName}/${c.featureName}`
      : c.moduleName || c.featureName || c.name;

  // "Regression V 3.7.1" — strip any leading "v"/"V " the user typed so we don't double up.
  const versionClean = (c.version ?? '').replace(/^[vV]\s*/, '').trim();
  const categoryAndVersion = [c.cycleCategory ?? '', versionClean ? `V ${versionClean}` : '']
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ');

  const headlineParts = [modFeat, c.platform ?? '', categoryAndVersion]
    .map(s => s.trim())
    .filter(Boolean);
  const statusSuffix = (c.status ?? 'Active').toLowerCase();
  const headline = `${headlineParts.join(' - ')} (${statusSuffix})`;

  // ── Body status (independent of lifecycle status) ──
  const isFailed = issues > 0 || remaining > 0 || failed > 0 || blocked > 0;
  const slack = isFailed ? ':red_circle:' : ':large_green_circle:';
  const label = isFailed ? 'Failed' : 'Passed';

  const env = (c.environment ?? '').trim().toUpperCase() || '-';

  const lines: string[] = [];
  lines.push(headline);
  lines.push('');
  lines.push(`Environment: ${env}`);
  lines.push(`Status: ${slack} ${label}`);
  lines.push(`Total Issues Reported: ${pad(issues)}`);
  lines.push(`Severity:`);
  lines.push(`Critical: ${pad(critical)}`);
  lines.push(`Major: ${pad(major)}`);
  lines.push(`Minor: ${pad(minor)}`);

  return lines.join('\n');
}
