'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PlanBurndown, PlanDefect, PlanDetail, TestCycle, TestPlan } from '@/types';
import { cn } from '@/lib/utils';
import {
  ago,
  dueDate,
  milestoneLabel,
  planPillOf,
  planStateOf,
  rollUpPlan,
  shortDate,
} from '@/lib/plans';
import { exportPlan } from '@/lib/export';
import { SIco } from '@/components/layout/sts-icons';
import { PlanRunRow } from './PlanGroupCard';
import { HowPlansWork } from './NewPlanPage';
import { runStatus } from './run-helpers';
import { caseCode } from './tc-helpers';
import './sts-v3.css';

interface TestPlanViewProps {
  planId: string;
  /** The workspace's plans -- the header reads the plan from here. */
  plans: TestPlan[];
  /** All runs in the workspace; the plan's own are the ones with this planId. */
  cycles: TestCycle[];
  /** Burn-down and latest failures (server-computed); null while loading. */
  detail: PlanDetail | null;
  loading: boolean;
  projectName: string;
  onBack: () => void;
  onShowPlans: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenRun: (cycleId: string) => void;
  onOpenOverview: (cycleId: string) => void;
  /** Opens New test run, with this plan preselected. */
  onNewRun: () => void;
  onAddRuns: (cycleIds: string[]) => Promise<void>;
  onRemoveRun: (cycleId: string) => Promise<void>;
}

const sevClass = (s: string) => {
  const k = s.toLowerCase();
  return k === 'critical' || k === 'blocker'
    ? 'sev-critical'
    : k === 'major' || k === 'high'
      ? 'sev-major'
      : k === 'minor' || k === 'low'
        ? 'sev-minor'
        : 'sev-trivial';
};

// Screen 08 — a single test plan: roll-up stats, the runs it groups, a burn-down and
// the latest failures. Everything is derived from the linked runs.
export function TestPlanView({
  planId,
  plans,
  cycles,
  detail,
  loading,
  projectName,
  onBack,
  onShowPlans,
  onEdit,
  onDelete,
  onOpenRun,
  onOpenOverview,
  onNewRun,
  onAddRuns,
  onRemoveRun,
}: TestPlanViewProps) {
  const [adding, setAdding] = useState(false);
  const [allDefects, setAllDefects] = useState(false);

  const plan = detail?.plan ?? plans.find(p => p.id === planId) ?? null;
  const runs = useMemo(() => cycles.filter(c => c.planId === planId), [cycles, planId]);
  const roll = useMemo(() => rollUpPlan(runs), [runs]);

  if (!plan) {
    return (
      <div className="stv3 main-scroll">
        <div className="card">
          <div className="empty-note">
            {loading ? (
              'Loading…'
            ) : (
              <>
                This test plan no longer exists.{' '}
                <button type="button" className="btn-link" onClick={onBack}>
                  Back to Test runs
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const state = planStateOf(plan, roll);
  const pill = planPillOf(state);
  const milestone = milestoneLabel(plan.milestone);
  const c = roll.counts;
  const pctOf = (n: number) => (roll.total === 0 ? '0.0' : ((n / roll.total) * 100).toFixed(1));
  const started = shortDate(plan.startDate ?? plan.createdAt);
  const due = dueDate(plan.dueDate);
  const defects = detail?.defects ?? [];
  const defectTotal = detail?.defectCount ?? roll.issuesFound;

  return (
    <div className="stv3 main-scroll plan-detail">
      <div className="breadcrumb">
        <span className="crumb">{projectName || 'Project'}</span>
        <span className="sep">/</span>
        <button type="button" className="crumb" onClick={onBack}>
          Test runs
        </button>
        <span className="sep">/</span>
        <button type="button" className="crumb" onClick={onShowPlans}>
          Plans
        </button>
        <span className="sep">/</span>
        <span className="current">{plan.name}</span>
      </div>

      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div className="plan-detail-head">
            <span className={cn('pill', pill.pill)}>
              {pill.dot && <span className="dot" />} {state}
            </span>
            <span className="pill pill-neutral">Plan</span>
            {milestone && <span className="pill pill-neutral">{milestone}</span>}
            <span className="plan-detail-dates">
              {state === 'Planned' ? 'Starts' : 'Started'} {started}
              {due ? ` · Due ${due}` : ''}
            </span>
          </div>
          <h1 className="page-title compact">{plan.name}</h1>
          <div className="page-sub">
            {plan.createdByName ? (
              <>
                Created by{' '}
                <b style={{ color: 'var(--t-2)' }}>{plan.createdByName.split(/\s+/)[0]}</b> ·{' '}
              </>
            ) : null}
            {roll.runs} {roll.runs === 1 ? 'run' : 'runs'} · {roll.total.toLocaleString()} cases
            {roll.testers > 0 && (
              <>
                {' '}
                · {roll.testers} {roll.testers === 1 ? 'tester' : 'testers'}
              </>
            )}
          </div>
          {plan.description && (
            <p
              style={{
                fontSize: 12.5,
                color: 'var(--t-3)',
                margin: '6px 0 0',
                maxWidth: 720,
                whiteSpace: 'pre-wrap',
              }}
            >
              {plan.description}
            </p>
          )}
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => exportPlan(plan, runs)}
          >
            <SIco name="upload" />
            Export
          </button>
          <button type="button" className="btn btn-secondary" onClick={onEdit}>
            <SIco name="edit" />
            Edit
          </button>
          <button type="button" className="btn btn-secondary btn-danger-text" onClick={onDelete}>
            <SIco name="trash" />
            Delete
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <SIco name="plus" />
            Add run
          </button>
        </div>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat accent">
          <div className="stat-label">Total cases</div>
          <div className="stat-value">{roll.total.toLocaleString()}</div>
          <div className="stat-meta">
            across {roll.runs} {roll.runs === 1 ? 'run' : 'runs'}
          </div>
        </div>
        <div className="stat ok">
          <div className="stat-label">Passed</div>
          <div className="stat-value">{c.Passed.toLocaleString()}</div>
          <div className="stat-meta">{pctOf(c.Passed)}%</div>
        </div>
        <div className="stat err">
          <div className="stat-label">Failed</div>
          <div className="stat-value">{c.Failed.toLocaleString()}</div>
          <div className="stat-meta">
            {/* One flex child: the meta row is a flex box, which would split "·" onto its own line. */}
            <span>
              {pctOf(c.Failed)}%
              {defectTotal > 0 && (
                <>
                  {' · '}
                  <a
                    href="#plan-defects"
                    style={{ color: 'var(--err)', fontWeight: 500 }}
                    onClick={e => {
                      e.preventDefault();
                      setAllDefects(true);
                      document
                        .getElementById('plan-defects')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                  >
                    {defectTotal} {defectTotal === 1 ? 'defect' : 'defects'} logged
                  </a>
                </>
              )}
            </span>
          </div>
        </div>
        <div className="stat warn">
          <div className="stat-label">Blocked</div>
          <div className="stat-value">{c.Blocked.toLocaleString()}</div>
          <div className="stat-meta">env / dependency</div>
        </div>
        <div className="stat info">
          <div className="stat-label">Pending</div>
          <div className="stat-value">{c.NotRun.toLocaleString()}</div>
          <div className="stat-meta">{pctOf(c.NotRun)}% remaining</div>
        </div>
      </div>

      <div className="split-rail split-rail-320">
        <div style={{ minWidth: 0 }}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>
                <SIco name="play" /> Linked test runs
              </h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setAdding(true)}
              >
                <SIco name="plus" />
                Add run to plan
              </button>
            </div>
            {runs.length === 0 ? (
              <div className="empty-note" style={{ padding: '26px 18px' }}>
                {loading ? (
                  'Loading…'
                ) : (
                  <>
                    No runs in this plan yet.{' '}
                    <button type="button" className="btn-link" onClick={() => setAdding(true)}>
                      Add a run
                    </button>
                  </>
                )}
              </div>
            ) : (
              <table className="t runs-table plan-runs-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Progress</th>
                    <th>Pass rate</th>
                    <th>Last run</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <PlanRunRow
                      key={r.id}
                      cycle={r}
                      openLabel="Open"
                      lastRun
                      onExecute={() => onOpenRun(r.id)}
                      onDetails={() => onOpenOverview(r.id)}
                      trailing={
                        <button
                          type="button"
                          className="icon-btn"
                          title="Remove from plan"
                          aria-label={`Remove ${r.name} from this plan`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove “${r.name}” from this plan? The run and its results are kept.`,
                              )
                            )
                              void onRemoveRun(r.id);
                          }}
                        >
                          <SIco name="x" size={14} />
                        </button>
                      }
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <BurndownCard plan={plan} detail={detail} loading={loading} />
        </div>

        <div className="rail">
          <HowPlansWork milestone={plan.milestone} />
          <div className="card" id="plan-defects">
            <div className="card-head">
              <h3>Recent defects from this plan</h3>
              <span className="meta">{defectTotal} logged</span>
            </div>
            <div style={{ padding: 6 }}>
              {defects.length === 0 ? (
                <div className="empty-note" style={{ padding: '18px 12px' }}>
                  {loading ? 'Loading…' : 'No failed or blocked cases in this plan.'}
                </div>
              ) : (
                (allDefects ? defects : defects.slice(0, 3)).map(d => (
                  <DefectItem key={d.id} d={d} />
                ))
              )}
            </div>
            {defects.length > 3 && (
              <div className="card-foot">
                <button
                  type="button"
                  className="btn-link"
                  style={{ fontSize: 12 }}
                  onClick={() => setAllDefects(v => !v)}
                >
                  {allDefects ? 'Show fewer' : `All ${defectTotal} defects →`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {adding && (
        <AddRunsDialog
          plan={plan}
          cycles={cycles}
          plans={plans}
          onNewRun={onNewRun}
          onClose={() => setAdding(false)}
          onAdd={async ids => {
            await onAddRuns(ids);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function DefectItem({ d }: { d: PlanDefect }) {
  return (
    <div className="plan-defect">
      <div className="plan-defect-top">
        <span className="plan-defect-key">{caseCode(d.caseNum)}</span>
        <span>
          <span className={cn('sev-dot', sevClass(d.severity))} />
          <span className="plan-defect-sev">
            {d.severity} · {d.result}
          </span>
        </span>
      </div>
      <div className="plan-defect-title">{d.title}</div>
      <div className="plan-defect-from">
        From <span>{d.runName}</span> · {ago(d.at)}
      </div>
    </div>
  );
}

// ─── Add runs ───────────────────────────────────────────────

function AddRunsDialog({
  plan,
  cycles,
  plans,
  onNewRun,
  onClose,
  onAdd,
}: {
  plan: TestPlan;
  cycles: TestCycle[];
  plans: TestPlan[];
  onNewRun: () => void;
  onClose: () => void;
  onAdd: (ids: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Standalone runs first; ones already in another plan come last (adding moves them).
  const candidates = cycles
    .filter(
      c =>
        (c.mode ?? 'CaseBased') === 'CaseBased' && c.status !== 'Archived' && c.planId !== plan.id,
    )
    .sort((a, b) => Number(!!a.planId) - Number(!!b.planId));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        role="dialog"
        aria-label="Add runs to plan"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="card-head">
          <h3>Add runs to “{plan.name}”</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <SIco name="x" size={14} />
          </button>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {candidates.length === 0 ? (
            <div className="empty-note" style={{ padding: '26px 18px' }}>
              Every test run is already in this plan. Create a new run to add more.
            </div>
          ) : (
            candidates.map(c => {
              const on = picked.has(c.id);
              const st = runStatus(c);
              const other = c.planId ? plans.find(p => p.id === c.planId)?.name : null;
              return (
                <div
                  key={c.id}
                  className="plan-run-pick"
                  role="checkbox"
                  aria-checked={on}
                  tabIndex={0}
                  onClick={() => toggle(c.id)}
                  onKeyDown={e => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      toggle(c.id);
                    }
                  }}
                >
                  <span className={cn('cb', on && 'on')}>
                    <svg viewBox="0 0 12 12">
                      <path d="M2 6L5 9L10 3" />
                    </svg>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', color: 'var(--t-1)', fontWeight: 500 }}>
                      {c.name}
                    </span>
                    <span className="id-mono" style={{ display: 'block', whiteSpace: 'normal' }}>
                      {(c.summary?.total ?? 0).toLocaleString()} cases
                      {other ? ` · now in “${other}”` : ''}
                    </span>
                  </span>
                  <span className={cn('pill', st.pill)} style={{ flexShrink: 0 }}>
                    {st.dot && <span className="dot" />} {st.label}
                  </span>
                </div>
              );
            })
          )}
        </div>
        <div
          className="card-foot"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}
        >
          <button
            type="button"
            className="btn-link"
            style={{ marginRight: 'auto', fontSize: 12 }}
            onClick={onNewRun}
          >
            + Create a new run for this plan
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={picked.size === 0 || busy}
            onClick={async () => {
              setBusy(true);
              await onAdd(Array.from(picked));
              setBusy(false);
            }}
          >
            {busy
              ? 'Adding…'
              : picked.size === 0
                ? 'Add to plan'
                : `Add ${picked.size} ${picked.size === 1 ? 'run' : 'runs'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Burn-down ──────────────────────────────────────────────

const DAY = 86_400_000;
const parseDay = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dayLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// "On track to complete by EOD May 8" -- a straight-line forecast from the pace so far.
function forecast(plan: TestPlan, b: PlanBurndown): string {
  if (b.total === 0) return 'Add runs to see the burn-down';
  const last = b.points[b.points.length - 1];
  if (last.remaining === 0) return 'Every case has been executed';
  const start = parseDay(b.start);
  const today = parseDay(last.date);
  const elapsed = Math.max(1, Math.round((today.getTime() - start.getTime()) / DAY) + 1);
  const executed = b.total - last.remaining;
  if (executed === 0) return 'No cases executed yet';
  const daysLeft = Math.ceil(last.remaining / (executed / elapsed));
  // A pace this slow gives a date months out -- say so instead of printing it.
  if (daysLeft > 120)
    return b.hasDue
      ? 'At risk — too few cases executed to finish by the due date'
      : 'Too few cases executed so far to forecast a finish date';
  const finish = new Date(today.getTime() + daysLeft * DAY);
  if (!b.hasDue) return `At this pace, complete by EOD ${dayLabel(finish)}`;
  const end = parseDay(b.end);
  if (finish.getTime() <= end.getTime()) return `On track to complete by EOD ${dayLabel(finish)}`;
  const late = Math.round((finish.getTime() - end.getTime()) / DAY);
  return `At risk — at this pace it finishes ${dayLabel(finish)}, ${late} ${late === 1 ? 'day' : 'days'} after the due date`;
}

function BurndownCard({
  plan,
  detail,
  loading,
}: {
  plan: TestPlan;
  detail: PlanDetail | null;
  loading: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const b = detail?.burndown ?? null;
  const subtitle = b
    ? `Plan started ${shortDate(b.start ? parseDay(b.start) : plan.createdAt)}${
        b.hasDue ? ` · Due ${shortDate(parseDay(b.end))}` : ''
      } · ${forecast(plan, b)}`
    : loading
      ? 'Loading…'
      : '';

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div>
          <h4>Burn-down · cases remaining</h4>
          <p>{subtitle}</p>
        </div>
        <div className="plan-legend">
          <span>
            <i style={{ background: 'var(--neutral)' }} /> Ideal
          </span>
          <span>
            <i style={{ background: 'var(--brand-700)' }} /> Actual
          </span>
        </div>
      </div>
      <div ref={wrap}>{b && <BurndownSvg b={b} width={width} />}</div>
    </div>
  );
}

function BurndownSvg({ b, width }: { b: PlanBurndown; width: number }) {
  const H = 200;
  const L = 40;
  const R = width - 20;
  const T = 20;
  const B = 180;
  const start = parseDay(b.start).getTime();
  const end = parseDay(b.end).getTime();
  const span = Math.max(DAY, end - start);
  const xOf = (t: number) => L + ((t - start) / span) * (R - L);
  const yOf = (remaining: number) => (b.total === 0 ? B : B - (remaining / b.total) * (B - T));

  const pts = b.points.map(p => ({ x: xOf(parseDay(p.date).getTime()), y: yOf(p.remaining) }));
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const lastPt = pts[pts.length - 1];
  // Up to five evenly spaced date ticks, like the mockup's May 1 / 3 / 5 / 7 / 9.
  const days = Math.round(span / DAY);
  const tickCount = Math.min(5, days + 1);
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    tickCount === 1 ? 0 : Math.round((i * days) / (tickCount - 1)),
  );
  const mono = { fontFamily: 'JetBrains Mono, ui-monospace, monospace' } as const;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${width} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label="Burn-down chart: cases remaining per day against the ideal line"
    >
      <line x1={L} y1={T} x2={L} y2={B} stroke="var(--bdr)" />
      <line x1={L} y1={B} x2={R} y2={B} stroke="var(--bdr)" />
      {b.hasDue && (
        <line
          x1={L}
          y1={T}
          x2={R}
          y2={B}
          stroke="var(--neutral)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      )}
      {pts.length > 1 && (
        <polyline points={line} fill="none" stroke="var(--brand-700)" strokeWidth="2.5" />
      )}
      {pts.length <= 16 &&
        pts
          .slice(0, -1)
          .map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" fill="var(--brand-700)" />)}
      <circle
        cx={lastPt.x}
        cy={lastPt.y}
        r="5"
        fill="var(--brand-700)"
        stroke="var(--c-surface)"
        strokeWidth="2"
      />
      {ticks.map((d, i) => {
        const x = xOf(start + d * DAY);
        return (
          <text
            key={i}
            x={x}
            y="195"
            textAnchor={i === 0 && tickCount > 1 ? 'start' : i === tickCount - 1 ? 'end' : 'middle'}
            fontSize="10"
            fill="var(--t-4)"
            style={mono}
          >
            {dayLabel(new Date(start + d * DAY))}
          </text>
        );
      })}
      <text x="30" y={T + 5} textAnchor="end" fontSize="10" fill="var(--t-4)" style={mono}>
        {b.total}
      </text>
      <text
        x="30"
        y={(T + B) / 2 + 5}
        textAnchor="end"
        fontSize="10"
        fill="var(--t-4)"
        style={mono}
      >
        {Math.round(b.total / 2)}
      </text>
      <text x="30" y={B + 5} textAnchor="end" fontSize="10" fill="var(--t-4)" style={mono}>
        0
      </text>
    </svg>
  );
}
