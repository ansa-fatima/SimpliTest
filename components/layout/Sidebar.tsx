'use client';

import { useState } from 'react';
import { Module, Page } from '@/types';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/Logo';
import { SessionUser } from '@/hooks/useStore';

interface SidebarProps {
  modules: Module[];
  currentKey: string;
  page: Page;
  user: SessionUser | null;
  onNavigate: (mod: string, feat: string) => void;
  onAddModule: (name: string) => void;
  onAddFeature: (modName: string, featName: string) => void;
  onDeleteModule: (modName: string) => void;
  onDeleteFeature: (modName: string, featName: string) => void;
  onShowDashboard: () => void;
  onShowTestRuns: () => void;
  onShowTestCases: () => void;
  onLogout: () => void;
}

const TESTCASE_PAGES: Page[] = ['list', 'view', 'edit', 'create'];
const TESTRUN_PAGES: Page[] = ['cycles', 'cycle'];

export function Sidebar({
  modules,
  currentKey,
  page,
  user,
  onNavigate,
  onAddModule,
  onAddFeature,
  onDeleteModule,
  onDeleteFeature,
  onShowDashboard,
  onShowTestRuns,
  onShowTestCases,
  onLogout,
}: SidebarProps) {
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({
    Authentication: true,
    Dashboard: true,
    'User Management': false,
  });
  const [addingFeatureFor, setAddingFeatureFor] = useState<string | null>(null);
  const [addingModule, setAddingModule] = useState(false);
  const [draftName, setDraftName] = useState('');

  const toggle = (name: string) => setOpenModules(s => ({ ...s, [name]: !s[name] }));

  const [currentMod, currentFeat] = currentKey.split(':');
  const onTestCases = TESTCASE_PAGES.includes(page);
  const onTestRuns = TESTRUN_PAGES.includes(page);
  const onDashboard = page === 'dashboard';

  const startAddFeature = (modName: string) => {
    setOpenModules(s => ({ ...s, [modName]: true }));
    setAddingFeatureFor(modName);
    setDraftName('');
  };

  const submitFeature = () => {
    if (addingFeatureFor && draftName.trim()) {
      onAddFeature(addingFeatureFor, draftName);
    }
    setAddingFeatureFor(null);
    setDraftName('');
  };

  const submitModule = () => {
    if (draftName.trim()) onAddModule(draftName);
    setAddingModule(false);
    setDraftName('');
  };

  return (
    <aside className="flex w-[220px] min-w-[220px] flex-col border-r border-slate-200 bg-white">
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3.5">
        <Logo size={28} />
        <span className="text-[15px] font-semibold text-slate-900">SimpliTest</span>
      </div>

      {/* Top nav */}
      <div className="flex flex-col py-2">
        <NavItem
          active={onDashboard}
          onClick={onShowDashboard}
          icon={
            <svg
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x="2" y="2" width="5.5" height="5.5" rx="1" />
              <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" />
              <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" />
              <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
            </svg>
          }
          label="Dashboard"
        />
        <NavItem
          active={onTestRuns}
          onClick={onShowTestRuns}
          icon={
            <svg
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path d="M5 3l7 5-7 5V3z" fill="currentColor" stroke="none" />
            </svg>
          }
          label="Test Runs"
        />
        <NavItem
          active={onTestCases}
          onClick={onShowTestCases}
          icon={
            <svg
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <line x1="3" y1="4" x2="13" y2="4" />
              <line x1="3" y1="8" x2="13" y2="8" />
              <line x1="3" y1="12" x2="13" y2="12" />
            </svg>
          }
          label="Test Cases"
        />
      </div>

      {/* Folders tree — only on Test Cases pages */}
      {onTestCases && (
        <>
          <div className="mt-1 border-t border-slate-100" />
          <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Folders
          </div>

          <nav className="flex-1 overflow-y-auto py-1">
            {modules.map(mod => (
              <div key={mod.name} className="group/mod">
                <div className="flex items-center hover:bg-slate-50">
                  <button
                    onClick={() => toggle(mod.name)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors"
                  >
                    <span
                      className={cn(
                        'inline-block w-2.5 text-[8px] text-slate-400 transition-transform duration-150',
                        openModules[mod.name] && 'rotate-90',
                      )}
                    >
                      ▶
                    </span>
                    <FolderIcon />
                    <span className="flex-1 truncate text-left">{mod.name}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] text-slate-400">
                      {mod.features.length}
                    </span>
                  </button>
                  <div className="mr-1.5 flex items-center opacity-0 transition-opacity group-hover/mod:opacity-100">
                    <button
                      title="Add sub-folder"
                      onClick={() => startAddFeature(mod.name)}
                      className="cursor-pointer rounded px-1.5 text-[14px] leading-none text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                    >
                      +
                    </button>
                    <button
                      title="Delete folder"
                      onClick={() => {
                        const subCount = mod.features.length;
                        const msg =
                          subCount > 0
                            ? `Delete "${mod.name}" and its ${subCount} sub-folder${subCount === 1 ? '' : 's'}?`
                            : `Delete "${mod.name}"?`;
                        if (confirm(msg)) onDeleteModule(mod.name);
                      }}
                      className="cursor-pointer rounded px-1.5 py-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>

                {openModules[mod.name] && (
                  <div>
                    {mod.features.map(feat => {
                      const active = currentMod === mod.name && currentFeat === feat;
                      return (
                        <div
                          key={feat}
                          className={cn(
                            'group/feat relative flex w-full items-center transition-colors',
                            active ? 'bg-indigo-50' : 'hover:bg-slate-50',
                          )}
                        >
                          <button
                            onClick={() => onNavigate(mod.name, feat)}
                            className={cn(
                              'flex flex-1 items-center gap-2 px-3 py-1 pl-7 text-xs',
                              active ? 'font-semibold text-blue-600' : 'text-slate-500',
                            )}
                          >
                            <span
                              className={cn(
                                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                                active ? 'bg-blue-600' : 'bg-slate-300',
                              )}
                            />
                            <span className="flex-1 truncate text-left">{feat}</span>
                          </button>
                          <button
                            title="Delete folder"
                            onClick={() => {
                              if (confirm(`Delete sub-folder "${feat}"?`))
                                onDeleteFeature(mod.name, feat);
                            }}
                            className="mr-1.5 cursor-pointer rounded px-1.5 py-1 text-slate-400 opacity-0 transition-colors hover:bg-red-50 hover:text-red-600 group-hover/feat:opacity-100"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      );
                    })}

                    {addingFeatureFor === mod.name && (
                      <div className="flex items-center gap-2 px-3 py-1 pl-7">
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
                        <input
                          autoFocus
                          value={draftName}
                          onChange={e => setDraftName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') submitFeature();
                            if (e.key === 'Escape') {
                              setAddingFeatureFor(null);
                              setDraftName('');
                            }
                          }}
                          onBlur={submitFeature}
                          placeholder="Folder name…"
                          className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="border-t border-slate-200 px-3 py-3">
            {addingModule ? (
              <input
                autoFocus
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitModule();
                  if (e.key === 'Escape') {
                    setAddingModule(false);
                    setDraftName('');
                  }
                }}
                onBlur={submitModule}
                placeholder="Folder name…"
                className="w-full rounded-lg border border-blue-400 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-100"
              />
            ) : (
              <button
                onClick={() => {
                  setAddingModule(true);
                  setDraftName('');
                }}
                className="w-full cursor-pointer rounded-lg border border-dashed border-slate-300 py-1.5 text-xs text-slate-400 transition-all hover:border-blue-400 hover:bg-slate-50 hover:text-blue-500"
              >
                + New folder
              </button>
            )}
          </div>
        </>
      )}

      {/* Filler when folders aren't shown */}
      {!onTestCases && <div className="flex-1" />}

      {/* Account block — always visible at the very bottom */}
      {user && (
        <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700">
            {(user.name || user.username).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-slate-800">
              {user.name || user.username}
            </p>
            <p className="truncate text-[10px] text-slate-400">{user.email}</p>
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="cursor-pointer rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
              <path d="M11 11l3-3-3-3M14 8H6" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}

function NavItem({
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
      onClick={onClick}
      className={cn(
        'mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
        active
          ? 'bg-indigo-50 font-semibold text-blue-700'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      <span className={cn('flex-shrink-0', active ? 'text-blue-600' : 'text-slate-400')}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function FolderIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-shrink-0 text-slate-500"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M2 4a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M10 8v5M6 8v5M3 4l1 9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-9" />
    </svg>
  );
}
