'use client';

import { useMemo, useState } from 'react';
import { PlanStatus, TestCycle, TestPlan } from '@/types';
import { cn } from '@/lib/utils';
import { milestoneLabel } from '@/lib/plans';
import { SIco } from '@/components/layout/sts-icons';
import { useOptions } from './NewRunPage';
import { runStatus } from './run-helpers';
import './sts-v3.css';

export interface PlanFormPayload {
  name: string;
  description: string;
  milestone: string | null;
  startDate: string | null;
  dueDate: string | null;
  status?: PlanStatus;
  cycleIds: string[];
}

interface NewPlanPageProps {
  projectId: string | null;
  projectName: string;
  /** Set when editing; null/undefined for a brand-new plan. */
  plan?: TestPlan | null;
  /** Every run in the workspace -- the picker offers the case-based, non-archived ones. */
  cycles: TestCycle[];
  plans: TestPlan[];
  onCancel: () => void;
  /** Resolves true when saved (the caller then leaves the form). */
  /** `newRun`: after saving, continue to the New test run screen with this plan selected. */
  onSave: (input: PlanFormPayload, opts?: { newRun?: boolean }) => Promise<boolean>;
  onDelete?: () => void;
}

const STATUS_LABEL: Record<PlanStatus, string> = {
  Active: 'Active',
  Completed: 'Completed',
  Archived: 'Archived',
};

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

// Full-page New / Edit test plan, laid out like the New test run screen: the plan's
// own details on the left, the runs it groups on the right.
export function NewPlanPage({
  projectId,
  projectName,
  plan,
  cycles,
  plans,
  onCancel,
  onSave,
  onDelete,
}: NewPlanPageProps) {
  const isEdit = !!plan;
  const [name, setName] = useState(plan?.name ?? '');
  const [milestone, setMilestone] = useState(plan?.milestone ?? '');
  const [startDate, setStartDate] = useState(day(plan?.startDate));
  const [dueDate, setDueDate] = useState(day(plan?.dueDate));
  const [status, setStatus] = useState<PlanStatus>(plan?.status ?? 'Active');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(cycles.filter(c => plan && c.planId === plan.id).map(c => c.id)),
  );
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const versions = useOptions(projectId, 'Version');
  const planName = (id: string | null | undefined) => plans.find(p => p.id === id)?.name ?? null;

  // Runs that can join: case-based, not archived. Already in this plan first, then
  // standalone, then ones that belong to another plan (picking one moves it).
  const eligible = useMemo(() => {
    const rank = (c: TestCycle) => (plan && c.planId === plan.id ? 0 : c.planId ? 2 : 1);
    return cycles
      .filter(c => (c.mode ?? 'CaseBased') === 'CaseBased' && c.status !== 'Archived')
      .sort(
        (a, b) =>
          rank(a) - rank(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [cycles, plan]);
  const q = query.trim().toLowerCase();
  const shown = q ? eligible.filter(c => c.name.toLowerCase().includes(q)) : eligible;

  const pickedCases = eligible
    .filter(c => picked.has(c.id))
    .reduce((n, c) => n + (c.summary?.total ?? 0), 0);

  const milestoneNames = versions.map(v => v.name);

  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async (newRun = false) => {
    setError('');
    if (!name.trim()) {
      setError('Give the plan a name.');
      return;
    }
    if (startDate && dueDate && dueDate < startDate) {
      setError('The due date cannot be before the start date.');
      return;
    }
    setSaving(true);
    const done = await onSave(
      {
        name: name.trim(),
        description: description.trim(),
        milestone: milestone.trim() || null,
        startDate: startDate || null,
        dueDate: dueDate || null,
        ...(isEdit ? { status } : {}),
        cycleIds: Array.from(picked),
      },
      { newRun },
    );
    if (!done) setSaving(false);
  };

  return (
    <div className="stv3 main-scroll">
      <div className="breadcrumb">
        <span className="crumb">{projectName || 'Project'}</span>
        <span className="sep">/</span>
        <button type="button" className="crumb" onClick={onCancel}>
          Test runs
        </button>
        <span className="sep">/</span>
        <span className="current">{isEdit ? 'Edit plan' : 'New plan'}</span>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title compact">{isEdit ? 'Edit test plan' : 'New test plan'}</h1>
          <div className="page-sub">
            Group runs under one release or sprint · progress, pass rate and burn-down roll up from
            the runs you add
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          {!isEdit && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => submit(true)}
              disabled={saving}
            >
              <SIco name="play" />
              Create plan &amp; new run
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => submit()}
            disabled={saving}
          >
            <SIco name={isEdit ? 'check' : 'plus'} />
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create plan'}
          </button>
        </div>
      </div>

      {error && (
        <div className="login-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="split-rail split-rail-380">
        <div style={{ minWidth: 0 }}>
          <div className="card card-pad-lg" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-1)', margin: '0 0 14px' }}>
              Plan details
            </h3>
            <div className="form-grid">
              <div className="field span-2">
                <label className="label">
                  Name <span className="req">*</span>
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={160}
                  placeholder="e.g. Sprint 4.3 — Regression Suite"
                  autoFocus={!isEdit}
                />
              </div>
              <div className="field">
                <label className="label">Milestone / version</label>
                {/* Pick one of the workspace's versions or type a new one (e.g. v2.4.0). */}
                <input
                  className="input"
                  list="plan-milestones"
                  value={milestone}
                  onChange={e => setMilestone(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. v2.4.0"
                />
                <datalist id="plan-milestones">
                  {milestoneNames.map(v => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>
              {isEdit ? (
                <div className="field">
                  <label className="label">Status</label>
                  <select
                    className="select"
                    value={status}
                    onChange={e => setStatus(e.target.value as PlanStatus)}
                  >
                    {(Object.keys(STATUS_LABEL) as PlanStatus[]).map(s => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field" />
              )}
              <div className="field">
                <label className="label">Start date</label>
                <div className="input-prefix">
                  <span className="prefix">
                    <SIco name="calendar" size={13} />
                  </span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label className="label">
                  Due date <span className="hint">drives the burn-down</span>
                </label>
                <div className="input-prefix">
                  <span className="prefix">
                    <SIco name="calendar" size={13} />
                  </span>
                  <input
                    type="date"
                    value={dueDate}
                    min={startDate || undefined}
                    onChange={e => setDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="field span-2">
                <label className="label">Description</label>
                <textarea
                  className="textarea"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What does this plan cover? Which release or sprint is it gating?"
                />
              </div>
            </div>
          </div>

          {isEdit && onDelete && (
            <div className="card card-pad-lg">
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-1)', margin: '0 0 4px' }}>
                Delete this plan
              </h3>
              <p style={{ fontSize: 12.5, color: 'var(--t-3)', margin: '0 0 12px' }}>
                Only the plan is removed. Its runs and their results are kept and become standalone
                runs.
              </p>
              <button type="button" className="btn btn-secondary" onClick={onDelete}>
                <SIco name="trash" />
                Delete plan
              </button>
            </div>
          )}
        </div>

        <div className="rail">
          <div className="card">
            <div className="card-head">
              <h3>
                <SIco name="play" /> Runs in this plan
              </h3>
              <span className="meta">
                {picked.size} selected · {pickedCases.toLocaleString()} cases
              </span>
            </div>
            {eligible.length === 0 ? (
              <div className="empty-note" style={{ padding: '22px 16px' }}>
                No test runs yet.{' '}
                {isEdit ? (
                  'Create one from the plan page.'
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-link"
                      disabled={saving}
                      onClick={() => submit(true)}
                    >
                      Create the plan and its first run
                    </button>{' '}
                    — the New test run screen opens with this plan selected.
                  </>
                )}
              </div>
            ) : (
              <>
                {eligible.length > 6 && (
                  <div style={{ padding: '12px 16px 4px' }}>
                    <input
                      className="input"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Search runs…"
                    />
                  </div>
                )}
                <div style={{ maxHeight: 420, overflow: 'auto' }}>
                  {shown.length === 0 ? (
                    <div className="empty-note" style={{ padding: '18px 16px' }}>
                      No runs match.
                    </div>
                  ) : (
                    shown.map(c => {
                      const on = picked.has(c.id);
                      const st = runStatus(c);
                      const other = c.planId && c.planId !== plan?.id ? planName(c.planId) : null;
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
                            <span
                              style={{
                                display: 'block',
                                color: 'var(--t-1)',
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {c.name}
                            </span>
                            <span
                              className="id-mono"
                              style={{ display: 'block', whiteSpace: 'normal' }}
                            >
                              {(c.summary?.total ?? 0).toLocaleString()} cases
                              {c.version ? ` · ${milestoneLabel(c.version)}` : ''}
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
              </>
            )}
          </div>

          <HowPlansWork milestone={milestone} />
        </div>
      </div>
    </div>
  );
}

/** The mockup's "How plans work" note (screen 08), shared with the plan page. */
export function HowPlansWork({ milestone }: { milestone: string | null | undefined }) {
  const label = milestoneLabel(milestone);
  return (
    <div className="card plan-info">
      <div className="card-pad" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div className="plan-info-icon">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--brand-700)"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </div>
        <div>
          <div
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-800)', marginBottom: 4 }}
          >
            How plans work
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--t-2)', lineHeight: 1.5 }}>
            For every test run you add to this plan, the system automatically starts a corresponding
            execution and inherits the milestone <b>{label ?? 'you pick for the plan'}</b>.
          </div>
        </div>
      </div>
    </div>
  );
}
