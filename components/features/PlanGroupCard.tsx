'use client';

import { useState } from 'react';
import { TestCycle, TestPlan } from '@/types';
import { cn } from '@/lib/utils';
import {
  ago,
  milestoneLabel,
  planPillOf,
  planStateOf,
  rollUpPlan,
  shortDate,
  type PlanRollup,
} from '@/lib/plans';
import { SIco } from '@/components/layout/sts-icons';
import { PersonAvatar, useUserAvatars } from './PersonAvatar';
import { isStarted, passRateColour, runStatus } from './run-helpers';
import './sts-v3.css';

interface PlanGroupCardProps {
  plan: TestPlan;
  /** The runs linked to this plan, already filtered by the caller. */
  runs: TestCycle[];
  onOpenPlan: (id: string) => void;
  /** Card menu: edit / delete the plan (the runs are kept when a plan is deleted). */
  onEditPlan?: (id: string) => void;
  onDeletePlan?: (plan: TestPlan) => void;
  onExecute: (cycleId: string) => void;
  onDetails: (cycleId: string) => void;
}

// A plan on the Test runs board (mockup screen 06): a gradient header with the plan's
// name, state, milestone and rolled-up progress, above the table of runs it groups.
export function PlanGroupCard({
  plan,
  runs,
  onOpenPlan,
  onEditPlan,
  onDeletePlan,
  onExecute,
  onDetails,
}: PlanGroupCardProps) {
  // Fixed-position, like the run rows' menu: the card clips overflow.
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const roll = rollUpPlan(runs);
  const state = planStateOf(plan, roll);
  const pill = planPillOf(state);
  const milestone = milestoneLabel(plan.milestone);
  const startedOn = shortDate(plan.startDate ?? plan.createdAt);

  return (
    <div className="card plan-card" style={{ marginBottom: 14 }}>
      <div className="plan-head">
        <div className="plan-icon">
          <SIco name="flag" size={16} />
        </div>
        <div className="plan-head-main">
          <div className="plan-head-title">
            <h3 className="plan-name" onClick={() => onOpenPlan(plan.id)}>
              {plan.name}
            </h3>
            <span className={cn('pill', pill.pill)}>
              {pill.dot && <span className="dot" />} {state}
            </span>
            {milestone && <span className="pill pill-neutral">{milestone}</span>}
          </div>
          <PlanMeta plan={plan} roll={roll} startedOn={startedOn} />
        </div>
        <div className="plan-head-side">
          <div className="plan-progress">
            <div className="plan-progress-label">Plan progress</div>
            <div className="plan-progress-bar">
              <div className="progress" style={{ width: 140 }}>
                <span className="progress-bar ok" style={{ width: `${roll.percent}%` }} />
              </div>
              <span className="plan-progress-pct">{roll.percent}%</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onOpenPlan(plan.id)}
          >
            Open plan
          </button>
          {(onEditPlan || onDeletePlan) && (
            <>
              <button
                type="button"
                className="icon-btn row-menu-btn"
                aria-label="Plan actions"
                aria-haspopup="menu"
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu(m =>
                    m ? null : { top: r.bottom + 6, right: window.innerWidth - r.right },
                  );
                }}
              >
                <SIco name="dots" />
              </button>
              {menu && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                    onClick={() => setMenu(null)}
                  />
                  <div
                    className="tb-menu"
                    role="menu"
                    style={{
                      width: 170,
                      zIndex: 31,
                      position: 'fixed',
                      top: menu.top,
                      right: menu.right,
                    }}
                  >
                    <button
                      type="button"
                      className="tb-menu-item"
                      onClick={() => {
                        setMenu(null);
                        onOpenPlan(plan.id);
                      }}
                    >
                      <SIco name="info" size={14} />
                      <span className="grow">View plan</span>
                    </button>
                    {onEditPlan && (
                      <button
                        type="button"
                        className="tb-menu-item"
                        onClick={() => {
                          setMenu(null);
                          onEditPlan(plan.id);
                        }}
                      >
                        <SIco name="edit" size={14} />
                        <span className="grow">Edit plan</span>
                      </button>
                    )}
                    {onDeletePlan && (
                      <>
                        <hr />
                        <button
                          type="button"
                          className="tb-menu-item danger"
                          onClick={() => {
                            setMenu(null);
                            onDeletePlan(plan);
                          }}
                        >
                          <SIco name="trash" size={14} />
                          <span className="grow">Delete plan</span>
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="empty-note plan-empty">
          No runs in this plan yet.{' '}
          <button type="button" className="btn-link" onClick={() => onOpenPlan(plan.id)}>
            Add a run
          </button>
        </div>
      ) : (
        <table className="t runs-table plan-runs-table">
          <thead>
            <tr>
              <th className="plan-run-th">Run</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Progress</th>
              <th>Pass</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map(c => (
              <PlanRunRow
                key={c.id}
                cycle={c}
                onExecute={() => onExecute(c.id)}
                onDetails={() => onDetails(c.id)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlanMeta({
  plan,
  roll,
  startedOn,
}: {
  plan: TestPlan;
  roll: PlanRollup;
  startedOn: string;
}) {
  return (
    <div className="plan-meta">
      {roll.runs} {roll.runs === 1 ? 'run' : 'runs'} · {roll.total.toLocaleString()} cases
      {plan.createdByName && (
        <>
          {' '}
          · created by <b>{plan.createdByName.split(/\s+/)[0]}</b>
        </>
      )}
      {startedOn && (
        <>
          {' '}
          · {roll.done > 0 || plan.status === 'Completed' ? 'started' : 'starts'} {startedOn}
        </>
      )}
    </div>
  );
}

/** One run inside a plan -- shared by the board's plan cards and the plan page. */
export function PlanRunRow({
  cycle: c,
  onExecute,
  onDetails,
  openLabel,
  showExecute = true,
  lastRun = false,
  trailing,
}: {
  cycle: TestCycle;
  onExecute: () => void;
  onDetails: () => void;
  /** Plan page: the action button reads "Open" instead of Execute/Resume. */
  openLabel?: string;
  showExecute?: boolean;
  /** Plan page: the time column is "Last run" (last verdict) rather than "Started". */
  lastRun?: boolean;
  trailing?: React.ReactNode;
}) {
  const avatars = useUserAvatars();
  const s = c.summary;
  const total = s?.total ?? 0;
  const done = s?.done ?? 0;
  const counts = s?.counts ?? { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const passRate = done === 0 ? null : (counts.Passed / done) * 100;
  const st = runStatus(c);
  const scope = c.scopeName ?? (c.scopeType === 'All' ? 'All cases' : c.scopeType);
  const when = lastRun ? c.lastExecutedAt : (c.startDate ?? c.createdAt);

  return (
    <tr>
      <td className={cn('rt-title', !openLabel && 'plan-run-title')}>
        <div className="plan-run-cell">
          {!openLabel && (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--t-3)"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 11l4 4 14-14" />
            </svg>
          )}
          <div>
            <div className="row-title" style={{ cursor: 'pointer' }} onClick={onDetails}>
              {c.name}
            </div>
            <div className="id-mono">
              {scope} · {total.toLocaleString()} cases
            </div>
          </div>
        </div>
      </td>
      <td className="rt-status">
        <span className={cn('pill', st.pill)}>
          {st.dot && <span className="dot" />} {st.label}
        </span>
      </td>
      <td className="rt-owner" data-label="Owner">
        {c.tester ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PersonAvatar name={c.tester} avatars={avatars} />
            {c.tester.split(/\s+/)[0]}
          </div>
        ) : (
          <span style={{ color: 'var(--t-4)' }}>Unassigned</span>
        )}
      </td>
      <td className="rt-progress">
        <div className="progress" style={{ width: 140 }}>
          <div className="progress-stacked">
            <span style={{ width: `${pct(counts.Passed)}%`, background: 'var(--ok)' }} />
            <span style={{ width: `${pct(counts.Failed)}%`, background: 'var(--err)' }} />
            <span style={{ width: `${pct(counts.Blocked)}%`, background: 'var(--warn)' }} />
            <span style={{ width: `${pct(counts.Skipped)}%`, background: 'var(--info)' }} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 3 }}>
          {done.toLocaleString()} / {total.toLocaleString()}
        </div>
      </td>
      <td className="rt-pass" data-label={lastRun ? 'Pass rate' : 'Pass'}>
        <span style={{ fontWeight: 600, color: passRateColour(passRate) }}>
          {passRate === null ? '—' : `${passRate.toFixed(1)}%`}
        </span>
      </td>
      <td className="rt-started" style={{ fontSize: 12, color: 'var(--t-3)' }}>
        {ago(when)}
      </td>
      <td className="rt-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {openLabel ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onExecute}>
              {openLabel}
            </button>
          ) : (
            showExecute &&
            c.status === 'Active' && (
              <button
                type="button"
                className={cn('btn btn-sm', isStarted(c) ? 'btn-secondary' : 'btn-primary')}
                onClick={onExecute}
              >
                {isStarted(c) ? (
                  'Resume'
                ) : (
                  <>
                    <SIco name="play" /> Execute
                  </>
                )}
              </button>
            )
          )}
          {trailing}
        </div>
      </td>
    </tr>
  );
}
