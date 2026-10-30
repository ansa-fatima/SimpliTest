'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiTestCase, TestCycle } from '@/types';
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
import { api } from '@/lib/client';
import { parseCaseRef, parseFolderRef } from '@/lib/caseLink';
import { parseNavParams, queryForPage, type NavParams } from '@/lib/navLink';

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
    showToast,
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

  // A shared link (/?case=10504) names a case. Read it once on load, before anything
  // rewrites the address bar; it is opened as soon as the user is signed in.
  const pendingCase = useRef<string | null>(
    typeof window === 'undefined'
      ? null
      : parseCaseRef(new URLSearchParams(window.location.search).get('case')),
  );
  useEffect(() => {
    const ref = pendingCase.current;
    if (!ref || !user || !authChecked || projects.length === 0) return;
    pendingCase.current = null;
    void (async () => {
      try {
        const c = await api.get<
          ApiTestCase & {
            portal?: { projectId: string } | null;
            module?: { portal: { projectId: string } } | null;
            suite?: { module: { portal: { projectId: string } } } | null;
          }
        >(`/api/test-cases/${ref}`);
        const pid =
          c.suite?.module.portal.projectId ?? c.module?.portal.projectId ?? c.portal?.projectId;
        if (pid && pid !== currentProjectId) await switchProject(pid);
        viewApiCase(c, [c]);
      } catch {
        showToast(`Test case ${ref} was not found, or you do not have access to it.`, 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authChecked, projects.length]);

  // A shared folder link (/?folder=s:<id>): switch to its workspace if needed, then show
  // the repository -- which reads the folder from the address bar and selects it.
  const pendingFolder = useRef<string | null>(
    typeof window === 'undefined'
      ? null
      : (new URLSearchParams(window.location.search).get('folder') ?? null),
  );
  useEffect(() => {
    const raw = pendingFolder.current;
    if (!raw || !user || !authChecked || projects.length === 0) return;
    pendingFolder.current = null;
    if (!parseFolderRef(raw)) {
      showToast('That folder link is not valid.', 'error');
      return;
    }
    void (async () => {
      try {
        const { projectId } = await api.get<{ projectId: string }>(
          `/api/folder-link?ref=${encodeURIComponent(raw)}`,
        );
        if (projectId !== currentProjectId) await switchProject(projectId);
        showTestCases();
      } catch (e) {
        showToast((e as Error).message, 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authChecked, projects.length]);

  // Any other screen link (/?view=runs, /?plan=<id>, /?cycle=<id>, ...). Read once on load.
  const pendingNav = useRef<NavParams | null>(
    typeof window === 'undefined' ? null : parseNavParams(window.location.search),
  );
  // An action that has to wait until the workspace it belongs to is the current one.
  const afterSwitch = useRef<{ projectId: string; nav: NavParams } | null>(null);

  const runNav = (n: NavParams) => {
    if (n.cycle) return openCycle(n.cycle);
    if (n.overview) return openCycleOverview(n.overview);
    if (n.plan) return openPlan(n.plan);
    switch (n.view) {
      case 'cases':
        return showTestCases();
      case 'runs':
        return showTestRunsBoard();
      case 'quicklogs':
        return showQuickLogs();
      case 'plans':
        return showTestPlans();
      case 'reports':
        return showReports(n.tab);
      case 'team':
        return showMembers();
      case 'roles':
        return showRoles();
      case 'settings':
        return showSettings();
      case 'profile':
        return showProfile();
      case 'todo':
        return showTodo();
      case 'projects':
        return showProjects();
    }
  };

  useEffect(() => {
    const n = pendingNav.current;
    if (!n || !user || !authChecked || projects.length === 0) return;
    pendingNav.current = null;
    void (async () => {
      try {
        // Runs and plans belong to one workspace: find it, switch if it is not the current one.
        let projectId: string | undefined;
        const id = n.cycle ?? n.overview;
        if (id) projectId = (await api.get<{ projectId?: string }>(`/api/cycles/${id}`)).projectId;
        else if (n.plan)
          projectId = (await api.get<{ plan: { projectId?: string } }>(`/api/plans/${n.plan}`)).plan
            .projectId;
        if (projectId && projectId !== currentProjectId) {
          afterSwitch.current = { projectId, nav: n };
          await switchProject(projectId);
          return;
        }
        runNav(n);
      } catch (e) {
        showToast((e as Error).message, 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authChecked, projects.length]);

  useEffect(() => {
    const a = afterSwitch.current;
    if (!a || a.projectId !== currentProjectId) return;
    afterSwitch.current = null;
    runNav(a.nav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

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

  // The address bar always names the open screen, so its URL can be copied, bookmarked or
  // sent. The repository adds its own folder to the address (see TestCaseList).
  const openCaseNum = page === 'view' ? currentTC?.caseNum : undefined;
  const openCycleId = currentCycle?.id;
  const openOverviewId = cycleOverview?.cycle.id;
  useEffect(() => {
    if (typeof window === 'undefined' || page === 'login') return;
    const sp = new URLSearchParams(window.location.search);
    // The deep link is still being opened: leave the address alone until it has been.
    if (pendingCase.current || pendingFolder.current || pendingNav.current || afterSwitch.current)
      return;
    // A run's id is not known until it has loaded; keep the address as it is meanwhile.
    if ((page === 'cycleOverview' && !openOverviewId) || (page === 'cycle' && !openCycleId)) return;
    // The repository owns `folder`; only fall back to ?view=cases when none is selected.
    if (page === 'list' && sp.has('folder')) return;
    const query = queryForPage(page, {
      caseNum: openCaseNum,
      cycleId: openCycleId,
      overviewId: openOverviewId,
      planId: currentPlanId ?? undefined,
      reportsTab: reportsInitialTab,
    });
    if (window.location.search !== query)
      window.history.replaceState(window.history.state, '', window.location.pathname + query);
  }, [page, openCaseNum, openCycleId, openOverviewId, currentPlanId, reportsInitialTab]);

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
