import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { Unsubscribe } from 'firebase/firestore';
import {
  ActiveTab,
  AppDataExport,
  DailyCFDSnapshot,
  FixedActivity,
  FixedActivityKind,
  PPCItemSummary,
  RecurrenceFrequency,
  Responsibility,
  ScheduledBlock,
  ScheduleVersion,
  StepExecutionState,
  StepFlowStatus,
  SyncConflict,
  Task,
  TaskDeadline,
  TaskStatus,
  ValueCategory,
  WBSStep,
  WeeklyPPCRecord,
  WorkCapacitySettings,
} from '../types';
import { auth, googleProvider } from '../firebase/config';
import {
  CloudWorkspaceSnapshot,
  fetchCloudWorkspaceSnapshot,
  pushWorkspaceToCloud,
  subscribeToUserWorkspace,
  syncDiffToCloud,
} from '../firebase/syncService';
import { createSampleWorkspace, loadWorkspace, PersistedWorkspace, saveWorkspace } from '../storage/db';
import { pickNextAvailableColorId } from '../utils/colors';
import {
  addDays,
  getPrimaryDeadline,
  getStartOfWeek,
  getTodayDateString,
  getWeekDays,
} from '../utils/dateUtils';
import {
  DEFAULT_WORK_CAPACITY,
  expandFixedActivityDates,
  hasDependencyCycle,
} from '../utils/schedulingUtils';

const CLOUD_UID_STORAGE_KEY = 'takt_cloud_synced_uid';

export type CloudSyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

export interface WorkspaceCountsSummary {
  tasks: number;
  steps: number;
  scheduledBlocks: number;
  fixedActivities: number;
  ppcRecords: number;
  cfdSnapshots: number;
}

export interface PendingMigrationPreview {
  user: User;
  localCounts: WorkspaceCountsSummary;
  cloudCounts: WorkspaceCountsSummary;
  localWorkspace: PersistedWorkspace;
  cloudSnapshot: CloudWorkspaceSnapshot;
}

interface AppStateContextValue {
  isLoading: boolean;
  storageError: string | null;
  todayStr: string;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  selectedWbsTaskId: string | null;
  setSelectedWbsTaskId: (id: string | null) => void;
  openTaskInWBS: (taskId: string) => void;

  // Weekly plan navigation state
  displayedWeekStart: string;
  setDisplayedWeekStart: (weekStart: string) => void;
  goToPrevWeek: () => void;
  goToNextWeek: () => void;
  goToCurrentWeek: () => void;

  // Auth & Cloud Sync
  user: User | null;
  authReady: boolean;
  syncStatus: CloudSyncStatus;
  syncError: string | null;
  pendingMigration: PendingMigrationPreview | null;
  syncConflicts: SyncConflict[];
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  resolveMigration: (strategy: 'merge' | 'replace_cloud' | 'keep_cloud') => Promise<void>;
  resolveConflict: (conflictId: string, resolution: 'local' | 'remote') => void;
  triggerManualReconcile: () => Promise<void>;

  // Core data
  tasks: Task[];
  steps: WBSStep[];
  scheduledBlocks: ScheduledBlock[];
  fixedActivities: FixedActivity[];
  ppcRecords: WeeklyPPCRecord[];
  cfdSnapshots: DailyCFDSnapshot[];
  scheduleVersions: ScheduleVersion[];
  workCapacity: WorkCapacitySettings;

  // Task operations
  createTask: (input: {
    name: string;
    description: string;
    deadline: string;
    deadlines?: TaskDeadline[];
    status: TaskStatus;
    colorId?: string;
    responsibility?: Responsibility;
    valueCategory?: ValueCategory;
  }) => Task;
  updateTask: (
    taskId: string,
    patch: Partial<
      Pick<
        Task,
        | 'name'
        | 'description'
        | 'deadline'
        | 'deadlines'
        | 'status'
        | 'colorId'
        | 'responsibility'
        | 'valueCategory'
      >
    >
  ) => void;
  deleteTaskCascade: (taskId: string) => void;

  // WBS Step operations
  createStep: (input: {
    taskId: string;
    title: string;
    notes?: string;
    estimatedMinutes?: number;
    responsibility?: Responsibility;
    dependsOnStepIds?: string[];
    valueCategory?: ValueCategory;
  }) => WBSStep;
  updateStep: (
    stepId: string,
    patch: Partial<
      Pick<
        WBSStep,
        | 'title'
        | 'notes'
        | 'estimatedMinutes'
        | 'completed'
        | 'executionState'
        | 'flowStatus'
        | 'varianceReason'
        | 'responsibility'
        | 'dependsOnStepIds'
        | 'valueCategory'
      >
    >
  ) => void;
  setStepExecutionState: (
    stepId: string,
    executionState: StepExecutionState,
    varianceReason?: string,
    weekStartOverride?: string
  ) => void;
  toggleStepInProgress: (stepId: string) => void;
  deleteStepCascade: (stepId: string) => void;
  reorderTaskSteps: (taskId: string, orderedStepIds: string[]) => void;
  splitStepIntoTwo: (input: {
    stepId: string;
    part1Title: string;
    part1Minutes: number;
    part2Title: string;
    part2Minutes: number;
  }) => void;

  // Weekly Plan block operations
  scheduleStep: (input: {
    stepId: string;
    taskId: string;
    date: string;
    startMinutes: number;
    durationMinutes: number;
  }) => ScheduledBlock;
  updateScheduledBlock: (
    blockId: string,
    patch: Partial<Pick<ScheduledBlock, 'date' | 'startMinutes' | 'durationMinutes'>>
  ) => void;
  unscheduleBlock: (blockId: string) => void;

  // Individualized Fixed activities
  createFixedActivity: (input: {
    title: string;
    kind: FixedActivityKind;
    daysOfWeek: number[];
    startMinutes: number;
    endMinutes: number;
    recurrence: RecurrenceFrequency;
    startDate: string;
    endDate?: string;
    countsAsWorkingTime: boolean;
    valueCategory: ValueCategory;
  }) => FixedActivity[];
  updateFixedActivity: (
    id: string,
    patch: Partial<
      Pick<
        FixedActivity,
        | 'title'
        | 'kind'
        | 'date'
        | 'startMinutes'
        | 'endMinutes'
        | 'countsAsWorkingTime'
        | 'valueCategory'
      >
    >
  ) => void;
  deleteFixedActivity: (id: string) => void;
  linkStepToFixedActivity: (fixedActivityId: string, stepId: string) => void;
  unlinkStepFromFixedActivity: (fixedActivityId: string, stepId: string) => void;

  // Capacity & Variance
  updateWorkCapacity: (patch: Partial<WorkCapacitySettings>) => void;
  updateWeekVarianceReason: (weekStart: string, reason: string) => void;
  updateStepVariance: (weekStart: string, stepId: string, reason: string) => void;

  // AI Proposal Versioning & Undo
  applyProposedWeekSchedule: (
    weekStart: string,
    proposedWeekBlocks: ScheduledBlock[],
    label?: string
  ) => void;
  restoreScheduleVersion: (versionId: string) => void;
  undoLastScheduleChange: () => void;

  // Backup / Recovery
  exportWorkspaceJson: () => string;
  replaceWorkspace: (data: PersistedWorkspace) => void;
  loadSampleData: () => void;
  clearAllData: () => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeWorkspace(ws: PersistedWorkspace): WorkspaceCountsSummary {
  return {
    tasks: ws.tasks.length,
    steps: ws.steps.length,
    scheduledBlocks: ws.scheduledBlocks.length,
    fixedActivities: ws.fixedActivities.length,
    ppcRecords: ws.ppcRecords.length,
    cfdSnapshots: ws.cfdSnapshots.length,
  };
}

function mergeByKey<T>(
  localItems: T[],
  remoteItems: T[],
  getKey: (item: T) => string,
  getUpdatedAt: (item: T) => number
): T[] {
  const map = new Map<string, T>();
  for (const item of remoteItems) {
    map.set(getKey(item), item);
  }
  for (const item of localItems) {
    const key = getKey(item);
    const existing = map.get(key);
    if (!existing || getUpdatedAt(item) >= getUpdatedAt(existing)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function mergeWorkspaces(local: PersistedWorkspace, cloud: PersistedWorkspace): PersistedWorkspace {
  const tasks = mergeByKey(local.tasks, cloud.tasks, (t) => t.id, (t) => t.updatedAt);
  const taskIds = new Set(tasks.map((t) => t.id));

  const steps = mergeByKey(local.steps, cloud.steps, (s) => s.id, (s) => s.updatedAt).filter(
    (s) => taskIds.has(s.taskId)
  );
  const stepIds = new Set(steps.map((s) => s.id));

  const scheduledBlocks = mergeByKey(
    local.scheduledBlocks,
    cloud.scheduledBlocks,
    (b) => b.id,
    (b) => b.updatedAt ?? 0
  ).filter((b) => taskIds.has(b.taskId) && stepIds.has(b.stepId));

  const fixedActivities = mergeByKey(
    local.fixedActivities,
    cloud.fixedActivities,
    (f) => f.id,
    (f) => f.updatedAt
  ).map((fa) => ({
    ...fa,
    linkedStepIds: fa.linkedStepIds.filter((sid) => stepIds.has(sid)),
  }));

  const ppcMap = new Map<string, WeeklyPPCRecord>();
  for (const r of cloud.ppcRecords) ppcMap.set(r.weekStart, r);
  for (const r of local.ppcRecords) {
    const existing = ppcMap.get(r.weekStart);
    if (!existing) {
      ppcMap.set(r.weekStart, r);
    } else if (existing.snapshot?.locked) {
      // Preserve locked cloud snapshot, merge variance notes if local is newer
      ppcMap.set(r.weekStart, {
        ...existing,
        reasonsForVariance:
          r.updatedAt > existing.updatedAt && r.reasonsForVariance
            ? r.reasonsForVariance
            : existing.reasonsForVariance,
        stepVariances:
          r.updatedAt > existing.updatedAt && r.stepVariances.length > 0
            ? r.stepVariances
            : existing.stepVariances,
        updatedAt: Math.max(r.updatedAt, existing.updatedAt),
      });
    } else if (r.updatedAt >= existing.updatedAt) {
      ppcMap.set(r.weekStart, r);
    }
  }

  const cfdMap = new Map<string, DailyCFDSnapshot>();
  for (const c of cloud.cfdSnapshots) cfdMap.set(c.date, c);
  for (const c of local.cfdSnapshots) {
    const existing = cfdMap.get(c.date);
    if (!existing) {
      cfdMap.set(c.date, c);
    } else if (!existing.locked && (c.locked || c.updatedAt >= existing.updatedAt)) {
      cfdMap.set(c.date, c);
    }
  }

  const versionMap = new Map<string, ScheduleVersion>();
  for (const v of [...cloud.scheduleVersions, ...local.scheduleVersions]) {
    if (!versionMap.has(v.id)) versionMap.set(v.id, v);
  }
  const scheduleVersions = Array.from(versionMap.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);

  const localCapTime = local.workCapacity.updatedAt ?? 0;
  const cloudCapTime = cloud.workCapacity.updatedAt ?? 0;
  const workCapacity = localCapTime >= cloudCapTime ? local.workCapacity : cloud.workCapacity;

  return {
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    ppcRecords: Array.from(ppcMap.values()),
    cfdSnapshots: Array.from(cfdMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    scheduleVersions,
    workCapacity,
  };
}

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [todayStr, setTodayStr] = useState<string>(() => getTodayDateString());
  const [activeTab, setActiveTab] = useState<ActiveTab>('kanban');
  const [selectedWbsTaskId, setSelectedWbsTaskId] = useState<string | null>(null);
  const [displayedWeekStart, setDisplayedWeekStart] = useState<string>(() =>
    getStartOfWeek(getTodayDateString())
  );

  const [tasks, setTasks] = useState<Task[]>([]);
  const [steps, setSteps] = useState<WBSStep[]>([]);
  const [scheduledBlocks, setScheduledBlocks] = useState<ScheduledBlock[]>([]);
  const [fixedActivities, setFixedActivities] = useState<FixedActivity[]>([]);
  const [ppcRecords, setPpcRecords] = useState<WeeklyPPCRecord[]>([]);
  const [cfdSnapshots, setCfdSnapshots] = useState<DailyCFDSnapshot[]>([]);
  const [scheduleVersions, setScheduleVersions] = useState<ScheduleVersion[]>([]);
  const [workCapacity, setWorkCapacity] = useState<WorkCapacitySettings>(DEFAULT_WORK_CAPACITY);

  // Firebase Auth & Sync State
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingMigration, setPendingMigration] = useState<PendingMigrationPreview | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [cloudActiveUid, setCloudActiveUid] = useState<string | null>(null);

  const hydratedRef = useRef(false);
  const currentWorkspaceRef = useRef<PersistedWorkspace>({
    tasks: [],
    steps: [],
    scheduledBlocks: [],
    fixedActivities: [],
    ppcRecords: [],
    cfdSnapshots: [],
    scheduleVersions: [],
    workCapacity: DEFAULT_WORK_CAPACITY,
  });

  currentWorkspaceRef.current = {
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    ppcRecords,
    cfdSnapshots,
    scheduleVersions,
    workCapacity,
  };

  // Cloud sync tracking refs
  const activeCloudUidRef = useRef<string | null>(null);
  const lastPushedWorkspaceRef = useRef<PersistedWorkspace | null>(null);
  const remoteLockedCfdDatesRef = useRef<Set<string>>(new Set());
  const remoteLockedPpcWeeksRef = useRef<Set<string>>(new Set());
  const remoteVersionIdsRef = useRef<Set<string>>(new Set());
  const applyingRemoteRef = useRef(false);
  const recentLocalEditsRef = useRef<Map<string, number>>(new Map());
  const cloudUnsubRef = useRef<Unsubscribe | null>(null);

  const markLocalEdit = useCallback((collection: string, docId: string) => {
    recentLocalEditsRef.current.set(`${collection}:${docId}`, Date.now());
  }, []);

  // Sync system date on focus, visibility change, and 60s tick
  useEffect(() => {
    const syncDate = () => {
      const currentToday = getTodayDateString();
      setTodayStr((prev) => {
        if (prev !== currentToday) {
          setDisplayedWeekStart((prevStart) => {
            const oldTodayStart = getStartOfWeek(prev);
            return prevStart === oldTodayStart ? getStartOfWeek(currentToday) : prevStart;
          });
          return currentToday;
        }
        return prev;
      });
    };

    window.addEventListener('focus', syncDate);
    document.addEventListener('visibilitychange', syncDate);
    const interval = window.setInterval(syncDate, 60_000);

    return () => {
      window.removeEventListener('focus', syncDate);
      document.removeEventListener('visibilitychange', syncDate);
      window.clearInterval(interval);
    };
  }, []);

  // Track browser online / offline status for cloud indicator
  useEffect(() => {
    const onOffline = () => {
      if (activeCloudUidRef.current) setSyncStatus('offline');
    };
    const onOnline = () => {
      if (activeCloudUidRef.current) setSyncStatus('synced');
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // Hydrate from IndexedDB on boot
  useEffect(() => {
    let active = true;
    loadWorkspace()
      .then((data) => {
        if (!active) return;
        setTasks(data.tasks);
        setSteps(data.steps);
        setScheduledBlocks(data.scheduledBlocks);
        setFixedActivities(data.fixedActivities);
        setPpcRecords(data.ppcRecords);
        setCfdSnapshots(data.cfdSnapshots);
        setScheduleVersions(data.scheduleVersions);
        setWorkCapacity(data.workCapacity);

        if (data.tasks.length > 0) {
          const sorted = [...data.tasks].sort((a, b) => a.deadline.localeCompare(b.deadline));
          setSelectedWbsTaskId(sorted[0].id);
        }
        hydratedRef.current = true;
        setIsLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to load workspace from IndexedDB:', err);
        setStorageError('Unable to access local browser storage (IndexedDB). Changes may not persist.');
        hydratedRef.current = true;
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Persist to IndexedDB whenever state updates
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveWorkspace({
      tasks,
      steps,
      scheduledBlocks,
      fixedActivities,
      ppcRecords,
      cfdSnapshots,
      scheduleVersions,
      workCapacity,
    }).catch((err) => {
      console.error('Failed to save workspace to IndexedDB:', err);
      setStorageError('Failed to save changes to local browser storage.');
    });
  }, [
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    ppcRecords,
    cfdSnapshots,
    scheduleVersions,
    workCapacity,
  ]);

  const applyWorkspaceLocally = useCallback((data: PersistedWorkspace) => {
    applyingRemoteRef.current = true;
    setTasks(data.tasks);
    setSteps(data.steps);
    setScheduledBlocks(data.scheduledBlocks);
    setFixedActivities(data.fixedActivities);
    setPpcRecords(data.ppcRecords);
    setCfdSnapshots(data.cfdSnapshots);
    setScheduleVersions(data.scheduleVersions);
    setWorkCapacity(data.workCapacity);
    setSelectedWbsTaskId((prevId) => {
      if (prevId && data.tasks.some((t) => t.id === prevId)) return prevId;
      if (data.tasks.length === 0) return null;
      return [...data.tasks].sort((a, b) => a.deadline.localeCompare(b.deadline))[0].id;
    });
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 50);
  }, []);

  const attachCloudRealtimeListeners = useCallback(
    (uid: string) => {
      if (cloudUnsubRef.current) {
        cloudUnsubRef.current();
        cloudUnsubRef.current = null;
      }

      const isRecentLocal = (collection: string, docId: string) => {
        const ts = recentLocalEditsRef.current.get(`${collection}:${docId}`);
        return typeof ts === 'number' && Date.now() - ts < 10_000;
      };

      const unsub = subscribeToUserWorkspace(uid, {
        onTasks: (remoteTasks, fromServer) => {
          if (!fromServer) return;
          const localTasks = currentWorkspaceRef.current.tasks;
          const localMap = new Map(localTasks.map((t) => [t.id, t]));
          const nextTasks: Task[] = [];
          const conflicts: SyncConflict[] = [];

          for (const rt of remoteTasks) {
            const lt = localMap.get(rt.id);
            if (
              lt &&
              isRecentLocal('tasks', rt.id) &&
              lt.updatedAt !== rt.updatedAt &&
              JSON.stringify(lt) !== JSON.stringify(rt)
            ) {
              conflicts.push({
                id: `conflict-tasks-${rt.id}`,
                collection: 'tasks',
                docId: rt.id,
                label: `Objective "${lt.name}"`,
                localUpdatedAt: lt.updatedAt,
                remoteUpdatedAt: rt.updatedAt,
                localPayload: lt,
                remotePayload: rt,
              });
              nextTasks.push(lt);
            } else {
              nextTasks.push(rt);
            }
          }

          if (conflicts.length > 0) {
            setSyncConflicts((prev) => {
              const map = new Map(prev.map((c) => [c.id, c]));
              for (const c of conflicts) map.set(c.id, c);
              return Array.from(map.values());
            });
          }

          if (JSON.stringify(localTasks) !== JSON.stringify(nextTasks)) {
            applyingRemoteRef.current = true;
            setTasks(nextTasks);
            if (lastPushedWorkspaceRef.current) {
              lastPushedWorkspaceRef.current = {
                ...lastPushedWorkspaceRef.current,
                tasks: nextTasks,
              };
            }
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 30);
          }
        },
        onSteps: (remoteSteps, fromServer) => {
          if (!fromServer) return;
          const localSteps = currentWorkspaceRef.current.steps;
          const localMap = new Map(localSteps.map((s) => [s.id, s]));
          const nextSteps: WBSStep[] = [];
          const conflicts: SyncConflict[] = [];

          for (const rs of remoteSteps) {
            const ls = localMap.get(rs.id);
            if (
              ls &&
              isRecentLocal('steps', rs.id) &&
              ls.updatedAt !== rs.updatedAt &&
              JSON.stringify(ls) !== JSON.stringify(rs)
            ) {
              conflicts.push({
                id: `conflict-steps-${rs.id}`,
                collection: 'steps',
                docId: rs.id,
                label: `Step "${ls.title}"`,
                localUpdatedAt: ls.updatedAt,
                remoteUpdatedAt: rs.updatedAt,
                localPayload: ls,
                remotePayload: rs,
              });
              nextSteps.push(ls);
            } else {
              nextSteps.push(rs);
            }
          }

          if (conflicts.length > 0) {
            setSyncConflicts((prev) => {
              const map = new Map(prev.map((c) => [c.id, c]));
              for (const c of conflicts) map.set(c.id, c);
              return Array.from(map.values());
            });
          }

          if (JSON.stringify(localSteps) !== JSON.stringify(nextSteps)) {
            applyingRemoteRef.current = true;
            setSteps(nextSteps);
            if (lastPushedWorkspaceRef.current) {
              lastPushedWorkspaceRef.current = {
                ...lastPushedWorkspaceRef.current,
                steps: nextSteps,
              };
            }
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 30);
          }
        },
        onBlocks: (remoteBlocks, fromServer) => {
          if (!fromServer) return;
          const localBlocks = currentWorkspaceRef.current.scheduledBlocks;
          if (JSON.stringify(localBlocks) !== JSON.stringify(remoteBlocks)) {
            applyingRemoteRef.current = true;
            setScheduledBlocks(remoteBlocks);
            if (lastPushedWorkspaceRef.current) {
              lastPushedWorkspaceRef.current = {
                ...lastPushedWorkspaceRef.current,
                scheduledBlocks: remoteBlocks,
              };
            }
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 30);
          }
        },
        onFixedActivities: (remoteFixed, fromServer) => {
          if (!fromServer) return;
          const localFixed = currentWorkspaceRef.current.fixedActivities;
          if (JSON.stringify(localFixed) !== JSON.stringify(remoteFixed)) {
            applyingRemoteRef.current = true;
            setFixedActivities(remoteFixed);
            if (lastPushedWorkspaceRef.current) {
              lastPushedWorkspaceRef.current = {
                ...lastPushedWorkspaceRef.current,
                fixedActivities: remoteFixed,
              };
            }
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 30);
          }
        },
        onPpcRecords: (remoteRecords, fromServer) => {
          if (!fromServer) return;
          for (const rec of remoteRecords) {
            if (rec.snapshot?.locked) remoteLockedPpcWeeksRef.current.add(rec.weekStart);
          }
          const localRecords = currentWorkspaceRef.current.ppcRecords;
          if (JSON.stringify(localRecords) !== JSON.stringify(remoteRecords)) {
            applyingRemoteRef.current = true;
            setPpcRecords(remoteRecords);
            if (lastPushedWorkspaceRef.current) {
              lastPushedWorkspaceRef.current = {
                ...lastPushedWorkspaceRef.current,
                ppcRecords: remoteRecords,
              };
            }
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 30);
          }
        },
        onCfdSnapshots: (remoteSnapshots, fromServer) => {
          if (!fromServer) return;
          for (const snap of remoteSnapshots) {
            if (snap.locked) remoteLockedCfdDatesRef.current.add(snap.date);
          }
          const localSnapshots = currentWorkspaceRef.current.cfdSnapshots;
          if (JSON.stringify(localSnapshots) !== JSON.stringify(remoteSnapshots)) {
            applyingRemoteRef.current = true;
            setCfdSnapshots(remoteSnapshots);
            if (lastPushedWorkspaceRef.current) {
              lastPushedWorkspaceRef.current = {
                ...lastPushedWorkspaceRef.current,
                cfdSnapshots: remoteSnapshots,
              };
            }
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 30);
          }
        },
        onScheduleVersions: (remoteVersions, fromServer) => {
          if (!fromServer) return;
          for (const v of remoteVersions) remoteVersionIdsRef.current.add(v.id);
          const localVersions = currentWorkspaceRef.current.scheduleVersions;
          if (JSON.stringify(localVersions) !== JSON.stringify(remoteVersions)) {
            applyingRemoteRef.current = true;
            setScheduleVersions(remoteVersions);
            if (lastPushedWorkspaceRef.current) {
              lastPushedWorkspaceRef.current = {
                ...lastPushedWorkspaceRef.current,
                scheduleVersions: remoteVersions,
              };
            }
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 30);
          }
        },
        onWorkCapacity: (remoteSettings, fromServer) => {
          if (!fromServer) return;
          const localCap = currentWorkspaceRef.current.workCapacity;
          if (JSON.stringify(localCap) !== JSON.stringify(remoteSettings)) {
            applyingRemoteRef.current = true;
            setWorkCapacity(remoteSettings);
            if (lastPushedWorkspaceRef.current) {
              lastPushedWorkspaceRef.current = {
                ...lastPushedWorkspaceRef.current,
                workCapacity: remoteSettings,
              };
            }
            window.setTimeout(() => {
              applyingRemoteRef.current = false;
            }, 30);
          }
        },
      });

      cloudUnsubRef.current = unsub;
    },
    []
  );

  // Firebase Auth listener
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        if (cloudUnsubRef.current) {
          cloudUnsubRef.current();
          cloudUnsubRef.current = null;
        }
        activeCloudUidRef.current = null;
        setCloudActiveUid(null);
        lastPushedWorkspaceRef.current = null;
        remoteLockedCfdDatesRef.current.clear();
        remoteLockedPpcWeeksRef.current.clear();
        remoteVersionIdsRef.current.clear();
        setPendingMigration(null);
        setSyncStatus('local');
        setSyncError(null);
        return;
      }

      // Wait briefly until IndexedDB hydration finishes
      let attempts = 0;
      while (!hydratedRef.current && attempts < 40) {
        await new Promise((r) => setTimeout(r, 50));
        attempts += 1;
      }

      try {
        setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        setSyncError(null);
        const cloudSnapshot = await fetchCloudWorkspaceSnapshot(nextUser.uid);
        remoteLockedCfdDatesRef.current = new Set(cloudSnapshot.lockedCfdDates);
        remoteLockedPpcWeeksRef.current = new Set(cloudSnapshot.lockedPpcWeeks);
        remoteVersionIdsRef.current = new Set(cloudSnapshot.existingVersionIds);

        const previouslyLinkedUid =
          typeof localStorage !== 'undefined' ? localStorage.getItem(CLOUD_UID_STORAGE_KEY) : null;

        if (previouslyLinkedUid === nextUser.uid && cloudSnapshot.hasUserProfile) {
          // Returning session for same account: attach cloud state smoothly without re-prompting migration
          const merged = mergeWorkspaces(currentWorkspaceRef.current, cloudSnapshot.workspace);
          applyWorkspaceLocally(merged);
          lastPushedWorkspaceRef.current = merged;
          activeCloudUidRef.current = nextUser.uid;
          setCloudActiveUid(nextUser.uid);
          attachCloudRealtimeListeners(nextUser.uid);
          setSyncStatus(navigator.onLine ? 'synced' : 'offline');
        } else {
          // Fresh sign-in: preview local vs cloud counts for explicit Merge / Replace / Keep Cloud decision
          setPendingMigration({
            user: nextUser,
            localCounts: summarizeWorkspace(currentWorkspaceRef.current),
            cloudCounts: summarizeWorkspace(cloudSnapshot.workspace),
            localWorkspace: currentWorkspaceRef.current,
            cloudSnapshot,
          });
          setSyncStatus('local');
        }
      } catch (err) {
        console.error('Auth/Cloud bootstrap error:', err);
        setSyncError(err instanceof Error ? err.message : 'Unable to connect to Cloud Firestore.');
        setSyncStatus('error');
      }
    });

    return () => {
      unsubAuth();
      if (cloudUnsubRef.current) {
        cloudUnsubRef.current();
        cloudUnsubRef.current = null;
      }
    };
  }, [applyWorkspaceLocally, attachCloudRealtimeListeners]);

  // Incremental Cloud Diff Sync whenever local state mutates while cloud session is active
  useEffect(() => {
    if (
      !hydratedRef.current ||
      !user ||
      !cloudActiveUid ||
      activeCloudUidRef.current !== user.uid ||
      applyingRemoteRef.current
    ) {
      return;
    }

    const nextSnapshot: PersistedWorkspace = {
      tasks,
      steps,
      scheduledBlocks,
      fixedActivities,
      ppcRecords,
      cfdSnapshots,
      scheduleVersions,
      workCapacity,
    };

    const prevSnapshot = lastPushedWorkspaceRef.current;
    if (!prevSnapshot) return;

    const timer = window.setTimeout(async () => {
      if (applyingRemoteRef.current || !activeCloudUidRef.current) return;
      try {
        setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        await syncDiffToCloud(
          user,
          prevSnapshot,
          nextSnapshot,
          remoteLockedCfdDatesRef.current,
          remoteLockedPpcWeeksRef.current,
          remoteVersionIdsRef.current
        );
        lastPushedWorkspaceRef.current = nextSnapshot;
        setSyncError(null);
        setSyncStatus(navigator.onLine ? 'synced' : 'offline');
      } catch (err) {
        console.error('Cloud sync failed:', err);
        setSyncError(err instanceof Error ? err.message : 'Cloud sync failed.');
        setSyncStatus('error');
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    user,
    cloudActiveUid,
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    ppcRecords,
    cfdSnapshots,
    scheduleVersions,
    workCapacity,
  ]);

  const signInWithGoogle = useCallback(async () => {
    setSyncError(null);
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOutUser = useCallback(async () => {
    if (cloudUnsubRef.current) {
      cloudUnsubRef.current();
      cloudUnsubRef.current = null;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CLOUD_UID_STORAGE_KEY);
    }
    activeCloudUidRef.current = null;
    setCloudActiveUid(null);
    lastPushedWorkspaceRef.current = null;
    setPendingMigration(null);
    setSyncConflicts([]);
    await signOut(auth);
  }, []);

  const resolveMigration = useCallback(
    async (strategy: 'merge' | 'replace_cloud' | 'keep_cloud') => {
      if (!pendingMigration) return;
      const { user: signedInUser, localWorkspace, cloudSnapshot } = pendingMigration;
      setSyncStatus('syncing');
      setSyncError(null);

      try {
        let finalWorkspace: PersistedWorkspace;
        if (strategy === 'merge') {
          finalWorkspace = mergeWorkspaces(localWorkspace, cloudSnapshot.workspace);
          await pushWorkspaceToCloud(signedInUser, finalWorkspace, {
            mode: 'upsert',
            cloudBaseline: cloudSnapshot,
          });
        } else if (strategy === 'replace_cloud') {
          finalWorkspace = localWorkspace;
          await pushWorkspaceToCloud(signedInUser, finalWorkspace, {
            mode: 'replace',
            cloudBaseline: cloudSnapshot,
          });
        } else {
          finalWorkspace = cloudSnapshot.workspace;
        }

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(CLOUD_UID_STORAGE_KEY, signedInUser.uid);
        }

        applyWorkspaceLocally(finalWorkspace);
        lastPushedWorkspaceRef.current = finalWorkspace;
        activeCloudUidRef.current = signedInUser.uid;
        setCloudActiveUid(signedInUser.uid);
        setPendingMigration(null);
        attachCloudRealtimeListeners(signedInUser.uid);
        setSyncStatus(navigator.onLine ? 'synced' : 'offline');
      } catch (err) {
        console.error('Migration failed:', err);
        setSyncError(err instanceof Error ? err.message : 'Failed to reconcile cloud data.');
        setSyncStatus('error');
      }
    },
    [pendingMigration, applyWorkspaceLocally, attachCloudRealtimeListeners]
  );

  const triggerManualReconcile = useCallback(async () => {
    if (!user) return;
    setSyncStatus('syncing');
    try {
      const cloudSnapshot = await fetchCloudWorkspaceSnapshot(user.uid);
      setPendingMigration({
        user,
        localCounts: summarizeWorkspace(currentWorkspaceRef.current),
        cloudCounts: summarizeWorkspace(cloudSnapshot.workspace),
        localWorkspace: currentWorkspaceRef.current,
        cloudSnapshot,
      });
      setSyncStatus(navigator.onLine ? 'synced' : 'offline');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to fetch cloud snapshot.');
      setSyncStatus('error');
    }
  }, [user]);

  const resolveConflict = useCallback((conflictId: string, resolution: 'local' | 'remote') => {
    setSyncConflicts((prev) => {
      const conflict = prev.find((c) => c.id === conflictId);
      if (!conflict) return prev;
      if (resolution === 'remote') {
        applyingRemoteRef.current = true;
        if (conflict.collection === 'tasks') {
          const remoteTask = conflict.remotePayload as Task;
          setTasks((cur) => cur.map((t) => (t.id === remoteTask.id ? remoteTask : t)));
        } else if (conflict.collection === 'steps') {
          const remoteStep = conflict.remotePayload as WBSStep;
          setSteps((cur) => cur.map((s) => (s.id === remoteStep.id ? remoteStep : s)));
        }
        window.setTimeout(() => {
          applyingRemoteRef.current = false;
        }, 40);
      } else {
        // Bump updatedAt locally so next sync pushes local winner cleanly
        const now = Date.now();
        if (conflict.collection === 'tasks') {
          setTasks((cur) =>
            cur.map((t) => (t.id === conflict.docId ? { ...t, updatedAt: now } : t))
          );
        } else if (conflict.collection === 'steps') {
          setSteps((cur) =>
            cur.map((s) => (s.id === conflict.docId ? { ...s, updatedAt: now } : s))
          );
        }
      }
      return prev.filter((c) => c.id !== conflictId);
    });
  }, []);

  // Keep live PPC snapshots updated for open weeks, locking past weeks once Sunday–Friday week ends (Saturday..Friday < todayStr)
  useEffect(() => {
    if (!hydratedRef.current || applyingRemoteRef.current) return;
    if (user && pendingMigration) return;

    const stepById = new Map(steps.map((s) => [s.id, s]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const weekStepsMap = new Map<string, Set<string>>();

    for (const blk of scheduledBlocks) {
      const ws = getStartOfWeek(blk.date);
      const set = weekStepsMap.get(ws) ?? new Set<string>();
      set.add(blk.stepId);
      weekStepsMap.set(ws, set);
    }

    if (weekStepsMap.size === 0) return;

    setPpcRecords((prev) => {
      const nextMap = new Map(prev.map((r) => [r.weekStart, r]));
      let changed = false;
      const now = Date.now();

      for (const [ws, stepIds] of weekStepsMap.entries()) {
        const existing = nextMap.get(ws);
        // Never overwrite locked historical snapshots so past values remain immutable!
        if (existing?.snapshot?.locked) continue;

        const completedItems: PPCItemSummary[] = [];
        const incompleteItems: PPCItemSummary[] = [];

        for (const sid of stepIds) {
          const st = stepById.get(sid);
          if (!st) continue;
          const tk = taskById.get(st.taskId);
          const summary: PPCItemSummary = {
            stepId: st.id,
            taskId: st.taskId,
            stepTitle: st.title,
            taskName: tk?.name ?? 'Objective',
            executionState: st.executionState,
            varianceReason: st.varianceReason || undefined,
          };
          if (st.completed) {
            completedItems.push(summary);
          } else {
            incompleteItems.push(summary);
          }
        }

        const plannedCount = completedItems.length + incompleteItems.length;
        const completedCount = completedItems.length;
        const ppcPercent = plannedCount > 0 ? Math.round((completedCount / plannedCount) * 100) : 0;
        const shouldLock = addDays(ws, 6) < todayStr;

        const snapChanged =
          !existing?.snapshot ||
          existing.snapshot.plannedCount !== plannedCount ||
          existing.snapshot.completedCount !== completedCount ||
          existing.snapshot.ppcPercent !== ppcPercent ||
          existing.snapshot.locked !== shouldLock ||
          JSON.stringify(existing.snapshot.completedItems) !== JSON.stringify(completedItems) ||
          JSON.stringify(existing.snapshot.incompleteItems) !== JSON.stringify(incompleteItems);

        if (snapChanged) {
          nextMap.set(ws, {
            weekStart: ws,
            reasonsForVariance: existing?.reasonsForVariance ?? '',
            stepVariances: existing?.stepVariances ?? [],
            snapshot: {
              plannedCount,
              completedCount,
              ppcPercent,
              completedItems,
              incompleteItems,
              locked: shouldLock,
              updatedAt: now,
            },
            updatedAt: now,
          });
          changed = true;
        }
      }

      return changed ? Array.from(nextMap.values()) : prev;
    });
  }, [scheduledBlocks, steps, tasks, todayStr, user, pendingMigration]);

  // Maintain Cumulative Flow Diagram (CFD) daily snapshots: freeze past dates (< todayStr), update todayStr live
  useEffect(() => {
    if (!hydratedRef.current || applyingRemoteRef.current) return;
    if (user && pendingMigration) return;

    const notStarted = steps.filter((s) => !s.completed && s.flowStatus === 'not_started').length;
    const inProgress = steps.filter((s) => !s.completed && s.flowStatus === 'in_progress').length;
    const completed = steps.filter((s) => s.completed || s.flowStatus === 'completed').length;
    const total = steps.length;

    setCfdSnapshots((prev) => {
      let changed = false;
      const now = Date.now();
      const map = new Map<string, DailyCFDSnapshot>();

      for (const snap of prev) {
        if (snap.date < todayStr && !snap.locked) {
          map.set(snap.date, { ...snap, locked: true, updatedAt: snap.updatedAt || now });
          changed = true;
        } else {
          map.set(snap.date, snap);
        }
      }

      const todaySnap = map.get(todayStr);
      if (
        !todaySnap ||
        todaySnap.notStarted !== notStarted ||
        todaySnap.inProgress !== inProgress ||
        todaySnap.completed !== completed ||
        todaySnap.total !== total ||
        todaySnap.locked
      ) {
        map.set(todayStr, {
          date: todayStr,
          notStarted,
          inProgress,
          completed,
          total,
          locked: false,
          updatedAt: now,
        });
        changed = true;
      }

      if (!changed) return prev;
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    });
  }, [steps, todayStr, user, pendingMigration]);

  const openTaskInWBS = useCallback((taskId: string) => {
    setSelectedWbsTaskId(taskId);
    setActiveTab('wbs');
  }, []);

  const goToPrevWeek = useCallback(() => {
    setDisplayedWeekStart((prev) => addDays(prev, -7));
  }, []);

  const goToNextWeek = useCallback(() => {
    setDisplayedWeekStart((prev) => addDays(prev, 7));
  }, []);

  const goToCurrentWeek = useCallback(() => {
    const current = getTodayDateString();
    setTodayStr(current);
    setDisplayedWeekStart(getStartOfWeek(current));
  }, []);

  const createTask = useCallback(
    (input: {
      name: string;
      description: string;
      deadline: string;
      deadlines?: TaskDeadline[];
      status: TaskStatus;
      colorId?: string;
      responsibility?: Responsibility;
      valueCategory?: ValueCategory;
    }): Task => {
      const now = Date.now();
      const taskId = generateId('task');
      const normalizedDeadlines: TaskDeadline[] =
        input.deadlines && input.deadlines.length > 0
          ? [...input.deadlines].sort((a, b) => a.date.localeCompare(b.date))
          : [{ id: generateId('dl'), date: input.deadline, label: 'Target' }];
      const primaryDeadline = getPrimaryDeadline(normalizedDeadlines, input.deadline);

      let createdTask!: Task;
      setTasks((prev) => {
        const chosenColor = input.colorId || pickNextAvailableColorId(prev.map((t) => t.colorId));
        createdTask = {
          id: taskId,
          name: input.name.trim(),
          description: input.description.trim(),
          deadline: primaryDeadline,
          deadlines: normalizedDeadlines,
          status: input.status,
          colorId: chosenColor,
          responsibility: input.responsibility ?? 'Me',
          valueCategory: input.valueCategory ?? 'VA',
          createdAt: now,
          updatedAt: now,
        };
        return [...prev, createdTask];
      });
      markLocalEdit('tasks', taskId);
      setSelectedWbsTaskId((prevId) => prevId ?? taskId);
      return createdTask;
    },
    [markLocalEdit]
  );

  const updateTask = useCallback(
    (
      taskId: string,
      patch: Partial<
        Pick<
          Task,
          | 'name'
          | 'description'
          | 'deadline'
          | 'deadlines'
          | 'status'
          | 'colorId'
          | 'responsibility'
          | 'valueCategory'
        >
      >
    ) => {
      markLocalEdit('tasks', taskId);
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;

          let nextDeadlines = t.deadlines;
          if (patch.deadlines && patch.deadlines.length > 0) {
            nextDeadlines = [...patch.deadlines].sort((a, b) => a.date.localeCompare(b.date));
          } else if (patch.deadline !== undefined) {
            const currentSorted = [...(t.deadlines ?? [])].sort((a, b) =>
              a.date.localeCompare(b.date)
            );
            if (currentSorted.length === 0) {
              nextDeadlines = [{ id: `${t.id}-dl-0`, date: patch.deadline, label: 'Target' }];
            } else {
              currentSorted[0] = { ...currentSorted[0], date: patch.deadline };
              nextDeadlines = currentSorted.sort((a, b) => a.date.localeCompare(b.date));
            }
          }

          const nextPrimary = getPrimaryDeadline(
            nextDeadlines,
            patch.deadline ?? t.deadline
          );

          return {
            ...t,
            ...patch,
            deadlines: nextDeadlines,
            deadline: nextPrimary,
            name: patch.name !== undefined ? patch.name.trim() : t.name,
            description: patch.description !== undefined ? patch.description.trim() : t.description,
            updatedAt: Date.now(),
          };
        })
      );
    },
    [markLocalEdit]
  );

  const deleteTaskCascade = useCallback(
    (taskId: string) => {
      const removedStepIds = new Set(steps.filter((s) => s.taskId === taskId).map((s) => s.id));
      const now = Date.now();

      setTasks((prev) => {
        const remaining = prev.filter((t) => t.id !== taskId);
        setSelectedWbsTaskId((currentId) => {
          if (currentId !== taskId) return currentId;
          if (remaining.length === 0) return null;
          return [...remaining].sort((a, b) => a.deadline.localeCompare(b.deadline))[0].id;
        });
        return remaining;
      });
      setSteps((prev) =>
        prev
          .filter((s) => s.taskId !== taskId)
          .map((s) => {
            const filtered = s.dependsOnStepIds.filter((d) => !removedStepIds.has(d));
            return filtered.length !== s.dependsOnStepIds.length
              ? { ...s, dependsOnStepIds: filtered, updatedAt: now }
              : s;
          })
      );
      setScheduledBlocks((prev) => prev.filter((b) => b.taskId !== taskId));
      setFixedActivities((prev) =>
        prev.map((fa) => {
          const nextLinked = fa.linkedStepIds.filter((id) => !removedStepIds.has(id));
          return nextLinked.length !== fa.linkedStepIds.length
            ? { ...fa, linkedStepIds: nextLinked, updatedAt: now }
            : fa;
        })
      );
    },
    [steps]
  );

  const createStep = useCallback(
    (input: {
      taskId: string;
      title: string;
      notes?: string;
      estimatedMinutes?: number;
      responsibility?: Responsibility;
      dependsOnStepIds?: string[];
      valueCategory?: ValueCategory;
    }): WBSStep => {
      const parentTask = tasks.find((t) => t.id === input.taskId);
      const now = Date.now();
      const stepId = generateId('step');
      let newStep!: WBSStep;
      setSteps((prev) => {
        const siblings = prev.filter((s) => s.taskId === input.taskId);
        const maxOrder = siblings.reduce((max, s) => Math.max(max, s.order), -1);
        newStep = {
          id: stepId,
          taskId: input.taskId,
          title: input.title.trim(),
          notes: (input.notes ?? '').trim(),
          order: maxOrder + 1,
          estimatedMinutes: input.estimatedMinutes ?? 60,
          completed: false,
          executionState: 'not_done',
          flowStatus: 'not_started',
          varianceReason: '',
          responsibility: input.responsibility ?? parentTask?.responsibility ?? 'Me',
          dependsOnStepIds: input.dependsOnStepIds ?? [],
          valueCategory: input.valueCategory ?? parentTask?.valueCategory ?? 'VA',
          createdAt: now,
          updatedAt: now,
        };
        return [...prev, newStep];
      });
      markLocalEdit('steps', stepId);
      return newStep;
    },
    [tasks, markLocalEdit]
  );

  const promoteTaskIfTodo = useCallback(
    (taskId: string) => {
      const now = Date.now();
      setTasks((prevTasks) =>
        prevTasks.map((t) => {
          if (t.id === taskId && t.status === 'todo') {
            markLocalEdit('tasks', t.id);
            return { ...t, status: 'in_progress', updatedAt: now };
          }
          return t;
        })
      );
    },
    [markLocalEdit]
  );

  const updateStep = useCallback(
    (
      stepId: string,
      patch: Partial<
        Pick<
          WBSStep,
          | 'title'
          | 'notes'
          | 'estimatedMinutes'
          | 'completed'
          | 'executionState'
          | 'flowStatus'
          | 'varianceReason'
          | 'responsibility'
          | 'dependsOnStepIds'
          | 'valueCategory'
        >
      >
    ) => {
      const targetStep = steps.find((s) => s.id === stepId);
      if (!targetStep) return;

      let safeDeps = patch.dependsOnStepIds;
      if (safeDeps) {
        safeDeps = safeDeps.filter((depId) => !hasDependencyCycle(steps, stepId, depId));
      }

      const now = Date.now();
      markLocalEdit('steps', stepId);

      const hasScheduledPlacement =
        scheduledBlocks.some((b) => b.stepId === stepId) ||
        fixedActivities.some((fa) => fa.linkedStepIds.includes(stepId));

      let nextExecutionState: StepExecutionState = targetStep.executionState;
      if (patch.executionState !== undefined) {
        nextExecutionState = patch.executionState;
      } else if (patch.completed !== undefined) {
        nextExecutionState = patch.completed
          ? targetStep.executionState === 'done_variance'
            ? 'done_variance'
            : 'done_expected'
          : 'not_done';
      }

      const nextCompleted = nextExecutionState !== 'not_done';
      let nextFlowStatus: StepFlowStatus;
      if (nextCompleted) {
        nextFlowStatus = 'completed';
      } else if (patch.flowStatus === 'in_progress' || patch.flowStatus === 'not_started') {
        nextFlowStatus = patch.flowStatus;
      } else if (targetStep.flowStatus === 'completed') {
        nextFlowStatus = hasScheduledPlacement ? 'in_progress' : 'not_started';
      } else {
        nextFlowStatus = targetStep.flowStatus;
      }

      const nextVarianceReason =
        patch.varianceReason !== undefined
          ? patch.varianceReason
          : nextExecutionState === 'done_expected'
          ? ''
          : targetStep.varianceReason;

      setSteps((prev) =>
        prev.map((s) =>
          s.id === stepId
            ? {
                ...s,
                ...patch,
                dependsOnStepIds: safeDeps !== undefined ? safeDeps : s.dependsOnStepIds,
                title: patch.title !== undefined ? patch.title.trim() : s.title,
                notes: patch.notes !== undefined ? patch.notes.trim() : s.notes,
                completed: nextCompleted,
                executionState: nextExecutionState,
                flowStatus: nextFlowStatus,
                varianceReason: nextVarianceReason,
                completedAt: nextCompleted ? s.completedAt ?? now : undefined,
                updatedAt: now,
              }
            : s
        )
      );

      if (nextCompleted || nextFlowStatus === 'in_progress') {
        promoteTaskIfTodo(targetStep.taskId);
      }
    },
    [steps, scheduledBlocks, fixedActivities, markLocalEdit, promoteTaskIfTodo]
  );

  const updateStepVariance = useCallback(
    (weekStart: string, stepId: string, reason: string) => {
      const now = Date.now();
      const targetStep = steps.find((s) => s.id === stepId);
      const taskName = targetStep
        ? tasks.find((t) => t.id === targetStep.taskId)?.name ?? 'Objective'
        : 'Objective';

      if (targetStep) {
        markLocalEdit('steps', stepId);
        setSteps((prev) =>
          prev.map((s) =>
            s.id === stepId ? { ...s, varianceReason: reason, updatedAt: now } : s
          )
        );
      }

      setPpcRecords((prev) => {
        const existing = prev.find((r) => r.weekStart === weekStart);
        const trimmed = reason.trim();
        const existingEntries = existing?.stepVariances ?? [];
        const filteredEntries = existingEntries.filter((e) => e.stepId !== stepId);
        const nextEntries = trimmed
          ? [
              ...filteredEntries,
              {
                stepId,
                stepTitle: targetStep?.title ?? 'Step',
                taskName,
                reason: trimmed,
              },
            ]
          : filteredEntries;

        if (!existing) {
          return [
            ...prev,
            {
              weekStart,
              reasonsForVariance: '',
              stepVariances: nextEntries,
              updatedAt: now,
            },
          ];
        }
        return prev.map((r) =>
          r.weekStart === weekStart
            ? { ...r, stepVariances: nextEntries, updatedAt: now }
            : r
        );
      });
    },
    [steps, tasks, markLocalEdit]
  );

  const setStepExecutionState = useCallback(
    (
      stepId: string,
      executionState: StepExecutionState,
      varianceReason?: string,
      weekStartOverride?: string
    ) => {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;

      updateStep(stepId, {
        executionState,
        completed: executionState !== 'not_done',
        varianceReason:
          executionState === 'done_variance'
            ? varianceReason ?? step.varianceReason
            : executionState === 'done_expected'
            ? ''
            : step.varianceReason,
      });

      const targetWeek =
        weekStartOverride ??
        (() => {
          const blk = scheduledBlocks.find((b) => b.stepId === stepId);
          if (blk) return getStartOfWeek(blk.date);
          const fa = fixedActivities.find((f) => f.linkedStepIds.includes(stepId));
          if (fa) return getStartOfWeek(fa.date);
          return displayedWeekStart;
        })();

      if (executionState === 'done_variance' && varianceReason !== undefined) {
        updateStepVariance(targetWeek, stepId, varianceReason);
      } else if (executionState === 'done_expected') {
        updateStepVariance(targetWeek, stepId, '');
      }
    },
    [
      steps,
      scheduledBlocks,
      fixedActivities,
      displayedWeekStart,
      updateStep,
      updateStepVariance,
    ]
  );

  const toggleStepInProgress = useCallback(
    (stepId: string) => {
      const step = steps.find((s) => s.id === stepId);
      if (!step || step.completed) return;
      const nextFlow: StepFlowStatus =
        step.flowStatus === 'in_progress' ? 'not_started' : 'in_progress';
      updateStep(stepId, { flowStatus: nextFlow });
    },
    [steps, updateStep]
  );

  const deleteStepCascade = useCallback((stepId: string) => {
    const now = Date.now();
    setSteps((prev) => {
      const target = prev.find((s) => s.id === stepId);
      const remaining = prev
        .filter((s) => s.id !== stepId)
        .map((s) =>
          s.dependsOnStepIds.includes(stepId)
            ? {
                ...s,
                dependsOnStepIds: s.dependsOnStepIds.filter((d) => d !== stepId),
                updatedAt: now,
              }
            : s
        );
      if (!target) return remaining;
      const siblingIds = remaining
        .filter((s) => s.taskId === target.taskId)
        .sort((a, b) => a.order - b.order)
        .map((s) => s.id);
      const orderMap = new Map<string, number>();
      siblingIds.forEach((id, idx) => orderMap.set(id, idx));
      return remaining.map((s) =>
        orderMap.has(s.id) && s.order !== orderMap.get(s.id)
          ? { ...s, order: orderMap.get(s.id)!, updatedAt: now }
          : s
      );
    });
    setScheduledBlocks((prev) => prev.filter((b) => b.stepId !== stepId));
    setFixedActivities((prev) =>
      prev.map((fa) =>
        fa.linkedStepIds.includes(stepId)
          ? {
              ...fa,
              linkedStepIds: fa.linkedStepIds.filter((id) => id !== stepId),
              updatedAt: now,
            }
          : fa
      )
    );
  }, []);

  const reorderTaskSteps = useCallback((taskId: string, orderedStepIds: string[]) => {
    const orderMap = new Map<string, number>();
    orderedStepIds.forEach((id, idx) => orderMap.set(id, idx));
    const now = Date.now();
    setSteps((prev) =>
      prev.map((s) => {
        if (s.taskId === taskId && orderMap.has(s.id)) {
          return { ...s, order: orderMap.get(s.id)!, updatedAt: now };
        }
        return s;
      })
    );
  }, []);

  const splitStepIntoTwo = useCallback(
    (input: {
      stepId: string;
      part1Title: string;
      part1Minutes: number;
      part2Title: string;
      part2Minutes: number;
    }) => {
      const orig = steps.find((s) => s.id === input.stepId);
      if (!orig) return;

      const part2Id = generateId('step');
      const now = Date.now();
      markLocalEdit('steps', orig.id);
      markLocalEdit('steps', part2Id);

      setSteps((prev) => {
        const taskSiblings = prev
          .filter((s) => s.taskId === orig.taskId)
          .sort((a, b) => a.order - b.order);
        const origIndex = taskSiblings.findIndex((s) => s.id === orig.id);

        const part1: WBSStep = {
          ...orig,
          title: input.part1Title.trim() || `${orig.title} (Part 1)`,
          estimatedMinutes: Math.max(30, input.part1Minutes),
          updatedAt: now,
        };

        const part2: WBSStep = {
          id: part2Id,
          taskId: orig.taskId,
          title: input.part2Title.trim() || `${orig.title} (Part 2)`,
          notes: orig.notes,
          order: origIndex + 1,
          estimatedMinutes: Math.max(30, input.part2Minutes),
          completed: false,
          executionState: 'not_done',
          flowStatus: 'not_started',
          varianceReason: '',
          responsibility: orig.responsibility,
          dependsOnStepIds: [orig.id],
          valueCategory: orig.valueCategory,
          createdAt: now,
          updatedAt: now,
        };

        const updated = prev.map((s) => {
          if (s.id === orig.id) return part1;
          const nextDeps = s.dependsOnStepIds.includes(orig.id)
            ? s.dependsOnStepIds.map((d) => (d === orig.id ? part2Id : d))
            : s.dependsOnStepIds;
          if (s.taskId === orig.taskId && s.order > orig.order) {
            return { ...s, order: s.order + 1, dependsOnStepIds: nextDeps, updatedAt: now };
          }
          return nextDeps !== s.dependsOnStepIds
            ? { ...s, dependsOnStepIds: nextDeps, updatedAt: now }
            : s;
        });

        return [...updated, part2];
      });

      setScheduledBlocks((prev) =>
        prev.map((b) =>
          b.stepId === orig.id
            ? { ...b, durationMinutes: Math.max(30, input.part1Minutes), updatedAt: now }
            : b
        )
      );
    },
    [steps, markLocalEdit]
  );

  const scheduleStep = useCallback(
    (input: {
      stepId: string;
      taskId: string;
      date: string;
      startMinutes: number;
      durationMinutes: number;
    }): ScheduledBlock => {
      const now = Date.now();
      const block: ScheduledBlock = {
        id: generateId('block'),
        stepId: input.stepId,
        taskId: input.taskId,
        date: input.date,
        startMinutes: input.startMinutes,
        durationMinutes: Math.max(30, input.durationMinutes),
        updatedAt: now,
      };
      setScheduledBlocks((prev) => [...prev, block]);

      // Auto-transition uncompleted Not Started step into In Progress for CFD tracking
      setSteps((prev) =>
        prev.map((s) => {
          if (s.id === input.stepId && !s.completed && s.flowStatus === 'not_started') {
            markLocalEdit('steps', s.id);
            return { ...s, flowStatus: 'in_progress', updatedAt: now };
          }
          return s;
        })
      );
      promoteTaskIfTodo(input.taskId);
      return block;
    },
    [markLocalEdit, promoteTaskIfTodo]
  );

  const updateScheduledBlock = useCallback(
    (
      blockId: string,
      patch: Partial<Pick<ScheduledBlock, 'date' | 'startMinutes' | 'durationMinutes'>>
    ) => {
      const now = Date.now();
      setScheduledBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, ...patch, updatedAt: now } : b))
      );
    },
    []
  );

  const unscheduleBlock = useCallback((blockId: string) => {
    setScheduledBlocks((prev) => prev.filter((b) => b.id !== blockId));
  }, []);

  const createFixedActivity = useCallback(
    (input: {
      title: string;
      kind: FixedActivityKind;
      daysOfWeek: number[];
      startMinutes: number;
      endMinutes: number;
      recurrence: RecurrenceFrequency;
      startDate: string;
      endDate?: string;
      countsAsWorkingTime: boolean;
      valueCategory: ValueCategory;
    }): FixedActivity[] => {
      const now = Date.now();
      const dates = expandFixedActivityDates({
        startDate: input.startDate,
        endDate: input.endDate,
        recurrence: input.recurrence,
        daysOfWeek: input.daysOfWeek,
      });

      const batchSeriesId = dates.length > 1 ? generateId('series') : undefined;
      const endMin = Math.max(input.startMinutes + 30, input.endMinutes);
      const createdList: FixedActivity[] = dates.map((dateStr) => ({
        id: generateId('fixed'),
        title: input.title.trim(),
        kind: input.kind,
        date: dateStr,
        startMinutes: input.startMinutes,
        endMinutes: endMin,
        countsAsWorkingTime: input.countsAsWorkingTime,
        valueCategory: input.valueCategory,
        linkedStepIds: [],
        seriesId: batchSeriesId,
        createdAt: now,
        updatedAt: now,
      }));

      setFixedActivities((prev) => [...prev, ...createdList]);
      return createdList;
    },
    []
  );

  const updateFixedActivity = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          FixedActivity,
          | 'title'
          | 'kind'
          | 'date'
          | 'startMinutes'
          | 'endMinutes'
          | 'countsAsWorkingTime'
          | 'valueCategory'
        >
      >
    ) => {
      const now = Date.now();
      setFixedActivities((prev) =>
        prev.map((fa) =>
          fa.id === id
            ? {
                ...fa,
                ...patch,
                title: patch.title !== undefined ? patch.title.trim() : fa.title,
                updatedAt: now,
              }
            : fa
        )
      );
    },
    []
  );

  const deleteFixedActivity = useCallback((id: string) => {
    setFixedActivities((prev) => prev.filter((fa) => fa.id !== id));
  }, []);

  const linkStepToFixedActivity = useCallback(
    (fixedActivityId: string, stepId: string) => {
      const now = Date.now();
      setFixedActivities((prev) =>
        prev.map((fa) =>
          fa.id === fixedActivityId && !fa.linkedStepIds.includes(stepId)
            ? { ...fa, linkedStepIds: [...fa.linkedStepIds, stepId], updatedAt: now }
            : fa
        )
      );

      // Auto-transition uncompleted Not Started step into In Progress on link
      const linkedStep = steps.find((s) => s.id === stepId);
      if (linkedStep && !linkedStep.completed && linkedStep.flowStatus === 'not_started') {
        markLocalEdit('steps', stepId);
        setSteps((prev) =>
          prev.map((s) =>
            s.id === stepId ? { ...s, flowStatus: 'in_progress', updatedAt: now } : s
          )
        );
      }
      if (linkedStep) {
        promoteTaskIfTodo(linkedStep.taskId);
      }
    },
    [steps, markLocalEdit, promoteTaskIfTodo]
  );

  const unlinkStepFromFixedActivity = useCallback((fixedActivityId: string, stepId: string) => {
    const now = Date.now();
    setFixedActivities((prev) =>
      prev.map((fa) =>
        fa.id === fixedActivityId
          ? {
              ...fa,
              linkedStepIds: fa.linkedStepIds.filter((id) => id !== stepId),
              updatedAt: now,
            }
          : fa
      )
    );
  }, []);

  const updateWorkCapacity = useCallback((patch: Partial<WorkCapacitySettings>) => {
    setWorkCapacity((prev) => ({ ...prev, ...patch, updatedAt: Date.now() }));
  }, []);

  const updateWeekVarianceReason = useCallback((weekStart: string, reason: string) => {
    const now = Date.now();
    setPpcRecords((prev) => {
      const idx = prev.findIndex((r) => r.weekStart === weekStart);
      if (idx === -1) {
        return [
          ...prev,
          { weekStart, reasonsForVariance: reason, stepVariances: [], updatedAt: now },
        ];
      }
      return prev.map((r) =>
        r.weekStart === weekStart ? { ...r, reasonsForVariance: reason, updatedAt: now } : r
      );
    });
  }, []);

  const applyProposedWeekSchedule = useCallback(
    (weekStart: string, proposedWeekBlocks: ScheduledBlock[], label?: string) => {
      const weekDaySet = new Set(getWeekDays(weekStart));
      const now = Date.now();
      const snapshotVersion: ScheduleVersion = {
        id: generateId('ver'),
        createdAt: now,
        label: label || `Before AI Schedule (${weekStart})`,
        weekStart,
        blocks: scheduledBlocks.map((b) => ({ ...b })),
      };
      setScheduleVersions((prev) => [snapshotVersion, ...prev].slice(0, 20));

      setScheduledBlocks((prev) => [
        ...prev.filter((b) => !weekDaySet.has(b.date)),
        ...proposedWeekBlocks.map((b) => ({ ...b, updatedAt: now })),
      ]);

      const placedStepIds = new Set(proposedWeekBlocks.map((b) => b.stepId));
      const touchedTaskIds = new Set(proposedWeekBlocks.map((b) => b.taskId));
      setSteps((prev) =>
        prev.map((s) =>
          placedStepIds.has(s.id) && !s.completed && s.flowStatus === 'not_started'
            ? { ...s, flowStatus: 'in_progress', updatedAt: now }
            : s
        )
      );
      setTasks((prev) =>
        prev.map((t) =>
          touchedTaskIds.has(t.id) && t.status === 'todo'
            ? { ...t, status: 'in_progress', updatedAt: now }
            : t
        )
      );
    },
    [scheduledBlocks]
  );

  const restoreScheduleVersion = useCallback(
    (versionId: string) => {
      const target = scheduleVersions.find((v) => v.id === versionId);
      if (!target) return;
      const now = Date.now();
      const currentCheckpoint: ScheduleVersion = {
        id: generateId('ver'),
        createdAt: now,
        label: `Checkpoint before restoring (${target.weekStart})`,
        weekStart: target.weekStart,
        blocks: scheduledBlocks.map((b) => ({ ...b })),
      };
      setScheduledBlocks(target.blocks.map((b) => ({ ...b, updatedAt: now })));
      setScheduleVersions((prev) => [currentCheckpoint, ...prev].slice(0, 20));
    },
    [scheduleVersions, scheduledBlocks]
  );

  const undoLastScheduleChange = useCallback(() => {
    if (scheduleVersions.length === 0) return;
    const [latest, ...rest] = scheduleVersions;
    const now = Date.now();
    setScheduledBlocks(latest.blocks.map((b) => ({ ...b, updatedAt: now })));
    setScheduleVersions(rest);
  }, [scheduleVersions]);

  const exportWorkspaceJson = useCallback(() => {
    const payload: AppDataExport = {
      version: 3,
      exportedAt: new Date().toISOString(),
      tasks,
      steps,
      scheduledBlocks,
      fixedActivities,
      ppcRecords,
      cfdSnapshots,
      scheduleVersions,
      workCapacity,
    };
    return JSON.stringify(payload, null, 2);
  }, [
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    ppcRecords,
    cfdSnapshots,
    scheduleVersions,
    workCapacity,
  ]);

  const replaceWorkspace = useCallback((data: PersistedWorkspace) => {
    setTasks(data.tasks);
    setSteps(data.steps);
    setScheduledBlocks(data.scheduledBlocks);
    setFixedActivities(data.fixedActivities);
    setPpcRecords(data.ppcRecords);
    setCfdSnapshots(data.cfdSnapshots);
    setScheduleVersions(data.scheduleVersions);
    setWorkCapacity(data.workCapacity);

    if (data.tasks.length > 0) {
      const sorted = [...data.tasks].sort((a, b) => a.deadline.localeCompare(b.deadline));
      setSelectedWbsTaskId(sorted[0].id);
    } else {
      setSelectedWbsTaskId(null);
    }
  }, []);

  const loadSampleData = useCallback(() => {
    const sample = createSampleWorkspace(getTodayDateString());
    replaceWorkspace(sample);
  }, [replaceWorkspace]);

  const clearAllData = useCallback(() => {
    setTasks([]);
    setSteps([]);
    setScheduledBlocks([]);
    setFixedActivities([]);
    setPpcRecords([]);
    setCfdSnapshots([]);
    setScheduleVersions([]);
    setWorkCapacity(DEFAULT_WORK_CAPACITY);
    setSelectedWbsTaskId(null);
  }, []);

  const value = useMemo<AppStateContextValue>(
    () => ({
      isLoading,
      storageError,
      todayStr,
      activeTab,
      setActiveTab,
      selectedWbsTaskId,
      setSelectedWbsTaskId,
      openTaskInWBS,
      displayedWeekStart,
      setDisplayedWeekStart,
      goToPrevWeek,
      goToNextWeek,
      goToCurrentWeek,
      user,
      authReady,
      syncStatus,
      syncError,
      pendingMigration,
      syncConflicts,
      signInWithGoogle,
      signOutUser,
      resolveMigration,
      resolveConflict,
      triggerManualReconcile,
      tasks,
      steps,
      scheduledBlocks,
      fixedActivities,
      ppcRecords,
      cfdSnapshots,
      scheduleVersions,
      workCapacity,
      createTask,
      updateTask,
      deleteTaskCascade,
      createStep,
      updateStep,
      setStepExecutionState,
      toggleStepInProgress,
      deleteStepCascade,
      reorderTaskSteps,
      splitStepIntoTwo,
      scheduleStep,
      updateScheduledBlock,
      unscheduleBlock,
      createFixedActivity,
      updateFixedActivity,
      deleteFixedActivity,
      linkStepToFixedActivity,
      unlinkStepFromFixedActivity,
      updateWorkCapacity,
      updateWeekVarianceReason,
      updateStepVariance,
      applyProposedWeekSchedule,
      restoreScheduleVersion,
      undoLastScheduleChange,
      exportWorkspaceJson,
      replaceWorkspace,
      loadSampleData,
      clearAllData,
    }),
    [
      isLoading,
      storageError,
      todayStr,
      activeTab,
      selectedWbsTaskId,
      openTaskInWBS,
      displayedWeekStart,
      goToPrevWeek,
      goToNextWeek,
      goToCurrentWeek,
      user,
      authReady,
      syncStatus,
      syncError,
      pendingMigration,
      syncConflicts,
      signInWithGoogle,
      signOutUser,
      resolveMigration,
      resolveConflict,
      triggerManualReconcile,
      tasks,
      steps,
      scheduledBlocks,
      fixedActivities,
      ppcRecords,
      cfdSnapshots,
      scheduleVersions,
      workCapacity,
      createTask,
      updateTask,
      deleteTaskCascade,
      createStep,
      updateStep,
      setStepExecutionState,
      toggleStepInProgress,
      deleteStepCascade,
      reorderTaskSteps,
      splitStepIntoTwo,
      scheduleStep,
      updateScheduledBlock,
      unscheduleBlock,
      createFixedActivity,
      updateFixedActivity,
      deleteFixedActivity,
      linkStepToFixedActivity,
      unlinkStepFromFixedActivity,
      updateWorkCapacity,
      updateWeekVarianceReason,
      updateStepVariance,
      applyProposedWeekSchedule,
      restoreScheduleVersion,
      undoLastScheduleChange,
      exportWorkspaceJson,
      replaceWorkspace,
      loadSampleData,
      clearAllData,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
