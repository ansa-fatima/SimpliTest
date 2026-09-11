'use client';

import { Page } from '@/types';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/Logo';

interface SidebarProps {
  page: Page;

  // QA Workspace nav
  onShowDashboard: () => void;
  onShowTestCases: () => void;
  onShowTestRunsBoard: () => void;
  onShowTestRuns: () => void;
  onShowPlans: () => void;
  onShowReports: () => void;

  // Configuration nav
  onShowPlatforms: () => void;
  onShowMembers: () => void;
  onShowSettings: () => void;
}

// Page-buckets used to decide which top-level nav item is "active".
const TESTCASE_PAGES: Page[] = ['list', 'view', 'edit'];
const TESTRUNS_BOARD_PAGES: Page[] = ['testRuns'];
const TESTRUN_PAGES: Page[] = ['cycles', 'cycleOverview', 'cycle'];

// Slim icon-only rail -- everything workspace-identity-related (which
// project, who's signed in, theme) now lives in the Topbar above; this rail
// is purely "which page", same split as the reference layout.
export function Sidebar({
  page,
  onShowDashboard,
  onShowTestCases,
  onShowTestRunsBoard,
  onShowTestRuns,
  onShowPlans,
  onShowReports,
  onShowPlatforms,
  onShowMembers,
  onShowSettings,
}: SidebarProps) {
  const onDashboard = page === 'dashboard';
  const onTestCases = TESTCASE_PAGES.includes(page);
  const onTestRunsBoard = TESTRUNS_BOARD_PAGES.includes(page);
  const onTestRuns = TESTRUN_PAGES.includes(page);
  const onPlans = page === 'plans';
  const onReports = page === 'reports';
  const onPlatforms = page === 'platforms';
  const onMembers = page === 'members';
  const onSettings = page === 'settings';

  return (
    <aside className="flex w-[72px] min-w-[72px] flex-col items-center gap-1 border-r border-border bg-surface py-3">
      <button
        type="button"
        onClick={onShowDashboard}
        title="Simplitest"
        aria-label="Simplitest — go to Dashboard"
        className="mb-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] bg-primary-light transition-colors hover:bg-primary/20"
      >
        <Logo size={24} />
      </button>
      <div className="mb-1.5 h-px w-8 flex-shrink-0 bg-border" />

      <IconNavItem
        active={onDashboard}
        onClick={onShowDashboard}
        icon={<DashboardIcon />}
        label="Dashboard"
      />
      <IconNavItem
        active={onTestCases}
        onClick={onShowTestCases}
        icon={<TestCasesIcon />}
        label="Test cases"
      />
      <IconNavItem
        active={onTestRunsBoard}
        onClick={onShowTestRunsBoard}
        icon={<PlayIcon />}
        label="Test Runs"
      />
      <IconNavItem
        active={onTestRuns}
        onClick={onShowTestRuns}
        icon={<TableIcon />}
        label="Test Cycles"
      />
      <IconNavItem
        active={onPlans}
        onClick={onShowPlans}
        icon={<ClipboardIcon />}
        label="Test plans"
      />
      <IconNavItem
        active={onReports}
        onClick={onShowReports}
        icon={<ChartIcon />}
        label="Reports"
      />

      <div className="my-1.5 h-px w-8 flex-shrink-0 bg-border" />

      <IconNavItem
        active={onPlatforms}
        onClick={onShowPlatforms}
        icon={<LayersIcon />}
        label="Platforms"
      />
      <IconNavItem
        active={onMembers}
        onClick={onShowMembers}
        icon={<PeopleIcon />}
        label="Members"
      />
      <IconNavItem
        active={onSettings}
        onClick={onShowSettings}
        icon={<CogIcon />}
        label="Settings"
      />
    </aside>
  );
}

// ─── Icon nav item ────────────────────────────────────────────

function IconNavItem({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'group relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] transition-colors',
        active
          ? 'bg-primary-light text-primary-text'
          : 'text-text-3 hover:bg-surface-2 hover:text-text',
      )}
    >
      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-[3px] bg-primary" />}
      <span className="flex h-[18px] w-[18px] items-center justify-center">{icon}</span>
    </button>
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

function TableIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" />
      <line x1="6" y1="6.5" x2="6" y2="13" />
      <line x1="10" y1="6.5" x2="10" y2="13" />
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
