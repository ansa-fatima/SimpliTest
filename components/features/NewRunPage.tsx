'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiTestCase, CycleScopeType } from '@/types';
import { api } from '@/lib/client';
import { cn, priorityDisplay } from '@/lib/utils';
import { SIco } from '@/components/layout/sts-icons';
import { caseCode, optionPillClass, priorityPillClass } from './tc-helpers';
import { useCaseOptions } from './CaseClassification';
import type { CycleFormPayload } from './NewCycleModal';
import './sts-v3.css';

interface NewRunPageProps {
  projectId: string | null;
  projectName: string;
  onCancel: () => void;
  /** Creates the run; resolves to the new run's id (or null on failure). */
  onCreate: (input: CycleFormPayload) => Promise<string | null>;
  /** Opens the execution runner for a freshly created run. */
  onStart: (id: string) => void;
  /** Called after a plain "Create run" (no start) so the caller can go back to the board. */
  onDone: () => void;
}

type InclusionMode = 'all' | 'specific' | 'rules';
type RuleField = 'priority' | 'type' | 'severity' | 'status' | 'section';

interface Rule {
  id: number;
  field: RuleField;
  values: string[];
}
interface Opt {
  key: string;
  name: string;
}
interface TreeSuite {
  id: string;
  name: string;
  children: TreeSuite[];
}
interface TreePortal {
  id: string;
  name: string;
  modules: { id: string; name: string; suites: TreeSuite[] }[];
}

const FIELD_LABEL: Record<RuleField, string> = {
  priority: 'Priority',
  type: 'Type',
  severity: 'Severity',
  status: 'Status',
  section: 'Section',
};
const STATUS_OPTS: Opt[] = [
  { key: 'Active', name: 'Active' },
  { key: 'Draft', name: 'Draft' },
  { key: 'Archived', name: 'Archived' },
];
const CATEGORY_FALLBACK = ['Stability', 'Regression', 'Functional', 'UI', 'Performance', 'Smoke'];

// Priority chips borrow the status palette like the mockup (Critical red, High amber).
function tagTint(field: RuleField, label: string): React.CSSProperties | undefined {
  if (field !== 'priority') return undefined;
  const l = label.toLowerCase();
  if (l === 'critical' || l === 'blocker')
    return { background: 'var(--err-bg)', color: 'var(--err)' };
  if (l === 'high') return { background: 'var(--warn-bg)', color: 'var(--warn)' };
  return undefined;
}

function flattenSections(tree: TreePortal[]): Opt[] {
  const out: Opt[] = [];
  const walk = (ss: TreeSuite[], prefix: string) => {
    for (const s of ss) {
      out.push({ key: `s:${s.id}`, name: `${prefix} › ${s.name}` });
      walk(s.children ?? [], `${prefix} › ${s.name}`);
    }
  };
  for (const p of tree) {
    out.push({ key: `p:${p.id}`, name: p.name });
    for (const m of p.modules) {
      out.push({ key: `m:${m.id}`, name: `${p.name} › ${m.name}` });
      walk(m.suites, `${p.name} › ${m.name}`);
    }
  }
  return out;
}

function useOptions(projectId: string | null, category: string, fallback: Opt[] = []): Opt[] {
  const [opts, setOpts] = useState<Opt[]>(fallback);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .get<{ options: Opt[] }>(`/api/projects/${projectId}/options/${category}`)
      .then(r => !cancelled && r.options.length > 0 && setOpts(r.options))
      .catch(() => {
        /* keep the fallback list */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, category]);
  return opts;
}

// Screen 07 — full-page "New test run". Test runs are case-based: the run's
// case list is fixed when it is created (from every case, a hand-picked set, or
// the cases matching the filter rules below). Quick logs are a separate flow.
export function NewRunPage({
  projectId,
  projectName,
  onCancel,
  onCreate,
  onStart,
  onDone,
}: NewRunPageProps) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [category, setCategory] = useState('');
  const [environment, setEnvironment] = useState('');
  const [platform, setPlatform] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [testers, setTesters] = useState<{ id: string; name: string; username: string }[]>([]);
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<InclusionMode>('rules');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<'create' | 'start' | null>(null);

  const versions = useOptions(projectId, 'Version');
  const environments = useOptions(projectId, 'Environment');
  const platforms = useOptions(projectId, 'Platform');
  const priorities = useOptions(projectId, 'Priority');
  const priorityColours = useCaseOptions(projectId ?? '').priority;
  const severities = useOptions(projectId, 'Severity');
  const types = useOptions(projectId, 'TestType');
  const [sections, setSections] = useState<Opt[]>([]);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<{ items: { id: string; name: string; username: string; status: string }[] }>(
        `/api/members?projectId=${projectId}`,
      )
      .then(d => setTesters(d.items.filter(m => m.status === 'Active')))
      .catch(() => setTesters([]));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<TreePortal[]>(`/api/portals?projectId=${projectId}`)
      .then(t => setSections(flattenSections(t)))
      .catch(() => setSections([]));
  }, [projectId]);

  // ── all ──
  const [allCount, setAllCount] = useState<number | null>(null);
  useEffect(() => {
    if (!projectId) return;
    api
      .get<{ total: number }>(`/api/test-cases?projectId=${projectId}&pageSize=1`)
      .then(d => setAllCount(d.total))
      .catch(() => setAllCount(null));
  }, [projectId]);

  // ── specific ──
  const [pickQuery, setPickQuery] = useState('');
  const [pickList, setPickList] = useState<ApiTestCase[]>([]);
  const [picked, setPicked] = useState<Map<string, ApiTestCase>>(new Map());
  useEffect(() => {
    if (mode !== 'specific' || !projectId) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams({
        projectId,
        pageSize: '100',
        sort: 'caseNum',
        order: 'asc',
      });
      if (pickQuery.trim()) p.set('search', pickQuery.trim());
      api
        .get<{ items: ApiTestCase[] }>(`/api/test-cases?${p.toString()}`)
        .then(d => setPickList(d.items))
        .catch(() => setPickList([]));
    }, 200);
    return () => clearTimeout(t);
  }, [mode, projectId, pickQuery]);

  // ── rules ──
  const [rules, setRules] = useState<Rule[]>([{ id: 1, field: 'priority', values: [] }]);
  const [matches, setMatches] = useState<ApiTestCase[]>([]);
  const [matching, setMatching] = useState(false);
  const optionsFor = (f: RuleField): Opt[] =>
    f === 'priority'
      ? priorities
      : f === 'type'
        ? types
        : f === 'severity'
          ? severities
          : f === 'status'
            ? STATUS_OPTS
            : sections;
  const activeRules = rules.filter(r => r.values.length > 0);

  useEffect(() => {
    if (mode !== 'rules' || !projectId) return;
    let cancelled = false;
    setMatching(true);
    const t = setTimeout(async () => {
      try {
        const base = new URLSearchParams({ pageSize: '5000', sort: 'caseNum', order: 'asc' });
        for (const r of activeRules) {
          if (r.field === 'section') continue;
          for (const v of r.values) base.append(r.field, v);
        }
        const sectionRule = activeRules.find(r => r.field === 'section');
        const calls: string[] = [];
        if (sectionRule) {
          for (const v of sectionRule.values) {
            const p = new URLSearchParams(base);
            const [kind, id] = [v.slice(0, 1), v.slice(2)];
            p.set(kind === 's' ? 'suiteId' : kind === 'm' ? 'moduleId' : 'portalId', id);
            calls.push(p.toString());
          }
        } else {
          const p = new URLSearchParams(base);
          p.set('projectId', projectId);
          calls.push(p.toString());
        }
        const results = await Promise.all(
          calls.map(q => api.get<{ items: ApiTestCase[] }>(`/api/test-cases?${q}`)),
        );
        const byId = new Map<string, ApiTestCase>();
        for (const r of results) for (const c of r.items) byId.set(c.id, c);
        if (!cancelled) setMatches(Array.from(byId.values()).sort((a, b) => a.caseNum - b.caseNum));
      } catch {
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setMatching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, projectId, JSON.stringify(activeRules)]);

  const priorityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of matches) {
      const l = priorityDisplay(c).label;
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [matches]);
  const draftCount = matches.filter(c => c.status === 'Draft').length;

  const caseTotal =
    mode === 'all' ? (allCount ?? 0) : mode === 'specific' ? picked.size : matches.length;
  const railCases: ApiTestCase[] =
    mode === 'specific' ? Array.from(picked.values()).slice(0, 5) : matches.slice(0, 5);

  const addRule = () => {
    const used = new Set(rules.map(r => r.field));
    const next = (['priority', 'type', 'severity', 'status', 'section'] as RuleField[]).find(
      f => !used.has(f),
    );
    if (next) setRules(rs => [...rs, { id: Date.now(), field: next, values: [] }]);
  };

  const buildPayload = (): CycleFormPayload | null => {
    const payload: CycleFormPayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      mode: 'CaseBased',
      targetDate: targetDate || null,
      assigneeId: assigneeId || null,
      startDate: startDate || null,
      version: version || undefined,
      cycleCategory: category || undefined,
      environment: environment || undefined,
      platform: platform || undefined,
      ticketLink: reference.trim() || undefined,
    };
    if (mode === 'all') {
      payload.scopeType = 'All';
      payload.scopeId = null;
      return payload;
    }
    const ids = mode === 'specific' ? Array.from(picked.keys()) : matches.map(c => c.id);
    // A single Section rule and nothing else is just "that part of the tree" --
    // keep it as a real scope so the run shows its section name.
    const only = mode === 'rules' && activeRules.length === 1 ? activeRules[0] : null;
    if (only && only.field === 'section' && only.values.length === 1) {
      const v = only.values[0];
      const scopeType: CycleScopeType = v[0] === 's' ? 'Suite' : v[0] === 'm' ? 'Module' : 'Portal';
      payload.scopeType = scopeType;
      payload.scopeId = v.slice(2);
      return payload;
    }
    payload.scopeType = 'Custom';
    payload.scopeId = null;
    payload.testCaseIds = ids;
    return payload;
  };

  const submit = async (start: boolean) => {
    setError('');
    if (!name.trim()) return setError('Give the run a name.');
    if (startDate && targetDate && targetDate < startDate)
      return setError('The end date is before the start date.');
    if (caseTotal === 0)
      return setError('This run has no test cases — adjust the inclusion above.');
    const payload = buildPayload();
    if (!payload) return;
    setSaving(start ? 'start' : 'create');
    try {
      const id = await onCreate(payload);
      if (id) {
        if (start) onStart(id);
        else onDone();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const modes: { key: InclusionMode; title: string; desc: React.ReactNode }[] = [
    {
      key: 'all',
      title: 'All cases',
      desc: 'Include every case in the project at the moment the run is created.',
    },
    {
      key: 'specific',
      title: 'Specific selection',
      desc: (
        <>
          Manually pick cases. New cases are <b>not</b> added later.
        </>
      ),
    },
    {
      key: 'rules',
      title: 'Filter rules ✨',
      desc: 'Add every case matching the rules below, with a live preview of what matches.',
    },
  ];

  return (
    <div className="stv3 main-scroll">
      <div className="breadcrumb">
        <span className="crumb">{projectName || 'Project'}</span>
        <span className="sep">/</span>
        <button type="button" className="crumb" onClick={onCancel}>
          Test runs
        </button>
        <span className="sep">/</span>
        <span className="current">New run</span>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title compact">New test run</h1>
          <div className="page-sub">
            Configure scope and details · the case list is fixed when you create the run
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving !== null}
            onClick={() => submit(false)}
          >
            {saving === 'create' ? 'Creating…' : 'Create run'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving !== null}
            onClick={() => submit(true)}
          >
            <SIco name="play" />
            {saving === 'start' ? 'Creating…' : 'Create & start'}
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
            <h3
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--t-1)',
                margin: '0 0 14px',
              }}
            >
              Run details
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
                  placeholder="e.g. Sprint 4.3 — Smoke + High Priority Regression"
                />
              </div>
              <div className="field">
                <label className="label">Milestone / version</label>
                <select
                  className="select"
                  value={version}
                  onChange={e => setVersion(e.target.value)}
                >
                  <option value="">None</option>
                  {versions.map(v => (
                    <option key={v.key} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">Assigned tester</label>
                <select
                  className="select"
                  value={assigneeId}
                  onChange={e => setAssigneeId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {testers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name || t.username}
                    </option>
                  ))}
                </select>
              </div>
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
                <label className="label">End date</label>
                <div className="input-prefix">
                  <span className="prefix">
                    <SIco name="calendar" size={13} />
                  </span>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={e => setTargetDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label className="label">Category</label>
                <select
                  className="select"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                >
                  <option value="">None</option>
                  {CATEGORY_FALLBACK.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">Environment</label>
                <select
                  className="select"
                  value={environment}
                  onChange={e => setEnvironment(e.target.value)}
                >
                  <option value="">Not specified</option>
                  {environments.map(v => (
                    <option key={v.key} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">Platform</label>
                <select
                  className="select"
                  value={platform}
                  onChange={e => setPlatform(e.target.value)}
                >
                  <option value="">Not specified</option>
                  {platforms.map(v => (
                    <option key={v.key} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">
                  References <span className="hint">Jira ticket or URL</span>
                </label>
                <input
                  className="input"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="LMS-2900"
                />
              </div>
              <div className="field span-2">
                <label className="label">Description</label>
                <textarea
                  className="textarea"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What is this run verifying? Defects logged here may block the release."
                />
              </div>
            </div>
          </div>

          <div className="card card-pad-lg">
            <h3
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--t-1)',
                margin: '0 0 14px',
              }}
            >
              Test case inclusion{' '}
              <span
                style={{
                  fontWeight: 400,
                  color: 'var(--t-3)',
                  fontSize: 12.5,
                  marginLeft: 6,
                }}
              >
                How are cases added to this run?
              </span>
            </h3>

            <div className="mode-grid">
              {modes.map(m => (
                <button
                  key={m.key}
                  type="button"
                  className={cn('mode-card', mode === m.key && 'on')}
                  onClick={() => setMode(m.key)}
                >
                  <span className={cn('rd', mode === m.key && 'on')} />
                  <div className="mc-title">{m.title}</div>
                  <div className="mc-desc">{m.desc}</div>
                </button>
              ))}
            </div>

            {mode === 'all' && (
              <div className="rule-box">
                <div style={{ padding: '16px', fontSize: 13, color: 'var(--t-2)' }}>
                  This run will include{' '}
                  <b style={{ color: 'var(--brand-700)' }}>
                    {allCount === null ? '…' : allCount.toLocaleString()} cases
                  </b>{' '}
                  — every case currently in {projectName || 'the project'}.
                </div>
              </div>
            )}

            {mode === 'specific' && (
              <div className="rule-box">
                <div className="rule-head">
                  <div className="rule-title">
                    Pick cases · {picked.size.toLocaleString()} selected
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setPicked(m => {
                          const n = new Map(m);
                          pickList.forEach(c => n.set(c.id, c));
                          return n;
                        })
                      }
                    >
                      Select shown
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={picked.size === 0}
                      onClick={() => setPicked(new Map())}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div style={{ padding: '12px 16px 0' }}>
                  <input
                    className="input"
                    value={pickQuery}
                    onChange={e => setPickQuery(e.target.value)}
                    placeholder="Search cases by title…"
                  />
                </div>
                <div style={{ maxHeight: 280, overflow: 'auto', padding: '8px 0' }}>
                  {pickList.length === 0 ? (
                    <div className="empty-note" style={{ padding: '24px 16px' }}>
                      No cases match.
                    </div>
                  ) : (
                    pickList.map(c => {
                      const on = picked.has(c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() =>
                            setPicked(m => {
                              const n = new Map(m);
                              if (n.has(c.id)) n.delete(c.id);
                              else n.set(c.id, c);
                              return n;
                            })
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '7px 16px',
                            cursor: 'pointer',
                            fontSize: 12.5,
                          }}
                        >
                          <span className={cn('cb', on && 'on')}>
                            <svg viewBox="0 0 12 12">
                              <path d="M2 6L5 9L10 3" />
                            </svg>
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--f-mono)',
                              fontSize: 10.5,
                              color: 'var(--t-4)',
                            }}
                          >
                            {caseCode(c.caseNum)}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              color: 'var(--t-1)',
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {c.title}
                          </span>
                          <span
                            className={cn(
                              'pill',
                              optionPillClass(
                                priorityColours,
                                priorityDisplay(c).label,
                                priorityPillClass(priorityDisplay(c).label),
                              ),
                            )}
                            style={{ padding: '1px 6px', fontSize: 10 }}
                          >
                            {priorityDisplay(c).label}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {mode === 'rules' && (
              <div className="rule-box">
                <div className="rule-head">
                  <div className="rule-title">Filter rules · ALL must match</div>
                </div>
                <div
                  style={{
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {rules.map(r => {
                    const opts = optionsFor(r.field);
                    const remaining = opts.filter(o => !r.values.includes(o.key));
                    const used = new Set(rules.filter(x => x.id !== r.id).map(x => x.field));
                    return (
                      <div key={r.id} className="rule-row">
                        <select
                          className="select sm"
                          value={r.field}
                          onChange={e =>
                            setRules(rs =>
                              rs.map(x =>
                                x.id === r.id
                                  ? { ...x, field: e.target.value as RuleField, values: [] }
                                  : x,
                              ),
                            )
                          }
                        >
                          {(Object.keys(FIELD_LABEL) as RuleField[]).map(f => (
                            <option key={f} value={f} disabled={used.has(f)}>
                              {FIELD_LABEL[f]}
                            </option>
                          ))}
                        </select>
                        <select className="select sm" disabled value="in">
                          <option value="in">is one of</option>
                        </select>
                        <div className="tag-input" style={{ padding: '4px 8px', minHeight: 34 }}>
                          {r.values.map(v => (
                            <span
                              key={v}
                              className="tag"
                              style={tagTint(r.field, opts.find(o => o.key === v)?.name ?? v)}
                            >
                              {opts.find(o => o.key === v)?.name ?? v}
                              <span
                                className="x"
                                onClick={() =>
                                  setRules(rs =>
                                    rs.map(x =>
                                      x.id === r.id
                                        ? { ...x, values: x.values.filter(y => y !== v) }
                                        : x,
                                    ),
                                  )
                                }
                              >
                                <svg viewBox="0 0 12 12">
                                  <path d="M3 3l6 6M9 3l-6 6" />
                                </svg>
                              </span>
                            </span>
                          ))}
                          {remaining.length > 0 && (
                            <select
                              className="tag-add"
                              value=""
                              onChange={e =>
                                e.target.value &&
                                setRules(rs =>
                                  rs.map(x =>
                                    x.id === r.id
                                      ? { ...x, values: [...x.values, e.target.value] }
                                      : x,
                                  ),
                                )
                              }
                            >
                              <option value="">
                                {r.values.length === 0
                                  ? `Choose ${FIELD_LABEL[r.field]}…`
                                  : '+ add'}
                              </option>
                              {remaining.map(o => (
                                <option key={o.key} value={o.key}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ color: 'var(--err)' }}
                          aria-label="Remove rule"
                          onClick={() =>
                            setRules(rs =>
                              rs.length > 1
                                ? rs.filter(x => x.id !== r.id)
                                : [{ ...r, values: [] }],
                            )
                          }
                        >
                          <SIco name="trash" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ alignSelf: 'flex-start', color: 'var(--brand-700)' }}
                    onClick={addRule}
                    disabled={rules.length >= 5}
                  >
                    <SIco name="plus" /> Add rule
                  </button>
                </div>

                <div
                  style={{
                    borderTop: '1px solid var(--bdr)',
                    padding: '14px 16px',
                    background: 'var(--c-surface)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 10,
                    }}
                  >
                    <div
                      className="rule-title"
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <span style={{ color: 'var(--brand-700)', display: 'inline-flex' }}>
                        <SIco name="search" size={13} />
                      </span>
                      Live preview ·{' '}
                      <span style={{ color: 'var(--brand-700)', fontFamily: 'var(--f-mono)' }}>
                        {matching ? 'matching…' : `${matches.length.toLocaleString()} cases match`}
                      </span>
                    </div>
                  </div>
                  <div
                    className="preview-grid"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 8,
                      marginBottom: draftCount > 0 ? 10 : 0,
                    }}
                  >
                    {[0, 1, 2].map(i => {
                      const e = priorityCounts[i];
                      return (
                        <div key={i} className="preview-stat">
                          <div className="ps-l">{e ? e[0] : '—'}</div>
                          <div
                            className="ps-v"
                            style={{
                              color:
                                i === 0 ? 'var(--err)' : i === 1 ? 'var(--warn)' : 'var(--t-1)',
                            }}
                          >
                            {e ? e[1].toLocaleString() : 0}
                          </div>
                        </div>
                      );
                    })}
                    <div className="preview-stat">
                      <div className="ps-l">Draft cases</div>
                      <div className="ps-v" style={{ color: 'var(--brand-700)' }}>
                        {draftCount.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {draftCount > 0 && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: 'var(--t-3)',
                        background: 'var(--warn-bg)',
                        border: '1px solid var(--warn-bdr)',
                        padding: '8px 12px',
                        borderRadius: 'var(--r-sm)',
                        display: 'flex',
                        gap: 8,
                        alignItems: 'flex-start',
                      }}
                    >
                      <span style={{ color: 'var(--warn)', display: 'inline-flex', marginTop: 1 }}>
                        <SIco name="info" size={13} />
                      </span>
                      <div>
                        <b style={{ color: 'var(--warn)' }}>{draftCount} cases</b> matching are in{' '}
                        <i>Draft</i>. Add a Status rule (Active) if you want them left out.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rail">
          <div className="card">
            <div className="card-head">
              <h3>Matched cases · top 5</h3>
              <span className="meta">{caseTotal.toLocaleString()} total</span>
            </div>
            <div style={{ padding: '4px 0', fontSize: 12.5 }}>
              {railCases.length === 0 ? (
                <div className="empty-note" style={{ padding: '24px 16px' }}>
                  {mode === 'all'
                    ? `All ${allCount?.toLocaleString() ?? ''} cases will be included.`
                    : 'No cases yet — choose some above.'}
                </div>
              ) : (
                railCases.map((c, i) => (
                  <div
                    key={c.id}
                    style={{
                      padding: '9px 16px',
                      borderBottom: i < railCases.length - 1 ? '1px solid var(--bdr)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontFamily: 'var(--f-mono)',
                          fontSize: 10.5,
                          color: 'var(--t-4)',
                        }}
                      >
                        {caseCode(c.caseNum)}
                      </span>
                      <span
                        className={cn(
                          'pill',
                          optionPillClass(
                            priorityColours,
                            priorityDisplay(c).label,
                            priorityPillClass(priorityDisplay(c).label),
                          ),
                        )}
                        style={{ padding: '1px 6px', fontSize: 10 }}
                      >
                        {priorityDisplay(c).label}
                      </span>
                    </div>
                    <div style={{ color: 'var(--t-1)', fontWeight: 500, marginTop: 2 }}>
                      {c.title}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, var(--brand-50), var(--brand-100))',
              borderColor: 'var(--brand-bdr)',
            }}
          >
            <div
              className="card-pad"
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--r)',
                  background: 'var(--c-surface)',
                  border: '1px solid var(--brand-bdr)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  color: 'var(--brand-700)',
                }}
              >
                <SIco name="info" size={14} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--brand-800)',
                    marginBottom: 4,
                  }}
                >
                  Runs vs quick logs
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--t-2)', lineHeight: 1.5 }}>
                  A test run executes your cases one by one and records a result for each. To log an
                  aggregate result without cases, use <b>Quick logs</b> instead.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
