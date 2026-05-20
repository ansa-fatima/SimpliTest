'use client';

import { useEffect, useRef, useState } from 'react';
import { Page, Project } from '@/types';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/Logo';
import { SessionUser } from '@/hooks/useStore';
import { api } from '@/lib/client';

interface SidebarProps {
  page: Page;
  user: SessionUser | null;

  // Workspace switcher (kept as "project" in the DB).
  projects: Project[];
  currentProjectId: string | null;
  onSwitchProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (id: string) => void;

  // QA Workspace nav
  onShowDashboard: () => void;
  onShowTestCases: () => void;
  onShowTestRuns: () => void;
  onShowPlans: () => void;
  onShowReports: () => void;

  // Configuration nav
  onShowPlatforms: () => void;
  onShowMembers: () => void;
  onShowSettings: () => void;

  onLogout: () => void;
}

// Page-buckets used to decide which top-level nav item is "active".
const TESTCASE_PAGES: Page[] = ['list', 'view', 'edit', 'create'];
const TESTRUN_PAGES: Page[] = ['cycles', 'cycle'];

export function Sidebar({
  page,
  user,
  projects,
  currentProjectId,
  onSwitchProject,
  onCreateProject,
  onDeleteProject,
  onShowDashboard,
  onShowTestCases,
  onShowTestRuns,
  onShowPlans,
  onShowReports,
  onShowPlatforms,
  onShowMembers,
  onShowSettings,
  onLogout,
}: SidebarProps) {
  const onDashboard = page === 'dashboard';
  const onTestCases = TESTCASE_PAGES.includes(page);
  const onTestRuns = TESTRUN_PAGES.includes(page);
  const onPlans = page === 'plans';
  const onReports = page === 'reports';
  const onPlatforms = page === 'platforms';
  const onMembers = page === 'members';
  const onSettings = page === 'settings';

  // Counts shown next to nav items. Refetched when the active project changes.
  const [counts, setCounts] = useState<{ cases: number; runs: number }>({ cases: 0, runs: 0 });
  useEffect(() => {
    if (!currentProjectId) {
      setCounts({ cases: 0, runs: 0 });
      return;
    }
    (async () => {
      try {
        const [tc, rc] = await Promise.all([
          api.get<{ total: number }>(`/api/test-cases?projectId=${currentProjectId}&pageSize=1`),
          api.get<{ id: string; status: string }[]>(`/api/cycles?projectId=${currentProjectId}`),
        ]);
        const activeRuns = Array.isArray(rc) ? rc.filter(c => c.status === 'Active').length : 0;
        setCounts({ cases: tc.total ?? 0, runs: activeRuns });
      } catch (e) {
        console.error('[sidebar counts]', e);
      }
    })();
  }, [currentProjectId, page]);

  return (
    <aside className="flex w-[224px] min-w-[224px] flex-col border-r border-slate-200 bg-white">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Logo size={28} />
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">Simplitest</span>
      </div>

      {/* Workspace switcher */}
      <div className="px-3 pb-2">
        <ProjectSwitcher
          projects={projects}
          current={projects.find(p => p.id === currentProjectId) ?? null}
          onSwitch={onSwitchProject}
          onCreate={onCreateProject}
          onDelete={onDeleteProject}
        />
      </div>

      {/* QA WORKSPACE */}
      <SectionLabel>QA Workspace</SectionLabel>
      <div className="flex flex-col gap-0.5 px-2">
        <NavItem
          active={onDashboard}
          onClick={onShowDashboard}
          icon={<DashboardIcon />}
          label="Dashboard"
        />
        <NavItem
          active={onTestCases}
          onClick={onShowTestCases}
          icon={<TestCasesIcon />}
          label="Test cases"
          badge={counts.cases > 0 ? formatNumber(counts.cases) : undefined}
        />
        <NavItem
          active={onTestRuns}
          onClick={onShowTestRuns}
          icon={<PlayIcon />}
          label="Test runs"
          badge={counts.runs > 0 ? String(counts.runs) : undefined}
        />
        <NavItem
          active={onPlans}
          onClick={onShowPlans}
          icon={<ClipboardIcon />}
          label="Test plans"
        />
        <NavItem active={onReports} onClick={onShowReports} icon={<ChartIcon />} label="Reports" />
      </div>

      {/* CONFIGURATION */}
      <SectionLabel>Configuration</SectionLabel>
      <div className="flex flex-col gap-0.5 px-2">
        <NavItem
          active={onPlatforms}
          onClick={onShowPlatforms}
          icon={<LayersIcon />}
          label="Platforms"
        />
        <NavItem active={onMembers} onClick={onShowMembers} icon={<PeopleIcon />} label="Members" />
        <NavItem active={onSettings} onClick={onShowSettings} icon={<CogIcon />} label="Settings" />
      </div>

      {/* spacer */}
      <div className="flex-1" />

      {/* Account block */}
      {user && <AccountBlock user={user} onLogout={onLogout} />}

      {/* Light mode toggle (visual stub — dark mode not implemented yet) */}
      <div className="px-3 pb-3 pt-1">
        <LightModeToggle />
      </div>
    </aside>
  );
}

// ─── Section label ───────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
      {children}
    </div>
  );
}

// ─── NavItem ────────────────────────────────────────────────

function NavItem({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-[13px] transition-colors',
        active
          ? 'bg-white font-medium text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 flex-shrink-0 items-center justify-center',
          active ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-700',
        )}
      >
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && (
        <span
          className={cn(
            'rounded text-[11px] tabular-nums',
            active ? 'text-slate-400' : 'text-slate-400',
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Account block with overflow menu ────────────────────────

function AccountBlock({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
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
    <div ref={ref} className="relative mt-2 border-t border-slate-200 px-3 pt-3">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-[11px] font-semibold text-rose-700">
          {initials(user.name || user.username)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-slate-900">
            {user.name || user.username}
          </p>
          <p className="truncate text-[11px] text-slate-500">{roleLabel(user.role)}</p>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(o => !o)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="Account menu"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="4" cy="8" r="1.25" />
            <circle cx="8" cy="8" r="1.25" />
            <circle cx="12" cy="8" r="1.25" />
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div className="absolute bottom-[calc(100%-6px)] left-3 right-3 z-30 rounded-lg border border-slate-200 bg-white py-1 shadow-[0_4px_24px_-4px_rgba(28,25,23,0.16)]">
          <MenuRow
            icon={
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
            }
            label={user.email}
            subtle
          />
          <hr className="my-1 border-slate-100" />
          <MenuRow
            icon={
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <circle cx="8" cy="8" r="2.5" />
                <path
                  d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1"
                  strokeLinecap="round"
                />
              </svg>
            }
            label="Account settings"
            comingSoon
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
          <hr className="my-1 border-slate-100" />
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
        subtle && 'text-slate-400',
        comingSoon && !subtle && 'text-slate-400',
        danger && 'text-red-600 hover:bg-red-50',
        !disabled && !danger && 'text-slate-700 hover:bg-slate-50',
      )}
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {comingSoon && (
        <span className="rounded bg-slate-100 px-1.5 py-px text-[9px] font-normal uppercase tracking-wider text-slate-400">
          soon
        </span>
      )}
    </button>
  );
}

// ─── Light mode toggle ──────────────────────────────────────

function LightModeToggle() {
  // Visual-only for now — dark theme will be wired alongside the theme provider work.
  return (
    <button
      type="button"
      disabled
      title="Dark mode coming soon"
      className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white py-1.5 text-[12px] font-medium text-slate-700 opacity-90 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <svg
        className="h-3.5 w-3.5 text-amber-500"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
      >
        <circle cx="8" cy="8" r="2.6" />
        <path
          d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1"
          strokeLinecap="round"
        />
      </svg>
      Light mode
    </button>
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
        className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left transition-colors hover:bg-slate-50"
      >
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-indigo-100 text-[9px] font-bold uppercase text-indigo-700">
          {workspaceInitials(current?.name)}
        </span>
        <span className="flex-1 truncate text-[12.5px] font-semibold text-slate-800">
          {current?.name ?? 'No workspace'}
        </span>
        <svg
          className="h-3 w-3 text-slate-400"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[280px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Switch workspace
          </p>
          {projects.map(p => (
            <div
              key={p.id}
              className={cn(
                'group/pr flex items-center gap-1 px-1 py-0.5',
                p.id === current?.id && 'bg-indigo-50',
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
                    ? 'font-semibold text-blue-700'
                    : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="w-3 text-blue-600">{p.id === current?.id ? '✓' : ''}</span>
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
                  className="mr-1 cursor-pointer rounded p-1 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover/pr:opacity-100"
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

          <hr className="my-1 border-slate-100" />

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
                className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setDraft('');
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50"
            >
              <span className="text-sm">+</span> New workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────

function DashboardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2" y="2" width="5.5" height="5.5" rx="1" />
      <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" />
      <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
    </svg>
  );
}

function TestCasesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2.5" y="2" width="11" height="12" rx="1.5" />
      <line x1="5" y1="5.5" x2="11" y2="5.5" strokeLinecap="round" />
      <line x1="5" y1="8" x2="11" y2="8" strokeLinecap="round" />
      <line x1="5" y1="10.5" x2="9" y2="10.5" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M5 3l7 5-7 5V3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="10" height="11" rx="1.5" />
      <rect x="5.5" y="1.5" width="5" height="2.5" rx="0.5" />
      <line x1="5.5" y1="7" x2="10.5" y2="7" strokeLinecap="round" />
      <line x1="5.5" y1="10" x2="9" y2="10" strokeLinecap="round" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M3 13V6M7 13V3M11 13V8" strokeLinecap="round" />
      <line x1="2" y1="13.5" x2="14" y2="13.5" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M8 1.5L1.5 5 8 8.5 14.5 5 8 1.5z" strokeLinejoin="round" />
      <path d="M1.5 8.5L8 12 14.5 8.5" strokeLinejoin="round" />
      <path d="M1.5 11.5L8 15 14.5 11.5" strokeLinejoin="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="11.5" cy="6.5" r="1.8" />
      <path d="M2 13c0-2 2-3.5 4-3.5s4 1.5 4 3.5M10 13c0-1.5 1.5-2.6 3-2.6" />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="8" cy="8" r="2" />
      <path
        d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
        strokeLinecap="round"
      />
    </svg>
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

function roleLabel(role: string): string {
  switch (role) {
    case 'SuperAdmin':
      return 'Super Admin';
    case 'QAManager':
      return 'QA Manager';
    default:
      return role;
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
