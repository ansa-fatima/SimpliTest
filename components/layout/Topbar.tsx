'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiTestCase, Project } from '@/types';
import { avatarColour, cn, relativeTime } from '@/lib/utils';
import { api } from '@/lib/client';
import { SessionUser } from '@/hooks/useStore';
import { useTheme } from '@/lib/theme';

interface TopbarProps {
  user: SessionUser | null;

  // Workspace switcher (kept as "project" in the DB).
  projects: Project[];
  currentProjectId: string | null;
  onSwitchProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (id: string) => void;

  onOpenCase: (apiCase: ApiTestCase, apiList: ApiTestCase[]) => void;
  onShowProfile: () => void;
  onLogout: () => void;
}

// Slim utility bar -- brand identity lives in the icon rail's logo mark, so
// this bar leads with the workspace switcher (where am I) plus quick
// actions: jump to a case, check recent activity, switch theme, manage
// account.
export function Topbar({
  user,
  projects,
  currentProjectId,
  onSwitchProject,
  onCreateProject,
  onDeleteProject,
  onOpenCase,
  onShowProfile,
  onLogout,
}: TopbarProps) {
  return (
    <header className="flex h-14 flex-shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
      <ProjectSwitcher
        projects={projects}
        current={projects.find(p => p.id === currentProjectId) ?? null}
        onSwitch={onSwitchProject}
        onCreate={onCreateProject}
        onDelete={onDeleteProject}
      />

      <CaseSearch projectId={currentProjectId} onOpenCase={onOpenCase} />

      <div className="ml-auto flex flex-shrink-0 items-center gap-2">
        <ThemeToggleButton />
        <NotificationBell projectId={currentProjectId} />
        {user && <UserChip user={user} onLogout={onLogout} onShowProfile={onShowProfile} />}
      </div>
    </header>
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

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

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
    <div ref={ref} className="relative w-full max-w-[320px]">
      <i className="ti ti-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-text-3" />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        placeholder="Search test cases…"
        className="w-full rounded-full border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-[12.5px] text-text outline-none transition-colors placeholder:text-text-3 focus:border-primary focus:bg-surface"
      />

      {open && query.trim() && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[340px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-text shadow-lg">
          {loading ? (
            <p className="px-3 py-2 text-xs text-text-3">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-3">
              No test cases match &quot;{query.trim()}&quot;
            </p>
          ) : (
            results.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onOpenCase(r, [r]);
                  setOpen(false);
                  setQuery('');
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-2"
              >
                <span className="flex-shrink-0 font-mono text-[11px] text-text-3">
                  TC-{String(r.caseNum).padStart(3, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Recent activity"
        title="Recent activity"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-border text-text-2 transition-colors hover:bg-surface-2"
      >
        <i className="ti ti-bell text-[15px]" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[300px] rounded-lg border border-border bg-surface py-1 text-text shadow-lg">
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-3">
            Recent activity
          </p>
          <div className="max-h-[320px] overflow-auto">
            {loading ? (
              <p className="px-3 py-3 text-xs text-text-3">Loading…</p>
            ) : !events || events.length === 0 ? (
              <p className="px-3 py-3 text-xs text-text-3">No recent activity</p>
            ) : (
              events.slice(0, 8).map((e, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold',
                      avatarColour(e.actor),
                    )}
                  >
                    {e.actor.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 text-[11.5px] leading-snug text-text-2">
                    <b className="font-semibold text-text">{e.actor}</b>{' '}
                    {e.kind === 'run' ? (
                      <>
                        marked <span className="font-mono text-[11px]">{e.caseLabel}</span> as{' '}
                        <span
                          className={
                            e.result === 'Passed'
                              ? 'font-semibold text-success'
                              : e.result === 'Failed'
                                ? 'font-semibold text-danger'
                                : 'font-semibold text-warning'
                          }
                        >
                          {e.result}
                        </span>{' '}
                        in {e.cycleName}
                      </>
                    ) : (
                      <>
                        logged a quick log against{' '}
                        <span className="font-medium text-text">{e.scopeName}</span>
                      </>
                    )}
                    <div className="mt-0.5 text-[10.5px] text-text-3">{relativeTime(e.ts)}</div>
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
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
}

function ProjectSwitcher({
  projects,
  current,
  onSwitch,
  onCreate,
  onDelete,
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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex max-w-[180px] cursor-pointer items-center gap-2 rounded-full border border-border bg-surface-2 py-1.5 pl-2 pr-3 text-left text-text transition-colors hover:bg-surface-3"
      >
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-primary-light text-[9px] font-bold uppercase text-primary-text">
          {workspaceInitials(current?.name)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
          {current?.name ?? 'No workspace'}
        </span>
        <svg
          className="h-3 w-3 flex-shrink-0 text-text-3"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[240px] overflow-auto rounded-lg border border-border bg-surface py-1 text-text shadow-lg">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-3">
            Switch workspace
          </p>
          <div className="max-h-[240px] overflow-auto">
            {projects.map(p => (
              <div
                key={p.id}
                className={cn(
                  'group/pr flex items-center gap-1 px-1 py-0.5',
                  p.id === current?.id && 'bg-primary-light',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSwitch(p.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
                    p.id === current?.id
                      ? 'font-semibold text-primary-text'
                      : 'text-text-2 hover:bg-surface-2',
                  )}
                >
                  <span className="w-3 text-primary-text">{p.id === current?.id ? '✓' : ''}</span>
                  <span className="flex-1 truncate text-left">{p.name}</span>
                </button>
                {projects.length > 1 && (
                  <button
                    type="button"
                    title="Delete workspace"
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
                    className="mr-1 cursor-pointer rounded p-1 text-text-3 opacity-0 transition-all hover:bg-danger-bg hover:text-danger group-hover/pr:opacity-100"
                  >
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M10 8v5M6 8v5M3 4l1 9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-9" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>

          <hr className="my-1 border-border" />

          {creating ? (
            <div className="px-2 py-1">
              <input
                autoFocus
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
                className="w-full rounded border border-primary bg-surface px-2 py-1 text-xs text-text outline-none focus:ring-2 focus:ring-primary-light"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setDraft('');
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-primary-text hover:bg-primary-light"
            >
              <span className="text-sm">+</span> New workspace
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
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-border text-text-2 transition-colors hover:bg-surface-2"
    >
      <i className={cn('ti text-[15px]', isDark ? 'ti-moon' : 'ti-sun')} />
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(o => !o)}
        className="flex flex-shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-3 text-text transition-colors hover:bg-surface-3"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={user.name || user.username}
            className="h-7 w-7 flex-shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-light text-[10.5px] font-bold text-primary-text">
            {initials(user.name || user.username)}
          </span>
        )}
        <span className="max-w-[110px] truncate text-[12.5px] font-medium">
          {user.name || user.username}
        </span>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[220px] rounded-lg border border-border bg-surface py-1 text-text shadow-lg">
          <MenuRow icon={<PersonIcon />} label={user.email} subtle />
          <hr className="my-1 border-border" />
          <MenuRow
            icon={<PersonIcon />}
            label="Your profile"
            onClick={() => {
              setMenuOpen(false);
              onShowProfile();
            }}
          />
          <MenuRow
            icon={
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  d="M8 1v6m0 0l-3-2m3 2l3-2M2 11l6 4 6-4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
            label="Keyboard shortcuts"
            comingSoon
          />
          <hr className="my-1 border-border" />
          <MenuRow
            icon={
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
            label="Sign out"
            danger
            onClick={() => {
              setMenuOpen(false);
              onLogout();
            }}
          />
        </div>
      )}
    </div>
  );
}

function PersonIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13c0-2.5 2.5-4.5 5-4.5s5 2 5 4.5" />
    </svg>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  danger,
  subtle,
  comingSoon,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  subtle?: boolean;
  comingSoon?: boolean;
}) {
  const disabled = subtle || comingSoon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={comingSoon ? 'Coming soon' : undefined}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors',
        disabled && 'cursor-default',
        subtle && 'text-text-3',
        comingSoon && !subtle && 'text-text-3',
        danger && 'text-danger hover:bg-danger-bg',
        !disabled && !danger && 'text-text-2 hover:bg-surface-2',
      )}
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {comingSoon && (
        <span className="rounded bg-surface-3 px-1.5 py-px text-[9px] font-normal uppercase tracking-wider text-text-3">
          soon
        </span>
      )}
    </button>
  );
}

// ─── tiny helpers ───────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function workspaceInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
