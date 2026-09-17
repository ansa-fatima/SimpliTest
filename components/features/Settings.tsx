'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/client';
import { GeneralTab } from './settings/GeneralTab';
import { ProjectsTab } from './settings/ProjectsTab';
import { TestConfigurationTab } from './settings/TestConfigurationTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { NotificationsTab } from './settings/NotificationsTab';

type SettingsTab = 'general' | 'projects' | 'testConfig' | 'integrations' | 'notifications';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'projects', label: 'Projects' },
  { key: 'testConfig', label: 'Test Configuration' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'notifications', label: 'Notifications' },
];

export function Settings({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string | null;
  workspaceName: string;
}) {
  const [tab, setTab] = useState<SettingsTab>('general');
  // "Settings" permission -- gates General/Projects/Test Configuration/
  // Integrations' edit affordances (SuperAdmin by default, see
  // lib/permissions.ts). Notifications is a personal preference and stays
  // editable by any member regardless of this flag.
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    api
      .get<{ canEditSettings: boolean }>(`/api/members?projectId=${workspaceId}`)
      .then(r => !cancelled && setCanEdit(r.canEditSettings))
      .catch(() => !cancelled && setCanEdit(false));
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!workspaceId) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-[13px] text-text-3">Select a workspace to view its settings.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-[900px]">
        <h1 className="text-[22px] font-semibold text-text">Settings</h1>
        <p className="mt-0.5 text-[13px] text-text-3">
          Workspace configuration for {workspaceName}.
        </p>

        <div className="mt-4 flex gap-5 border-b border-border">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'border-b-2 pb-2.5 text-[13px] font-medium transition-colors',
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-3 hover:text-text',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === 'general' && <GeneralTab workspaceId={workspaceId} canEdit={canEdit} />}
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
