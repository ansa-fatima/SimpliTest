'use client';

import { useStore } from '@/hooks/useStore';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { LoginPage } from '@/components/features/LoginPage';
import { TestCaseList } from '@/components/features/TestCaseList';
import { TestCaseView } from '@/components/features/TestCaseView';
import { TestCaseEdit } from '@/components/features/TestCaseEdit';
import { TestRunsBoard } from '@/components/features/TestRunsBoard';
import { CyclesList } from '@/components/features/CyclesList';
import { CycleOverview } from '@/components/features/CycleOverview';
import { CycleView } from '@/components/features/CycleView';
import { Dashboard } from '@/components/features/Dashboard';
import { Reports } from '@/components/features/Reports';
import { Members } from '@/components/features/Members';
import { Settings } from '@/components/features/Settings';
import { WorkspaceOnboarding } from '@/components/features/WorkspaceOnboarding';
import { Profile } from '@/components/features/Profile';
import { ManualCycleSummaryModal } from '@/components/features/ManualCycleSummaryModal';
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
    saveEdit,
    deleteTC,
    duplicateTC,
    addModule,
    addFeature,
    deleteModule,
    deleteFeature,
    showDashboard,
    showTestCases,
    showCycles,
    showTestRunsBoard,
    openCycle,
    closeQuickLogCycle,
    backFromCycle,
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
    showSettings,
    showProfile,
    refreshSessionUser,
    reloadProjects,
    reloadPortals,
    viewApiCase,
    regenerateCycle,
    updateCycle,
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
    cycleOverview,
    cycleOverviewLoading,
    quickLogCycle,
    reportsInitialTab,
    dataVersion,
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
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      {/* Topbar — hidden on login */}
      {page !== 'login' && (
        <Topbar
          user={user}
          projects={projects}
          currentProjectId={currentProjectId}
          onSwitchProject={switchProject}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
          onOpenCase={viewApiCase}
          onShowProfile={showProfile}
          onLogout={logout}
        />
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar — hidden on login */}
        {page !== 'login' && (
          <Sidebar
            page={page}
            onShowDashboard={showDashboard}
            onShowTestCases={showTestCases}
            onShowTestRunsBoard={showTestRunsBoard}
            onShowTestRuns={showCycles}
            onShowReports={() => showReports()}
            onShowMembers={showMembers}
            onShowSettings={showSettings}
          />
        )}

        {/* Main content area */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {page === 'login' && <LoginPage onLogin={login} />}

          {page === 'dashboard' && (
            <Dashboard
              onShowTestRuns={showTestRunsBoard}
              onOpenCycle={openCycle}
              onShowReports={() => showReports()}
              onShowStabilityReport={() => showReports('stability')}
              projectId={currentProjectId}
              userName={user?.name || user?.username || null}
            />
          )}

          {page === 'reports' && (
            <Reports
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              portals={portals}
              onOpenCycle={openCycle}
              initialTab={reportsInitialTab}
            />
          )}

          {page === 'members' && (
            <Members
              currentUser={user}
              workspaceId={currentProjectId}
              workspaceName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              onSelfRoleChanged={refreshSessionUser}
            />
          )}

          {page === 'profile' && <Profile currentUser={user} onUpdated={refreshSessionUser} />}

          {page === 'settings' && (
            <Settings
              workspaceId={currentProjectId}
              workspaceName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
            />
          )}

          {page === 'list' && (
            <TestCaseList
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              currentKey={currentKey}
              onNavigate={navFeature}
              authorName={user?.name || user?.username || 'You'}
              onOpenCase={viewApiCase}
              dataVersion={dataVersion}
            />
          )}

          {page === 'view' && currentTC && (
            <TestCaseView
              tc={currentTC}
              cases={currentCases}
              currentKey={currentKey}
              projectId={currentProjectId}
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
              projectId={currentProjectId}
              onBack={() => viewTC(currentTC.id)}
              onSave={saveEdit}
            />
          )}

          {page === 'testRuns' && (
            <TestRunsBoard
              cycles={cycles}
              loading={cyclesLoading}
              modules={modules}
              projectId={currentProjectId}
              onOpenRun={openCycle}
              onCreate={createCycle}
              onUpdate={updateCycle}
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
              onUpdate={updateCycle}
            />
          )}

          {page === 'cycleOverview' && (
            <CycleOverview
              data={cycleOverview}
              loading={cycleOverviewLoading}
              modules={modules}
              projectId={currentProjectId}
              onBack={backFromCycle}
              onOpenTestRun={() => cycleOverview && openCycle(cycleOverview.cycle.id)}
              onUpdate={updateCycle}
            />
          )}

          {page === 'cycle' && currentCycle && (
            <CycleView
              cycle={currentCycle}
              runs={runs}
              summary={summary}
              loading={runsLoading}
              modules={modules}
              projectId={currentProjectId}
              onBack={backFromCycle}
              onSubmitResult={submitResult}
              onCloseRun={closeCycle}
              onRegenerate={regenerateCycle}
              onUpdate={updateCycle}
            />
          )}
        </main>
      </div>

      {/* Quick log summary — opened from outside the Test Runs page (Dashboard's
          Recent activity, the Stability report drilldown) since a quick log has
          no per-case runs to show in CycleView. */}
      {quickLogCycle && (
        <ManualCycleSummaryModal
          cycle={quickLogCycle}
          onClose={closeQuickLogCycle}
          onEdit={() => {
            closeQuickLogCycle();
            showCycles();
          }}
        />
      )}

      {/* Toast notification */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
