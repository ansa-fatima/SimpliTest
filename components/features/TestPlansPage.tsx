'use client';

import { Gate } from '@/components/ui/Gate';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { useMemo, useState } from 'react';
import { TestCycle, TestPlan } from '@/types';
import { cn } from '@/lib/utils';
import { planStateOf, rollUpPlan } from '@/lib/plans';
import { SIco } from '@/components/layout/sts-icons';
import { PlanGroupCard } from './PlanGroupCard';
import './sts-v3.css';

interface TestPlansPageProps {
  plans: TestPlan[];
  cycles: TestCycle[];
  loading: boolean;
  projectId?: string | null;
  projectName: string;
  onOpenPlan: (id: string) => void;
  onEditPlan: (id: string) => void;
  onDeletePlan: (plan: TestPlan) => void;
  onNewPlan: () => void;
  onOpenRun: (id: string) => void;
  onOpenOverview: (id: string) => void;
}

type View = 'all' | 'active' | 'completed';

// The sidebar's Test plans entry: every plan in the workspace as the same card the
// Test runs board uses, without the standalone runs.
export function TestPlansPage({
  plans,
  cycles,
  loading,
  projectId,
  projectName,
  onOpenPlan,
  onEditPlan,
  onDeletePlan,
  onNewPlan,
  onOpenRun,
  onOpenOverview,
}: TestPlansPageProps) {
  const [view, setView] = useState<View>('all');
  const canCreate = useMyPermissions(projectId).can('createCycles');

  const rows = useMemo(
    () =>
      plans.map(p => {
        const runs = cycles.filter(c => c.planId === p.id);
        return { plan: p, runs, state: planStateOf(p, rollUpPlan(runs)) };
      }),
    [plans, cycles],
  );
  const active = rows.filter(r => r.state === 'Planned' || r.state === 'In progress');
  const done = rows.filter(r => r.state === 'Completed' || r.state === 'Archived');
  const shown = view === 'active' ? active : view === 'completed' ? done : rows;
  const totalRuns = rows.reduce((n, r) => n + r.runs.length, 0);

  return (
    <div className="stv3 main-scroll">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <span className="crumb">{projectName || 'Project'}</span>
            <span className="sep">/</span>
            <span className="current">Test plans</span>
          </div>
          <h1 className="page-title">
            Test <em>plans</em>
          </h1>
          <div className="page-sub">
            {plans.length} {plans.length === 1 ? 'plan' : 'plans'} · {totalRuns}{' '}
            {totalRuns === 1 ? 'run' : 'runs'} grouped — a plan rolls its runs up into one progress,
            pass rate and burn-down
          </div>
        </div>
        <div className="page-actions">
          <Gate allowed={canCreate}>
            <button type="button" className="btn btn-primary" onClick={onNewPlan}>
              <SIco name="plus" />
              New test plan
            </button>
          </Gate>
        </div>
      </div>

      <div className="filter-pills" style={{ marginBottom: 18 }}>
        {(
          [
            ['all', 'All', rows.length],
            ['active', 'Active', active.length],
            ['completed', 'Completed', done.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={cn('fpill', view === key && 'active')}
            onClick={() => setView(key)}
          >
            {label} <span className="count">{count}</span>
          </button>
        ))}
      </div>

      {loading && plans.length === 0 ? (
        <div className="card">
          <div className="empty-note">Loading…</div>
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          <div className="empty-note">
            {plans.length === 0 ? (
              <>
                No test plans yet. A plan groups runs under one release or sprint.{' '}
                <button type="button" className="btn-link" onClick={onNewPlan}>
                  Create the first one
                </button>
              </>
            ) : (
              'No plans in this view.'
            )}
          </div>
        </div>
      ) : (
        shown.map(r => (
          <PlanGroupCard
            key={r.plan.id}
            plan={r.plan}
            runs={r.runs}
            onOpenPlan={onOpenPlan}
            onEditPlan={onEditPlan}
            onDeletePlan={onDeletePlan}
            onExecute={onOpenRun}
            onDetails={onOpenOverview}
          />
        ))
      )}
    </div>
  );
}
