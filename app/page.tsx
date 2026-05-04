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
import { Toast } from '@/components/ui/Toast';

export default function Home() {
  const {
    state,
    currentCases,
    login,
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
    showDashboard,
    showTestCases,
    showCycles,
    openCycle,
    backToCycles,
    createCycle,
    archiveCycle,
    submitResult,
  } = useStore();

  const { page, currentKey, currentTC, toast, modules,
    cycles, currentCycle, runs, summary, cyclesLoading, runsLoading } = state;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar — hidden on login */}
      {page !== 'login' && (
        <Sidebar
          modules={modules}
          currentKey={currentKey}
          page={page}
          onNavigate={navFeature}
          onAddModule={addModule}
          onAddFeature={addFeature}
          onShowDashboard={showDashboard}
          onShowTestRuns={showCycles}
          onShowTestCases={showTestCases}
        />
      )}

      {/* Main content area */}
      <main className="flex flex-col flex-1 overflow-hidden min-w-0">
        {page === 'login' && (
          <LoginPage onLogin={login} />
        )}

        {page === 'dashboard' && (
          <Dashboard onShowTestRuns={showCycles} onOpenCycle={openCycle} />
        )}

        {page === 'list' && (
          <TestCaseList
            currentKey={currentKey}
            cases={currentCases}
            onView={viewTC}
            onEdit={id => { viewTC(id); setTimeout(showEdit, 0); }}
            onDelete={id => {
              if (confirm('Delete this test case? This cannot be undone.')) {
                deleteTC(id);
              }
            }}
            onShowCreate={showCreate}
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
            currentKey={currentKey}
            onBack={() => navFeature(currentKey.split(':')[0], currentKey.split(':')[1])}
            onEdit={showEdit}
            onDelete={() => {
              if (confirm(`Delete "${currentTC.title}"? This cannot be undone.`)) {
                deleteTC(currentTC.id);
              }
            }}
            onDuplicate={duplicateTC}
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
            onOpen={openCycle}
            onArchive={archiveCycle}
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
          />
        )}
      </main>

      {/* Toast notification */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
