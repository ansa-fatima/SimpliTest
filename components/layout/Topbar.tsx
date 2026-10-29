'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiTestCase, Page, Project } from '@/types';
import { cn, relativeTime } from '@/lib/utils';
import { api } from '@/lib/client';
import { SessionUser } from '@/hooks/useStore';
import { useTheme } from '@/lib/theme';
import { BrandMark, SIco } from '@/components/layout/sts-icons';
import { projectGradient } from '@/lib/projectIdentity';
import '@/components/features/sts-v3.css';

interface TopbarProps {
  user: SessionUser | null;
  page: Page;

  // Workspace switcher (kept as "project" in the DB).
  projects: Project[];
  currentProjectId: string | null;
  onSwitchProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (id: string) => void;
  onShowProjects: () => void;
  onShowDashboard: () => void;

  onOpenCase: (apiCase: ApiTestCase, apiList: ApiTestCase[]) => void;
  onShowProfile: () => void;
  onLogout: () => void;
}

// Purple application bar from the SimpliEd mockup: brand, section name,
// workspace switcher, global case search, then theme / activity / account.
export function Topbar({
  user,
  page,
  projects,
  currentProjectId,
  onSwitchProject,
  onCreateProject,
  onDeleteProject,
  onShowProjects,
  onShowDashboard,
  onOpenCase,
  onShowProfile,
  onLogout,
}: TopbarProps) {
  const onProjects = page === 'projects';
  const onTodo = page === 'todo';
  const sectionLabel = onProjects
    ? 'Testcase System'
    : onTodo
      ? 'My to-do'
      : page === 'testRuns' || page === 'newRun'
        ? 'Test runs'
        : page === 'roles'
          ? 'Admin · Roles'
          : page === 'quickLogs'
            ? 'Quick logs'
            : page === 'testPlans'
              ? 'Test plans'
              : page === 'plan' || page === 'newPlan' || page === 'editPlan'
                ? 'Test plan'
                : page === 'cycleOverview'
                  ? 'Test run'
                  : page === 'cycle'
                    ? 'Execution'
                    : 'Project';
  return (
    <div className="stv3 stv3-host">
      <header className="topbar">
        <button type="button" className="brand" onClick={onShowDashboard} title="SimpliEd">
          <BrandMark />
          <div className="brand-name">
            Simpli<em>Ed</em>
          </div>
        </button>
        <button type="button" className="app-launcher" title="Workspaces" onClick={onShowProjects}>
          <SIco name="launcher" />
        </button>
        <div className="section-name">
          {/* The single-plan screens carry no icon in the mockup (just "Test plan"). */}
          {page !== 'plan' && page !== 'newPlan' && page !== 'editPlan' && (
            <SIco
              name={
                onProjects || onTodo
                  ? 'todo'
                  : page === 'testRuns' ||
                      page === 'newRun' ||
                      page === 'cycle' ||
                      page === 'cycleOverview'
                    ? 'play'
                    : page === 'testPlans'
                      ? 'flag'
                      : page === 'quickLogs'
                        ? 'zap'
                        : 'briefcase'
              }
            />
          )}
          {sectionLabel}
        </div>

        {!onTodo && (
          <ProjectSwitcher
            projects={projects}
            current={projects.find(p => p.id === currentProjectId) ?? null}
            allProjects={onProjects}
            onSwitch={onSwitchProject}
            onCreate={onCreateProject}
            onDelete={onDeleteProject}
            onShowProjects={onShowProjects}
          />
        )}

        <CaseSearch projectId={currentProjectId} onOpenCase={onOpenCase} />

        <div className="topbar-actions">
          <ThemeToggleButton />
          <NotificationBell projectId={currentProjectId} />
          {user && <UserChip user={user} onLogout={onLogout} onShowProfile={onShowProfile} />}
        </div>
      </header>
    </div>
  );
}

// ─── Global case search ───────────────────────────────────────

function CaseSearch({
  projectId,
  onOpenCase,
}: {
  projectId: string | null;
  onOpenCase: (apiCase: ApiTestCase, apiList: ApiTestCase[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ApiTestCase[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ⌘K / Ctrl+K jumps to the search box, as the kbd hint promises.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q || !projectId) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          projectId,
          search: q,
          pageSize: '6',
          sort: 'title',
          order: 'asc',
        });
        const data = await api.get<{ items: ApiTestCase[] }>(
          `/api/test-cases?${params.toString()}`,
        );
        setResults(data.items);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, projectId]);

  return (
    <div ref={ref} className="topbar-search">
      <SIco name="search" />
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        placeholder="Search test cases…"
      />
      <span className="kbd">⌘K</span>

      {open && query.trim() && (
        <div className="tb-menu left tb-results">
          {loading ? (
            <p className="tb-menu-label">Searching…</p>
          ) : results.length === 0 ? (
            <p className="tb-menu-label" style={{ textTransform: 'none', letterSpacing: 0 }}>
              No test cases match &quot;{query.trim()}&quot;
            </p>
          ) : (
            results.map(r => (
              <button
                key={r.id}
                type="button"
                className="tb-menu-item"
                onClick={() => {
                  onOpenCase(r, [r]);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--t-3)' }}>
                  C-{String(r.caseNum).padStart(4, '0')}
                </span>
                <span className="grow">{r.title}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Notification bell (real recent activity, fetched on open) ─

type ActivityEvent =
  | { kind: 'run'; actor: string; caseLabel: string; result: string; cycleName: string; ts: string }
  | { kind: 'quicklog'; actor: string; scopeName: string; ts: string };

function NotificationBell({ projectId }: { projectId: string | null }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && projectId) {
      setLoading(true);
      try {
        const data = await api.get<{ recentActivity: ActivityEvent[] }>(
          `/api/dashboard?projectId=${projectId}`,
        );
        setEvents(data.recentActivity);
      } catch {
        setEvents([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const plain = { textTransform: 'none', letterSpacing: 0 } as const;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="tb-icon-btn"
        onClick={toggle}
        aria-label="Recent activity"
        title="Recent activity"
      >
        <span className="dot" />
        <SIco name="bell" />
      </button>

      {open && (
        <div className="tb-menu right" style={{ width: 320 }}>
          <p className="tb-menu-label">Recent activity</p>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            {loading ? (
              <p className="tb-menu-label" style={plain}>
                Loading…
              </p>
            ) : !events || events.length === 0 ? (
              <p className="tb-menu-label" style={plain}>
                No recent activity
              </p>
            ) : (
              events.slice(0, 8).map((e, i) => (
                <div
                  key={i}
                  style={{
                    padding: '7px 10px',
                    fontSize: 12.5,
                    color: 'var(--t-2)',
                    lineHeight: 1.4,
                  }}
                >
                  <b style={{ color: 'var(--t-1)', fontWeight: 600 }}>{e.actor}</b>{' '}
                  {e.kind === 'run' ? (
                    <>
                      marked{' '}
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5 }}>
                        {e.caseLabel}
                      </span>{' '}
                      as{' '}
                      <b
                        style={{
                          color:
                            e.result === 'Passed'
                              ? 'var(--ok)'
                              : e.result === 'Failed'
                                ? 'var(--err)'
                                : 'var(--warn)',
                        }}
                      >
                        {e.result}
                      </b>{' '}
                      in {e.cycleName}
                    </>
                  ) : (
                    <>
                      logged a quick log against{' '}
                      <b style={{ color: 'var(--t-1)', fontWeight: 500 }}>{e.scopeName}</b>
                    </>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--t-4)', marginTop: 2 }}>
                    {relativeTime(e.ts)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Workspace / project switcher ────────────────────────────

interface ProjectSwitcherProps {
  projects: Project[];
  current: Project | null;
  allProjects: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  onShowProjects: () => void;
}

function ProjectSwitcher({
  projects,
  current,
  allProjects,
  onSwitch,
  onCreate,
  onDelete,
  onShowProjects,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const submit = () => {
    if (draft.trim()) onCreate(draft.trim());
    setCreating(false);
    setDraft('');
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', zIndex: 5 }}>
      <button type="button" className="project-switcher" onClick={() => setOpen(o => !o)}>
        <div
          className="ps-icon"
          style={
            allProjects || !current
              ? undefined
              : { background: projectGradient(current), color: '#fff' }
          }
        >
          {allProjects || !current ? 'QA' : current.name.trim().charAt(0).toUpperCase()}
        </div>
        <div className="ps-name">
          {allProjects ? 'All projects' : (current?.name ?? 'No workspace')}
        </div>
        <span className="ps-chev">▾</span>
      </button>

      {open && (
        <div className="tb-menu left" style={{ width: 280, marginLeft: 8 }}>
          <p className="tb-menu-label">Switch workspace</p>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            {projects.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button
                  type="button"
                  className={cn('tb-menu-item', !allProjects && p.id === current?.id && 'on')}
                  onClick={() => {
                    onSwitch(p.id);
                    setOpen(false);
                  }}
                >
                  <span style={{ width: 12 }}>
                    {!allProjects && p.id === current?.id ? '✓' : ''}
                  </span>
                  <span className="grow">{p.name}</span>
                </button>
                {projects.length > 1 && (
                  <button
                    type="button"
                    title="Delete workspace"
                    className="tb-menu-item danger"
                    style={{ width: 'auto', padding: '7px 8px' }}
                    onClick={() => {
                      if (
                        confirm(
                          `Permanently delete workspace "${p.name}" and ALL its data?\n\nThis cannot be undone.`,
                        )
                      ) {
                        onDelete(p.id);
                        setOpen(false);
                      }
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <hr />
          <button
            type="button"
            className="tb-menu-item"
            onClick={() => {
              onShowProjects();
              setOpen(false);
            }}
          >
            <SIco name="grid" size={14} />
            <span className="grow">All projects</span>
          </button>
          {creating ? (
            <div style={{ padding: 4 }}>
              <input
                autoFocus
                className="tb-input"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setDraft('');
                  }
                }}
                onBlur={submit}
                placeholder="Workspace name…"
              />
            </div>
          ) : (
            <button
              type="button"
              className="tb-menu-item"
              style={{ color: 'var(--brand-700)' }}
              onClick={() => {
                setCreating(true);
                setDraft('');
              }}
            >
              <SIco name="plus" size={14} />
              <span className="grow">New workspace</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Theme toggle ─────────────────────────────────────────────

function ThemeToggleButton() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="tb-icon-btn"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <SIco name={isDark ? 'moon' : 'sun'} />
    </button>
  );
}

// ─── User chip with account menu ─────────────────────────────

function UserChip({
  user,
  onLogout,
  onShowProfile,
}: {
  user: SessionUser;
  onLogout: () => void;
  onShowProfile: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const display = user.name || user.username;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="user-chip"
        onClick={() => setMenuOpen(o => !o)}
        title={display}
      >
        <div className="avatar">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt={display} />
          ) : (
            initials(display)
          )}
        </div>
        <span className="uname">{display.split(/\s+/)[0]}</span>
      </button>

      {menuOpen && (
        <div className="tb-menu right" style={{ width: 230 }}>
          <button type="button" className="tb-menu-item" disabled>
            <SIco name="user" size={14} />
            <span className="grow">{user.email}</span>
          </button>
          <hr />
          <button
            type="button"
            className="tb-menu-item"
            onClick={() => {
              setMenuOpen(false);
              onShowProfile();
            }}
          >
            <SIco name="user" size={14} />
            <span className="grow">Your profile</span>
          </button>
          <hr />
          <button
            type="button"
            className="tb-menu-item danger"
            onClick={() => {
              setMenuOpen(false);
              onLogout();
            }}
          >
            <SIco name="logout" size={14} />
            <span className="grow">Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
