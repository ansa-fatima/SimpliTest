'use client';

import { useStore } from '@/hooks/useStore';
import { Sidebar } from '@/components/layout/Sidebar';
import { LoginPage } from '@/components/features/LoginPage';
import { TestCaseList } from '@/components/features/TestCaseList';
import { TestCaseView } from '@/components/features/TestCaseView';
import { TestCaseEdit } from '@/components/features/TestCaseEdit';
import { TestCaseCreate } from '@/components/features/TestCaseCreate';
import { CyclesList } from '@/components/features/CyclesList';
import { CycleView } from '@/components/features/CycleView';
import { Dashboard } from '@/components/features/Dashboard';
import { Reports } from '@/components/features/Reports';
import { Members } from '@/components/features/Members';
import { ComingSoon } from '@/components/features/ComingSoon';
import { WorkspaceOnboarding } from '@/components/features/WorkspaceOnboarding';
import { Toast } from '@/components/ui/Toast';

export default function Home() {
  const {
    state,
    currentCases,
    login,
    logout,
    navFeature,
    viewTC,
    showEdit,
    showCreate,
    cancelCreate,
    saveEdit,
    deleteTC,
    duplicateTC,
    createTC,
    addModule,
    addFeature,
    deleteModule,
    deleteFeature,
    showDashboard,
    showTestCases,
    showCycles,
    openCycle,
    backToCycles,
    createCycle,
    archiveCycle,
    deleteCycle,
    submitResult,
    switchProject,
    createProject,
    deleteProject,
    switchPortal,
    addPortal,
    deletePortal,
    closeCycle,
    showReports,
    showMembers,
    showPlans,
    showPlatforms,
    showSettings,
    reloadProjects,
    reloadPortals,
  } = useStore();

  const {
    page,
    currentKey,
    currentTC,
    toast,
    modules,
    user,
    authChecked,
    projects,
    currentProjectId,
    portals,
    currentPortalId,
    cycles,
    currentCycle,
    runs,
    summary,
    cyclesLoading,
    runsLoading,
  } = state;

  // Show a tiny loading state while we check the session on mount.
  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  // Onboarding: signed-in user has no workspaces yet → create-or-join screen.
  if (user && authChecked && page !== 'login' && projects.length === 0) {
    return (
      <WorkspaceOnboarding
        userName={user.name || user.username}
        onCreated={async () => {
          const list = await reloadProjects();
          const first = list[0]?.id ?? null;
          if (first) await reloadPortals(first);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar — hidden on login */}
      {page !== 'login' && (
        <Sidebar
          page={page}
          user={user}
          projects={projects}
          currentProjectId={currentProjectId}
          onSwitchProject={switchProject}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
          onShowDashboard={showDashboard}
          onShowTestCases={showTestCases}
          onShowTestRuns={showCycles}
          onShowPlans={showPlans}
          onShowReports={showReports}
          onShowPlatforms={showPlatforms}
          onShowMembers={showMembers}
          onShowSettings={showSettings}
          onLogout={logout}
        />
      )}

      {/* Main content area */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {page === 'login' && <LoginPage onLogin={login} />}

        {page === 'dashboard' && (
          <Dashboard
            onShowTestRuns={showCycles}
            onOpenCycle={openCycle}
            projectId={currentProjectId}
          />
        )}

        {page === 'reports' && (
          <Reports
            projectId={currentProjectId}
            projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
            portals={portals}
          />
        )}

        {page === 'members' && (
          <Members
            currentUser={user}
            workspaceId={currentProjectId}
            workspaceName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
          />
        )}

        {page === 'plans' && (
          <ComingSoon
            title="Test plans"
            subtitle="Reusable test packs you can run on every release."
            icon="ti-clipboard-text"
            features={[
              {
                icon: 'ti-bookmark',
                label: 'Pinned plans',
                desc: 'Save a curated set of cases (e.g. "Smoke pack") and re-run it any time.',
              },
              {
                icon: 'ti-repeat',
                label: 'One-click re-run',
                desc: 'Spin up a fresh Test Run from a plan in one click — keeps history per release.',
              },
              {
                icon: 'ti-share',
                label: 'Shareable',
                desc: 'Hand a plan to another tester or schedule it on a cadence.',
              },
            ]}
            cta={{
              label: 'Use Test Runs for now',
              icon: 'ti-arrow-right',
              onClick: showCycles,
              hint: 'Test Runs already supports module/suite/custom scopes — plans add reusability on top.',
            }}
          />
        )}

        {page === 'platforms' && (
          <ComingSoon
            title="Platforms & portals"
            subtitle="Organize where your test cases live."
            icon="ti-stack-2"
            features={[
              {
                icon: 'ti-app-window',
                label: 'Platform list',
                desc: 'Group portals under platforms like Web, Mobile, Desktop.',
              },
              {
                icon: 'ti-eye',
                label: 'Visibility rules',
                desc: 'Restrict a portal to certain roles (e.g. Student portal = QA only).',
              },
              {
                icon: 'ti-grip-vertical',
                label: 'Reorder',
                desc: 'Drag portals to set the order they appear in the sidebar tree.',
              },
            ]}
            cta={{
              label: 'Manage portals in Test Cases',
              icon: 'ti-arrow-right',
              onClick: showTestCases,
              hint: 'Every portal/module/suite is fully manageable inline today — this config screen just consolidates it.',
            }}
          />
        )}

        {page === 'settings' && (
          <ComingSoon
            title="Settings"
            subtitle="Workspace preferences, integrations, and billing."
            icon="ti-settings"
            features={[
              {
                icon: 'ti-bell',
                label: 'Notifications',
                desc: 'Email + Slack alerts when runs complete or new failures land.',
              },
              {
                icon: 'ti-plug',
                label: 'Integrations',
                desc: 'Connect Jira, Linear, GitHub Issues for two-way defect sync.',
              },
              {
                icon: 'ti-key',
                label: 'API tokens',
                desc: 'Create scoped tokens for CI pipelines to push test results.',
              },
            ]}
          />
        )}

        {page === 'list' && (
          <TestCaseList
            projectId={currentProjectId}
            projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
            currentKey={currentKey}
            onNavigate={navFeature}
            onShowCreate={showCreate}
            onView={viewTC}
            onEdit={id => {
              viewTC(id);
              setTimeout(showEdit, 0);
            }}
            onDelete={id => {
              if (confirm('Delete this test case? This cannot be undone.')) {
                deleteTC(id);
              }
            }}
          />
        )}

        {page === 'create' && (
          <TestCaseCreate
            modules={modules}
            defaultModule={currentKey.split(':')[0]}
            defaultFeature={currentKey.split(':')[1]}
            onCancel={cancelCreate}
            onSave={createTC}
          />
        )}

        {page === 'view' && currentTC && (
          <TestCaseView
            tc={currentTC}
            cases={currentCases}
            currentKey={currentKey}
            onBack={() => navFeature(currentKey.split(':')[0], currentKey.split(':')[1])}
            onEdit={showEdit}
            onDelete={() => {
              if (confirm(`Delete "${currentTC.title}"? This cannot be undone.`)) {
                deleteTC(currentTC.id);
              }
            }}
            onDuplicate={duplicateTC}
            onView={viewTC}
          />
        )}

        {page === 'edit' && currentTC && (
          <TestCaseEdit
            tc={currentTC}
            modules={modules}
            currentKey={currentKey}
            onBack={() => viewTC(currentTC.id)}
            onSave={saveEdit}
          />
        )}

        {page === 'cycles' && (
          <CyclesList
            cycles={cycles}
            loading={cyclesLoading}
            modules={modules}
            projectId={currentProjectId}
            onOpen={openCycle}
            onArchive={archiveCycle}
            onDelete={deleteCycle}
            onCreate={createCycle}
          />
        )}

        {page === 'cycle' && currentCycle && (
          <CycleView
            cycle={currentCycle}
            runs={runs}
            summary={summary}
            loading={runsLoading}
            onBack={backToCycles}
            onSubmitResult={submitResult}
            onCloseRun={closeCycle}
          />
        )}
      </main>

      {/* Toast notification */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
