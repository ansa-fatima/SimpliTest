'use client';

import { Page } from '@/types';
import { cn } from '@/lib/utils';
import { SIco, SIconName } from '@/components/layout/sts-icons';
import '@/components/features/sts-v3.css';

interface SidebarProps {
  page: Page;

  onShowProjects: () => void;

  // QA Workspace nav
  onShowDashboard: () => void;
  onShowTodo: () => void;
  onShowTestCases: () => void;
  onShowTestRunsBoard: () => void;
  onShowTestPlans: () => void;
  onShowQuickLogs: () => void;
  onShowReports: () => void;

  // Configuration nav
  onShowMembers: () => void;
  onShowSettings: () => void;
}

// Page-buckets used to decide which top-level nav item is "active".
const TESTCASE_PAGES: Page[] = ['list', 'view', 'edit'];
// The Execution screen ('cycle') and Cycle Overview always read as Test
// Runs in the sidebar, regardless of which cycle was opened. So does a single
// plan (and its New / Edit form): the mockup keeps Test runs lit there, and only
// the plan list itself lights the Test plans button.
const TESTRUNS_BOARD_PAGES: Page[] = [
  'testRuns',
  'newRun',
  'cycle',
  'cycleOverview',
  'plan',
  'newPlan',
  'editPlan',
];

// Icon-only rail from the SimpliEd mockup — "which page"; workspace identity,
// search and the account live in the Topbar.
export function Sidebar({
  page,
  onShowProjects,
  onShowDashboard,
  onShowTodo,
  onShowTestCases,
  onShowTestRunsBoard,
  onShowTestPlans,
  onShowQuickLogs,
  onShowReports,
  onShowMembers,
  onShowSettings,
}: SidebarProps) {
  return (
    <div className="stv3 stv3-host">
      <aside className="sidebar">
        {/* Hovering (or tabbing into) the rail slides it open over the page, with labels. */}
        <div className="sidebar-panel">
          <SideBtn
            active={page === 'projects'}
            onClick={onShowProjects}
            icon="briefcase"
            label="Projects"
          />
          <SideBtn
            active={page === 'dashboard'}
            onClick={onShowDashboard}
            icon="overview"
            label="Overview"
          />
          <SideBtn active={page === 'todo'} onClick={onShowTodo} icon="todo" label="My to-do" />
          <SideBtn
            active={TESTCASE_PAGES.includes(page)}
            onClick={onShowTestCases}
            icon="file"
            label="Test cases"
          />
          <SideBtn
            active={TESTRUNS_BOARD_PAGES.includes(page)}
            onClick={onShowTestRunsBoard}
            icon="play"
            label="Test runs"
          />
          <SideBtn
            active={page === 'testPlans'}
            onClick={onShowTestPlans}
            icon="flag"
            label="Test plans"
          />
          <SideBtn
            active={page === 'quickLogs'}
            onClick={onShowQuickLogs}
            icon="zap"
            label="Quick logs"
          />
          <SideBtn
            active={page === 'reports'}
            onClick={onShowReports}
            icon="chart"
            label="Reports"
          />

          <div className="side-divider" />

          <SideBtn
            active={page === 'members' || page === 'roles'}
            onClick={onShowMembers}
            icon="users"
            label="Teams"
          />
          <SideBtn
            active={page === 'settings'}
            onClick={onShowSettings}
            icon="settings"
            label="Settings"
          />
        </div>
      </aside>
    </div>
  );
}

function SideBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: SIconName;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('side-btn', active && 'active')}
    >
      <SIco name={icon} />
      <span className="side-label">{label}</span>
    </button>
  );
}
