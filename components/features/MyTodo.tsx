'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { SIco } from '@/components/layout/sts-icons';
import './sts-v3.css';

interface TodoItem {
  runId: string;
  result: 'NotRun' | 'Failed';
  retest: boolean;
  cycleId: string;
  cycleName: string;
  projectId: string;
  projectName: string;
  dueDate: string | null;
  caseId: string;
  caseNum: number;
  title: string;
  priority: string;
}

type Filter = 'all' | 'pending' | 'failed' | 'retest' | 'today';
type GroupKey = 'overdue' | 'today' | 'week' | 'later' | 'none';

const DAY = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A run's target date is a calendar date (stored as UTC midnight), not an
// instant -- read its UTC parts so it never slips a day in negative-offset
// timezones. The work is due at the end of that day, local time.
function dueDay(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function groupOf(iso: string | null): GroupKey {
  if (!iso) return 'none';
  const diff = Math.round((dueDay(iso).getTime() - startOfToday().getTime()) / DAY);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'later';
}

function dueLabel(iso: string | null): string {
  if (!iso) return 'No due date';
  const day = dueDay(iso);
  const diff = Math.round((day.getTime() - startOfToday().getTime()) / DAY);
  if (diff === 0) return 'Today · 23:59';
  if (diff === 1) return 'Tomorrow · 23:59';
  if (diff > 1 && diff <= 7) return `${WEEKDAYS[day.getDay()]} · 23:59`;
  return `${MONTHS[day.getMonth()]} ${day.getDate()} · 23:59`;
}

function endsIn(): string {
  const n = new Date();
  const end = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59);
  const mins = Math.max(0, Math.floor((end.getTime() - n.getTime()) / 60_000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function priorityPill(p: string): string {
  const k = p.toLowerCase();
  if (k === 'critical') return 'pill-info';
  if (k === 'high') return 'pill-warn';
  return 'pill-neutral';
}

const GROUPS: { key: GroupKey; title: string }[] = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'today', title: 'Due today' },
  { key: 'week', title: 'This week' },
  { key: 'later', title: 'Later' },
  { key: 'none', title: 'No due date' },
];

function StatusDot({ item }: { item: TodoItem }) {
  if (item.result === 'Failed') {
    return (
      <span className="rcs s-fail" style={{ width: 18, height: 18 }}>
        <svg viewBox="0 0 12 12">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </span>
    );
  }
  if (item.retest) {
    return (
      <span className="rcs s-retest" style={{ width: 18, height: 18 }}>
        <svg viewBox="0 0 12 12">
          <path d="M2 6a4 4 0 018 0M10 6L8 8M10 6l-2-2" />
        </svg>
      </span>
    );
  }
  return <span className="rcs s-pending" style={{ width: 18, height: 18 }} />;
}

interface MyTodoProps {
  onOpenCycle: (cycleId: string) => void;
}

export function MyTodo({ onOpenCycle }: MyTodoProps) {
  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [project, setProject] = useState('');
  const [priority, setPriority] = useState('');

  useEffect(() => {
    let live = true;
    api
      .get<{ items: TodoItem[] }>('/api/my-todo')
      .then(r => live && setItems(r.items))
      .catch(e => live && setError((e as Error).message || 'Failed to load'));
    return () => {
      live = false;
    };
  }, []);

  const projects = useMemo(() => {
    const m = new Map<string, string>();
    (items ?? []).forEach(i => m.set(i.projectId, i.projectName));
    return Array.from(m.entries());
  }, [items]);
  const priorities = useMemo(
    () => Array.from(new Set((items ?? []).map(i => i.priority))).sort(),
    [items],
  );

  const scoped = useMemo(
    () =>
      (items ?? []).filter(
        i => (!project || i.projectId === project) && (!priority || i.priority === priority),
      ),
    [items, project, priority],
  );

  const counts = useMemo(
    () => ({
      all: scoped.length,
      pending: scoped.filter(i => i.result === 'NotRun' && !i.retest).length,
      failed: scoped.filter(i => i.result === 'Failed').length,
      retest: scoped.filter(i => i.retest).length,
      today: scoped.filter(i => groupOf(i.dueDate) === 'today').length,
    }),
    [scoped],
  );

  const visible = useMemo(
    () =>
      scoped.filter(i => {
        if (filter === 'pending') return i.result === 'NotRun' && !i.retest;
        if (filter === 'failed') return i.result === 'Failed';
        if (filter === 'retest') return i.retest;
        if (filter === 'today') return groupOf(i.dueDate) === 'today';
        return true;
      }),
    [scoped, filter],
  );

  const grouped = useMemo(
    () =>
      GROUPS.map(g => ({ ...g, rows: visible.filter(i => groupOf(i.dueDate) === g.key) })).filter(
        g => g.rows.length > 0,
      ),
    [visible],
  );

  if (error) {
    return (
      <div className="stv3 state-note" style={{ color: 'var(--err)' }}>
        {error}
      </div>
    );
  }
  if (!items) return <div className="stv3 state-note">Loading…</div>;

  const runCount = new Set(scoped.map(i => i.cycleId)).size;
  const first = grouped[0]?.rows[0];

  return (
    <div className="stv3 main-scroll">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            My <em>to-do</em>
          </h1>
          <div className="page-sub">
            {counts.all} {counts.all === 1 ? 'case' : 'cases'} across {runCount} active{' '}
            {runCount === 1 ? 'run' : 'runs'} · {counts.today} due today
          </div>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className={cn('btn btn-secondary', showFilters && 'is-on')}
            onClick={() => setShowFilters(v => !v)}
          >
            <SIco name="filter" /> Filters
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!first}
            onClick={() => first && onOpenCycle(first.cycleId)}
          >
            <SIco name="play" /> Start next case
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="todo-filters">
          <select className="select" value={project} onChange={e => setProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select className="select" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            {priorities.map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="filter-pills" style={{ marginBottom: 18 }}>
        <button
          type="button"
          className={cn('fpill', filter === 'all' && 'active')}
          onClick={() => setFilter('all')}
        >
          All <span className="count">{counts.all}</span>
        </button>
        <button
          type="button"
          className={cn('fpill', filter === 'pending' && 'active')}
          onClick={() => setFilter('pending')}
        >
          Pending <span className="count">{counts.pending}</span>
        </button>
        <button
          type="button"
          className={cn('fpill', filter === 'failed' && 'active')}
          onClick={() => setFilter('failed')}
        >
          Failed (mine) <span className="count">{counts.failed}</span>
        </button>
        <button
          type="button"
          className={cn('fpill', filter === 'retest' && 'active')}
          onClick={() => setFilter('retest')}
        >
          Retest <span className="count">{counts.retest}</span>
        </button>
        <button
          type="button"
          className={cn('fpill fpill-due', filter === 'today' && 'active')}
          onClick={() => setFilter('today')}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>{' '}
          Due today <span className="count">{counts.today}</span>
        </button>
      </div>

      {grouped.length === 0 && (
        <div className="card">
          <div className="empty-note" style={{ padding: 32, textAlign: 'center' }}>
            {items.length === 0
              ? 'Nothing assigned to you right now — cases you own in an active run show up here.'
              : 'No cases match these filters.'}
          </div>
        </div>
      )}

      {grouped.map(g => {
        const urgent = g.key === 'today' || g.key === 'overdue';
        return (
          <div key={g.key} className="card" style={{ marginBottom: 14 }}>
            <div className={cn('card-head', urgent && 'card-head-err')}>
              <h3 style={urgent ? { color: 'var(--err)' } : undefined}>
                {urgent && (
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                )}{' '}
                {g.title}
              </h3>
              <span className="meta">
                {g.rows.length} {g.rows.length === 1 ? 'case' : 'cases'}
                {g.key === 'today' && ` · ends in ${endsIn()}`}
              </span>
            </div>
            <table className="t">
              <tbody>
                {g.rows.map(i => (
                  <tr key={i.runId} className="todo-row" onClick={() => onOpenCycle(i.cycleId)}>
                    <td style={{ width: 40 }}>
                      <StatusDot item={i} />
                    </td>
                    <td style={{ width: 80 }}>
                      <span className="id-mono">C-{String(i.caseNum).padStart(4, '0')}</span>
                    </td>
                    <td>
                      <div className="row-title">{i.title}</div>
                      <div className="id-mono" style={{ marginTop: 2 }}>
                        {i.projectName} · {i.cycleName}
                      </div>
                    </td>
                    <td>
                      <span className={cn('pill', priorityPill(i.priority))}>{i.priority}</span>
                    </td>
                    <td
                      style={
                        urgent
                          ? { fontSize: 12, color: 'var(--err)', fontWeight: 500 }
                          : { fontSize: 12, color: 'var(--t-3)' }
                      }
                    >
                      {dueLabel(i.dueDate)}
                    </td>
                    <td>
                      {g.key === 'today' ? (
                        <button type="button" className="btn btn-primary btn-sm">
                          <SIco name="play" /> Start
                        </button>
                      ) : (
                        <button type="button" className="btn btn-secondary btn-sm">
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
