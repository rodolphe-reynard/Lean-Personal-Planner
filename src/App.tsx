import React, { useState } from 'react';
import { Cloud, CloudOff, Database, Languages, Loader2 } from 'lucide-react';
import { AppStateProvider, useAppState } from './context/AppStateContext';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { ActiveTab, Task, TaskStatus } from './types';
import { MasterScheduleTab } from './components/MasterScheduleTab';
import { WBSTab } from './components/WBSTab';
import { HeijunkaTab } from './components/HeijunkaTab';
import { WeeklyPlanTab } from './components/WeeklyPlanTab';
import { StatisticsTab } from './components/StatisticsTab';
import { TaskFormModal } from './components/TaskFormModal';
import { BackupModal } from './components/BackupModal';
import { SyncModals } from './components/SyncModals';
import { ErrorBoundary } from './components/ErrorBoundary';

const TAB_IDS: ActiveTab[] = ['master', 'wbs', 'heijunka', 'weekly', 'stats'];

const PlannerShell: React.FC = () => {
  const { isLoading, storageError, activeTab, setActiveTab, user, syncStatus } = useAppState();
  const { t, toggleLanguage } = useLanguage();

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultTaskStatus, setDefaultTaskStatus] = useState<TaskStatus>('todo');
  const [backupModalOpen, setBackupModalOpen] = useState(false);

  const handleOpenNewTask = (status: TaskStatus = 'todo') => {
    setEditingTask(null);
    setDefaultTaskStatus(status);
    setTaskModalOpen(true);
  };

  const handleOpenEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskModalOpen(true);
  };

  const accountInitial = user
    ? (user.displayName || user.email || 'U').charAt(0).toUpperCase()
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7f6] text-zinc-900">
      {/* Top Navigation Bar — single-row layout */}
      <header className="sticky top-0 z-30 bg-white border-b border-zinc-200">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-6">
          {/* Primary Navigation Tabs (Heijunka placed directly before Weekly Work Plan) */}
          <nav
            aria-label={t.nav.primaryAria}
            className="flex items-center gap-1 sm:gap-6 overflow-x-auto h-full"
          >
            {TAB_IDS.map((tabId) => {
              const isActive = activeTab === tabId;
              return (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setActiveTab(tabId)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative h-full px-2.5 sm:px-1 flex items-center text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-zinc-900 ${
                    isActive
                      ? 'text-zinc-950'
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {t.nav.tabs[tabId]}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 right-0 bottom-0 h-0.5 bg-zinc-900"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Language Switcher & Cloud Sync / Backup Action */}
          <div className="shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={toggleLanguage}
              title={t.nav.switchLanguageTitle}
              aria-label={t.nav.switchLanguageAria}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-zinc-900"
            >
              <Languages className="w-3.5 h-3.5" />
              <span className="font-mono font-semibold">{t.nav.languageShort}</span>
            </button>

            <button
              type="button"
              onClick={() => setBackupModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-zinc-900"
            >
              {user ? (
                <>
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || t.nav.accountFallback}
                      className="w-4 h-4 rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-zinc-900 text-white text-[10px] font-semibold flex items-center justify-center">
                      {accountInitial}
                    </span>
                  )}
                  <span>{user.displayName?.split(' ')[0] || t.nav.accountFallback}</span>
                  {syncStatus === 'syncing' ? (
                    <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />
                  ) : syncStatus === 'offline' || syncStatus === 'error' ? (
                    <CloudOff className="w-3 h-3 text-amber-600" />
                  ) : (
                    <Cloud className="w-3 h-3 text-emerald-600" />
                  )}
                </>
              ) : (
                <>
                  <Database className="w-3.5 h-3.5" />
                  <span>{t.nav.syncBackup}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 py-6 flex flex-col">
        {storageError && (
          <div className="mb-4 px-4 py-2.5 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md">
            {storageError}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            <div className="h-10 w-64 bg-zinc-200/70 rounded animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="h-80 bg-zinc-200/60 rounded-lg animate-pulse" />
              <div className="h-80 bg-zinc-200/60 rounded-lg animate-pulse" />
              <div className="h-80 bg-zinc-200/60 rounded-lg animate-pulse" />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {activeTab === 'master' && (
              <MasterScheduleTab
                onNewTask={() => handleOpenNewTask('todo')}
                onEditTask={handleOpenEditTask}
              />
            )}
            {activeTab === 'wbs' && (
              <WBSTab
                onNewTask={() => handleOpenNewTask('todo')}
                onEditTask={handleOpenEditTask}
              />
            )}
            {activeTab === 'heijunka' && <HeijunkaTab />}
            {activeTab === 'weekly' && (
              <WeeklyPlanTab onNewTask={() => handleOpenNewTask('todo')} />
            )}
            {activeTab === 'stats' && <StatisticsTab />}
          </div>
        )}
      </main>

      <TaskFormModal
        isOpen={taskModalOpen}
        editingTask={editingTask}
        defaultStatus={defaultTaskStatus}
        onClose={() => {
          setTaskModalOpen(false);
          setEditingTask(null);
        }}
      />

      <BackupModal
        isOpen={backupModalOpen}
        onClose={() => setBackupModalOpen(false)}
      />

      <SyncModals />
    </div>
  );
};

export default function App() {
  return (
    <LanguageProvider>
      <ErrorBoundary>
        <AppStateProvider>
          <PlannerShell />
        </AppStateProvider>
      </ErrorBoundary>
    </LanguageProvider>
  );
}
