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
  onShowDashboard: () => void;
  onShowTestRuns: () => void;
  onShowTestCases: () => void;
  onLogout: () => void;
}

const TESTCASE_PAGES: Page[] = ['list', 'view', 'edit', 'create'];
const TESTRUN_PAGES: Page[] = ['cycles', 'cycle'];

export function Sidebar({
  modules, currentKey, page, user,
  onNavigate, onAddModule, onAddFeature,
  onShowDashboard, onShowTestRuns, onShowTestCases, onLogout,
}: SidebarProps) {
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({
    Authentication: true,
    Dashboard: true,
    'User Management': false,
  });
  const [addingFeatureFor, setAddingFeatureFor] = useState<string | null>(null);
  const [addingModule, setAddingModule] = useState(false);
  const [draftName, setDraftName] = useState('');

  const toggle = (name: string) =>
    setOpenModules(s => ({ ...s, [name]: !s[name] }));

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
    <aside className="w-[220px] min-w-[220px] bg-white border-r border-slate-200 flex flex-col">
      {/* Logo */}
      <div className="px-4 py-3.5 border-b border-slate-200 flex items-center gap-2.5">
        <Logo size={28} />
        <span className="text-[15px] font-semibold text-slate-900">SimpliTest</span>
      </div>

      {/* Top nav */}
      <div className="py-2 flex flex-col">
        <NavItem
          active={onDashboard}
          onClick={onShowDashboard}
          icon={
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
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
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M5 3l7 5-7 5V3z" fill="currentColor" stroke="none" />
            </svg>
          }
          label="Test Runs"
        />
        <NavItem
          active={onTestCases}
          onClick={onShowTestCases}
          icon={
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <line x1="3" y1="4" x2="13" y2="4" /><line x1="3" y1="8" x2="13" y2="8" /><line x1="3" y1="12" x2="13" y2="12" />
            </svg>
          }
          label="Test Cases"
        />
      </div>

      {/* Folders tree — only on Test Cases pages */}
      {onTestCases && (
        <>
          <div className="border-t border-slate-100 mt-1" />
          <div className="px-4 pt-3 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
            Folders
          </div>

          <nav className="flex-1 overflow-y-auto py-1">
            {modules.map(mod => (
              <div key={mod.name} className="group/mod">
                <div className="flex items-center hover:bg-slate-50">
                  <button
                    onClick={() => toggle(mod.name)}
                    className="flex-1 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors min-w-0"
                  >
                    <span
                      className={cn(
                        'text-[8px] text-slate-400 transition-transform duration-150 inline-block w-2.5',
                        openModules[mod.name] && 'rotate-90'
                      )}
                    >
                      ▶
                    </span>
                    <FolderIcon />
                    <span className="flex-1 text-left truncate">{mod.name}</span>
                    <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-px">
                      {mod.features.length}
                    </span>
                  </button>
                  <button
                    title="Add folder"
                    onClick={() => startAddFeature(mod.name)}
                    className="opacity-0 group-hover/mod:opacity-100 mr-1.5 px-1.5 text-[14px] leading-none text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer transition-all"
                  >
                    +
                  </button>
                </div>

                {openModules[mod.name] && (
                  <div>
                    {mod.features.map(feat => {
                      const active = currentMod === mod.name && currentFeat === feat;
                      return (
                        <button
                          key={feat}
                          onClick={() => onNavigate(mod.name, feat)}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-1 pl-7 text-xs transition-colors',
                            active
                              ? 'bg-indigo-50 text-blue-600 font-semibold'
                              : 'text-slate-500 hover:bg-slate-50'
                          )}
                        >
                          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', active ? 'bg-blue-600' : 'bg-slate-300')} />
                          <span className="flex-1 text-left truncate">{feat}</span>
                        </button>
                      );
                    })}

                    {addingFeatureFor === mod.name && (
                      <div className="flex items-center gap-2 px-3 py-1 pl-7">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                        <input
                          autoFocus
                          value={draftName}
                          onChange={e => setDraftName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') submitFeature();
                            if (e.key === 'Escape') { setAddingFeatureFor(null); setDraftName(''); }
                          }}
                          onBlur={submitFeature}
                          placeholder="Folder name…"
                          className="flex-1 min-w-0 px-1.5 py-0.5 border border-blue-400 rounded text-xs bg-white text-slate-900 outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="px-3 py-3 border-t border-slate-200">
            {addingModule ? (
              <input
                autoFocus
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitModule();
                  if (e.key === 'Escape') { setAddingModule(false); setDraftName(''); }
                }}
                onBlur={submitModule}
                placeholder="Folder name…"
                className="w-full px-2.5 py-1.5 border border-blue-400 rounded-lg text-xs bg-white text-slate-900 outline-none focus:ring-2 focus:ring-blue-100"
              />
            ) : (
              <button
                onClick={() => { setAddingModule(true); setDraftName(''); }}
                className="w-full py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-400 hover:bg-slate-50 hover:border-blue-400 hover:text-blue-500 transition-all cursor-pointer"
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
        <div className="px-3 py-3 border-t border-slate-200 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center justify-center flex-shrink-0">
            {(user.name || user.username).charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-slate-800 truncate">{user.name || user.username}</p>
            <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
              <path d="M11 11l3-3-3-3M14 8H6" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'mx-2 px-2 py-2 rounded-lg flex items-center gap-2.5 text-sm transition-colors',
        active
          ? 'bg-indigo-50 text-blue-700 font-semibold'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      )}
    >
      <span className={cn('flex-shrink-0', active ? 'text-blue-600' : 'text-slate-400')}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function FolderIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M2 4a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" />
    </svg>
  );
}
