'use client';

import { useEffect, useRef, useState } from 'react';
import { TestCycle } from '@/types';
import { useStore } from '@/hooks/useStore';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { LoginPage } from '@/components/features/LoginPage';
import { TestCaseList } from '@/components/features/TestCaseList';
import { TestCaseView } from '@/components/features/TestCaseView';
import { TestCaseEdit } from '@/components/features/TestCaseEdit';
import { TestRunsBoard } from '@/components/features/TestRunsBoard';
import { NewRunPage } from '@/components/features/NewRunPage';
import { NewPlanPage } from '@/components/features/NewPlanPage';
import { TestPlanView } from '@/components/features/TestPlanView';
import { TestPlansPage } from '@/components/features/TestPlansPage';
import { CycleOverview } from '@/components/features/CycleOverview';
import { CycleView } from '@/components/features/CycleView';
import { Dashboard } from '@/components/features/Dashboard';
import { MyTodo } from '@/components/features/MyTodo';
import { ProjectsPage } from '@/components/features/ProjectsPage';
import { Reports } from '@/components/features/Reports';
import { Members } from '@/components/features/Members';
import { RolesPage } from '@/components/features/RolesPage';
import { Settings } from '@/components/features/Settings';
import { WorkspaceOnboarding } from '@/components/features/WorkspaceOnboarding';
import { Profile } from '@/components/features/Profile';
import { ManualCycleSummaryModal } from '@/components/features/ManualCycleSummaryModal';
import { UpdateQuickLogModal } from '@/components/features/QuickLogModal';
import { Toast } from '@/components/ui/Toast';

export default function Home() {
  // The summary modal's own "Edit" button opens this in place, instead of
  // navigating to Test Cycles and making the user find + click the same
  // quick log a second time to actually edit it.
  const [editingQuickLog, setEditingQuickLog] = useState<TestCycle | null>(null);

  const {
    state,
    currentCases,
    login,
    logout,
    navFeature,
    viewTC,
    showEdit,
    saveEdit,
    refreshCurrentCase,
    deleteTC,
    duplicateTC,
    addModule,
    addFeature,
    deleteModule,
    deleteFeature,
    showDashboard,
    showTodo,
    showProjects,
    openProject,
    showTestCases,
    showTestRunsBoard,
    showTestPlans,
    openPlan,
    showNewPlan,
    showEditPlan,
    editPlanFromList,
    leaveEditPlan,
    backFromPlan,
    createPlan,
    updatePlan,
    addRunsToPlan,
    removeRunFromPlan,
    deletePlan,
    showQuickLogs,
    showNewRun,
    showNewRunForPlan,
    openCycleOverview,
    openCycle,
    closeQuickLogCycle,
    backFromCycle,
    goBack,
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
    showRoles,
    showSettings,
    showProfile,
    refreshSessionUser,
    reloadProjects,
    reloadPortals,
    viewApiCase,
    regenerateCycle,
    updateCycle,
    loadCycles,
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
    plans,
    plansLoading,
    currentPlanId,
    newRunPlanId,
    planDetail,
    planDetailLoading,
    cycleOverview,
    cycleOverviewLoading,
    quickLogCycle,
    reportsInitialTab,
    dataVersion,
    previousPage,
  } = state;

  // Browser history: every in-app page change pushes a history entry, and the
  // browser Back button walks back to the previous section (same rule as the
  // in-app Back buttons) instead of leaving the app.
  const navRef = useRef({ page, previousPage, goBack, loadCycles });
  navRef.current = { page, previousPage, goBack, loadCycles };
  const fromPop = useRef(false);
  useEffect(() => {
    const onPop = () => {
      const { page: cur, previousPage: prev, goBack: back, loadCycles: reload } = navRef.current;
      if (cur === 'login' || !prev || prev === cur) return;
      fromPop.current = true;
      back('dashboard');
      reload();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (page === 'login') return;
    if (fromPop.current) {
      fromPop.current = false;
      return;
    }
    window.history.pushState({ page }, '');
  }, [page]);

  // Deleting a plan keeps its runs -- say so, with how many are affected.
  const confirmDeletePlan = (p: { id: string; name: string }) => {
    const n = cycles.filter(c => c.planId === p.id).length;
    const runs =
      n === 0 ? '' : ` Its ${n} ${n === 1 ? 'run is' : 'runs are'} kept as standalone runs.`;
    if (confirm(`Delete the plan "${p.name}"?${runs} This cannot be undone.`))
      void deletePlan(p.id);
  };

  const newRunPlan = newRunPlanId ? (plans.find(p => p.id === newRunPlanId) ?? null) : null;

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
          page={page}
          projects={projects}
          currentProjectId={currentProjectId}
          onSwitchProject={openProject}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
          onShowProjects={showProjects}
          onShowDashboard={showDashboard}
          onOpenCase={viewApiCase}
          onShowProfile={showProfile}
          onLogout={logout}
        />
      )}

      <div className="app-body flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar — hidden on login */}
        {page !== 'login' && (
          <Sidebar
            page={page}
            onShowProjects={showProjects}
            onShowDashboard={showDashboard}
            onShowTodo={showTodo}
            onShowTestCases={showTestCases}
            onShowTestRunsBoard={showTestRunsBoard}
            onShowTestPlans={showTestPlans}
            onShowQuickLogs={showQuickLogs}
            onShowReports={() => showReports()}
            onShowMembers={showMembers}
            onShowSettings={showSettings}
          />
        )}

        {/* Main content area */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {page === 'login' && <LoginPage onLogin={login} />}

          {page === 'projects' && (
            <ProjectsPage
              user={user}
              projects={projects}
              currentProjectId={currentProjectId}
              onOpen={openProject}
              onCreate={createProject}
            />
          )}

          {page === 'todo' && <MyTodo onOpenCycle={openCycle} />}

          {page === 'dashboard' && (
            <Dashboard
              onShowTestRuns={showTestRunsBoard}
              onOpenCycle={openCycle}
              onShowReports={() => showReports()}
              onShowStabilityReport={() => showReports('stability')}
              onShowProjects={showProjects}
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
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
              onOpenRoles={showRoles}
            />
          )}

          {page === 'roles' && (
            <RolesPage
              workspaceId={currentProjectId}
              workspaceName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
            />
          )}

          {page === 'profile' && <Profile currentUser={user} onUpdated={refreshSessionUser} />}

          {page === 'settings' && (
            <Settings
              projectCount={projects.length}
              onDeleteProject={deleteProject}
              onProjectSaved={() => void reloadProjects()}
              onOpenRoles={showRoles}
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
              onBack={() => {
                // A case can be opened from the repository list, the global search,
                // a notification or the dashboard. Back returns to whichever of those
                // the user actually came from; only when they came from the
                // repository itself do we restore its section.
                const cameFromList =
                  !previousPage || ['list', 'edit', 'view'].includes(previousPage);
                if (cameFromList && currentKey)
                  navFeature(currentKey.split(':')[0], currentKey.split(':')[1]);
                else goBack('list');
              }}
              onEdit={showEdit}
              onDelete={() => {
                if (confirm(`Delete "${currentTC.title}"? This cannot be undone.`)) {
                  deleteTC(currentTC.id);
                }
              }}
              onDuplicate={duplicateTC}
              onView={viewTC}
              onRefresh={refreshCurrentCase}
            />
          )}

          {page === 'edit' && currentTC && (
            <TestCaseEdit
              tc={currentTC}
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              onBack={() => viewTC(currentTC.id)}
              onSave={saveEdit}
            />
          )}

          {page === 'testRuns' && (
            <TestRunsBoard
              mode="runs"
              cycles={cycles}
              loading={cyclesLoading}
              modules={modules}
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              currentUserName={user?.name || user?.username || ''}
              onOpenRun={openCycle}
              onOpenOverview={openCycleOverview}
              onNewRun={showNewRun}
              plans={plans}
              onOpenPlan={openPlan}
              onEditPlan={editPlanFromList}
              onDeletePlan={confirmDeletePlan}
              onNewPlan={showNewPlan}
              onCreate={createCycle}
              onUpdate={updateCycle}
              onDelete={deleteCycle}
              onReload={loadCycles}
            />
          )}

          {page === 'testPlans' && (
            <TestPlansPage
              plans={plans}
              cycles={cycles}
              loading={plansLoading || cyclesLoading}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              onOpenPlan={openPlan}
              onEditPlan={editPlanFromList}
              onDeletePlan={confirmDeletePlan}
              onNewPlan={showNewPlan}
              onOpenRun={openCycle}
              onOpenOverview={openCycleOverview}
            />
          )}

          {page === 'plan' && currentPlanId && (
            <TestPlanView
              planId={currentPlanId}
              plans={plans}
              cycles={cycles}
              detail={planDetail}
              loading={planDetailLoading || cyclesLoading}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              onBack={backFromPlan}
              onShowPlans={showTestPlans}
              onEdit={showEditPlan}
              onDelete={() => {
                const p = plans.find(x => x.id === currentPlanId);
                if (p) confirmDeletePlan(p);
              }}
              onOpenRun={openCycle}
              onOpenOverview={openCycleOverview}
              onNewRun={() => showNewRunForPlan(currentPlanId)}
              onAddRuns={ids => addRunsToPlan(currentPlanId, ids)}
              onRemoveRun={id => removeRunFromPlan(currentPlanId, id)}
            />
          )}

          {page === 'newPlan' && (
            <NewPlanPage
              key="new"
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              cycles={cycles}
              plans={plans}
              onCancel={backFromPlan}
              onSave={async (input, opts) => {
                const plan = await createPlan(input);
                if (plan) {
                  if (opts?.newRun) showNewRunForPlan(plan.id);
                  else openPlan(plan.id);
                }
                return !!plan;
              }}
            />
          )}

          {page === 'editPlan' && currentPlanId && (
            <NewPlanPage
              key={currentPlanId}
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              plan={plans.find(p => p.id === currentPlanId) ?? null}
              cycles={cycles}
              plans={plans}
              onCancel={leaveEditPlan}
              onSave={async input => {
                const ok = await updatePlan(currentPlanId, input);
                if (ok) leaveEditPlan();
                return ok;
              }}
              onDelete={() => {
                const p = plans.find(x => x.id === currentPlanId);
                if (
                  p &&
                  confirm(
                    `Delete the plan "${p.name}"? Its runs and results are kept as standalone runs.`,
                  )
                )
                  void deletePlan(p.id);
              }}
            />
          )}

          {page === 'quickLogs' && (
            <TestRunsBoard
              mode="quicklogs"
              cycles={cycles}
              loading={cyclesLoading}
              modules={modules}
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              currentUserName={user?.name || user?.username || ''}
              onOpenRun={openCycle}
              onOpenOverview={openCycleOverview}
              onNewRun={showNewRun}
              plans={plans}
              onOpenPlan={openPlan}
              onEditPlan={editPlanFromList}
              onDeletePlan={confirmDeletePlan}
              onNewPlan={showNewPlan}
              onCreate={createCycle}
              onUpdate={updateCycle}
              onDelete={deleteCycle}
              onReload={loadCycles}
            />
          )}

          {page === 'newRun' && (
            <NewRunPage
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              plan={newRunPlan ? { id: newRunPlan.id, name: newRunPlan.name } : null}
              onCancel={() => (newRunPlan ? openPlan(newRunPlan.id) : showTestRunsBoard())}
              onCreate={async input => (await createCycle(input)) ?? null}
              onStart={openCycle}
              onDone={() => (newRunPlan ? openPlan(newRunPlan.id) : showTestRunsBoard())}
            />
          )}

          {page === 'cycleOverview' && (
            <CycleOverview
              data={cycleOverview}
              loading={cycleOverviewLoading}
              modules={modules}
              projectId={currentProjectId}
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              onBack={backFromCycle}
              onOpenTestRun={() => cycleOverview && openCycle(cycleOverview.cycle.id)}
              onUpdate={updateCycle}
              onDelete={deleteCycle}
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
              projectName={projects.find(p => p.id === currentProjectId)?.name ?? ''}
              onBack={backFromCycle}
              onSubmitResult={submitResult}
              onCloseRun={closeCycle}
              onRegenerate={regenerateCycle}
              onUpdate={updateCycle}
              onDelete={deleteCycle}
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
          projectId={currentProjectId}
          onClose={closeQuickLogCycle}
          onEdit={() => {
            setEditingQuickLog(quickLogCycle);
            closeQuickLogCycle();
          }}
        />
      )}

      {editingQuickLog && (
        <UpdateQuickLogModal
          log={editingQuickLog}
          projectId={currentProjectId}
          onClose={() => setEditingQuickLog(null)}
          onSave={async patch => {
            await updateCycle(editingQuickLog.id, patch);
            setEditingQuickLog(null);
          }}
        />
      )}

      {/* Toast notification */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
