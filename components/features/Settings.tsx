'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/client';
import { SIco, SIconName } from '@/components/layout/sts-icons';
import { GeneralTab } from './settings/GeneralTab';
import { ProjectsTab } from './settings/ProjectsTab';
import { TestConfigurationTab } from './settings/TestConfigurationTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { NotificationsTab } from './settings/NotificationsTab';
import './sts-v3.css';

type SettingsTab = 'general' | 'projects' | 'testConfig' | 'integrations' | 'notifications';

const TABS: { key: SettingsTab; label: string; icon: SIconName }[] = [
  { key: 'general', label: 'General', icon: 'settings' },
  { key: 'projects', label: 'Projects', icon: 'briefcase' },
  { key: 'testConfig', label: 'Test configuration', icon: 'calendar-check' },
  { key: 'integrations', label: 'Integrations', icon: 'globe' },
  { key: 'notifications', label: 'Notifications', icon: 'bell' },
];

// Screen 19 — settings as a left tab rail + content column. The tab bodies
// other than General keep their own layouts; they now sit in the new shell.
export function Settings({
  workspaceId,
  workspaceName,
  projectCount = 1,
  onDeleteProject,
  onProjectSaved,
  onOpenRoles,
}: {
  workspaceId: string | null;
  workspaceName: string;
  projectCount?: number;
  onDeleteProject: (id: string) => void | Promise<void>;
  onProjectSaved?: () => void;
  onOpenRoles?: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>('general');
  // "Settings" permission -- gates General/Projects/Test Configuration/
  // Integrations' edit affordances (SuperAdmin by default, see
  // lib/permissions.ts). Notifications is a personal preference and stays
  // editable by any member regardless of this flag.
  const [canEdit, setCanEdit] = useState(false);
  // Deleting a workspace is owner-only (SuperAdmin), stricter than "Settings".
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    api
      .get<{ canEditSettings: boolean; myRole?: string }>(`/api/members?projectId=${workspaceId}`)
      .then(r => {
        if (cancelled) return;
        setCanEdit(r.canEditSettings);
        setIsOwner(r.myRole === 'SuperAdmin');
      })
      .catch(() => {
        if (cancelled) return;
        setCanEdit(false);
        setIsOwner(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!workspaceId) {
    return (
      <div className="stv3 main-scroll">
        <div className="empty-note">Select a workspace to view its settings.</div>
      </div>
    );
  }

  const goDanger = () => {
    setTab('general');
    setTimeout(
      () =>
        document
          .getElementById('danger-zone')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      80,
    );
  };

  return (
    <div className="stv3 main-scroll">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <span className="crumb">{workspaceName || 'Workspace'}</span>
            <span className="sep">/</span>
            <span className="current">Settings</span>
          </div>
          <h1 className="page-title compact">Project settings</h1>
          <div className="page-sub">
            Manage workspace metadata, modules, configuration and integrations
          </div>
        </div>
      </div>

      <div className="settings-layout">
        <div className="card" style={{ height: 'fit-content' }}>
          <div className="side-tabs">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                className={cn('side-tab', tab === t.key && 'active')}
                onClick={() => setTab(t.key)}
              >
                <SIco name={t.icon} /> {t.label}
              </button>
            ))}
            {onOpenRoles && (
              <button type="button" className="side-tab" onClick={onOpenRoles}>
                <SIco name="shield" /> Roles &amp; permissions
              </button>
            )}
            <div style={{ height: 1, background: 'var(--bdr)', margin: '8px 0' }} />
            <button
              type="button"
              className="side-tab"
              style={{ color: 'var(--err)' }}
              onClick={goDanger}
            >
              <SIco name="alert" /> Danger zone
            </button>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          {tab === 'general' && (
            <GeneralTab
              workspaceId={workspaceId}
              canEdit={canEdit}
              canDelete={projectCount > 1}
              isOwner={isOwner}
              onDeleteProject={onDeleteProject}
              onSaved={onProjectSaved}
              onManageModules={() => setTab('projects')}
            />
          )}
          {tab === 'projects' && <ProjectsTab workspaceId={workspaceId} canEdit={canEdit} />}
          {tab === 'testConfig' && (
            <TestConfigurationTab workspaceId={workspaceId} canEdit={canEdit} />
          )}
          {tab === 'integrations' && (
            <IntegrationsTab workspaceId={workspaceId} canEdit={canEdit} />
          )}
          {tab === 'notifications' && <NotificationsTab workspaceId={workspaceId} />}
        </div>
      </div>
    </div>
  );
}
