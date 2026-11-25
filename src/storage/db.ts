import {
  AppDataExport,
  DailyCFDSnapshot,
  FixedActivity,
  FixedActivityKind,
  LegacyFixedActivityTemplate,
  RecurrenceFrequency,
  Responsibility,
  ScheduledBlock,
  ScheduleVersion,
  StepExecutionState,
  StepFlowStatus,
  Task,
  TaskDeadline,
  ValueCategory,
  WBSStep,
  WeeklyPPCRecord,
  WorkCapacitySettings,
} from '../types';
import {
  addDays,
  getPrimaryDeadline,
  getStartOfWeek,
  getTodayDateString,
  isValidDateString,
} from '../utils/dateUtils';
import { PASTEL_PALETTE } from '../utils/colors';
import { DEFAULT_WORK_CAPACITY, expandFixedActivityDates } from '../utils/schedulingUtils';

const DB_NAME = 'takt_lean_planner_db';
const DB_VERSION = 3;

const STORES = {
  TASKS: 'tasks',
  STEPS: 'steps',
  BLOCKS: 'scheduledBlocks',
  FIXED: 'fixedActivities',
  PPC: 'ppcRecords',
  CFD: 'cfdSnapshots',
  VERSIONS: 'scheduleVersions',
  META: 'meta',
} as const;

export interface PersistedWorkspace {
  tasks: Task[];
  steps: WBSStep[];
  scheduledBlocks: ScheduledBlock[];
  fixedActivities: FixedActivity[];
  ppcRecords: WeeklyPPCRecord[];
  cfdSnapshots: DailyCFDSnapshot[];
  scheduleVersions: ScheduleVersion[];
  workCapacity: WorkCapacitySettings;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.TASKS)) {
        db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.STEPS)) {
        db.createObjectStore(STORES.STEPS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.BLOCKS)) {
        db.createObjectStore(STORES.BLOCKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.FIXED)) {
        db.createObjectStore(STORES.FIXED, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.PPC)) {
        db.createObjectStore(STORES.PPC, { keyPath: 'weekStart' });
      }
      if (!db.objectStoreNames.contains(STORES.CFD)) {
        db.createObjectStore(STORES.CFD, { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains(STORES.VERSIONS)) {
        db.createObjectStore(STORES.VERSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

function getMetaValue(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.META, 'readonly');
    const req = tx.objectStore(STORES.META).get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}

export function normalizeTask(raw: Partial<Task> & { id: string; name: string }): Task {
  const now = Date.now();
  const rawDeadlines = Array.isArray(raw.deadlines)
    ? raw.deadlines
        .filter((d): d is TaskDeadline => Boolean(d && typeof d.date === 'string' && isValidDateString(d.date)))
        .map((d, idx) => ({
          id: typeof d.id === 'string' && d.id ? d.id : `${raw.id}-dl-${idx}`,
          date: d.date,
          label: typeof d.label === 'string' ? d.label.slice(0, 48) : undefined,
        }))
    : [];

  const fallbackDate =
    typeof raw.deadline === 'string' && isValidDateString(raw.deadline)
      ? raw.deadline
      : getTodayDateString();

  const deadlines: TaskDeadline[] =
    rawDeadlines.length > 0
      ? rawDeadlines
      : [{ id: `${raw.id}-dl-0`, date: fallbackDate, label: 'Target' }];

  const primaryDeadline = getPrimaryDeadline(deadlines, fallbackDate);

  return {
    id: raw.id,
    name: raw.name.trim(),
    description: typeof raw.description === 'string' ? raw.description : '',
    deadline: primaryDeadline,
    deadlines,
    status: raw.status === 'in_progress' || raw.status === 'completed' ? raw.status : 'todo',
    colorId: typeof raw.colorId === 'string' && raw.colorId ? raw.colorId : 'sage',
    responsibility: raw.responsibility === 'Others' ? 'Others' : 'Me',
    valueCategory: raw.valueCategory === 'NNVA' || raw.valueCategory === 'NVA' ? raw.valueCategory : 'VA',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

export function normalizeStep(
  raw: Partial<WBSStep> & { id: string; taskId: string; title: string },
  scheduledStepIds?: Set<string>
): WBSStep {
  const now = Date.now();
  let executionState: StepExecutionState;
  if (
    raw.executionState === 'done_expected' ||
    raw.executionState === 'done_variance' ||
    raw.executionState === 'not_done'
  ) {
    executionState = raw.executionState;
  } else {
    executionState = raw.completed ? 'done_expected' : 'not_done';
  }

  const completed = executionState !== 'not_done';
  let flowStatus: StepFlowStatus;
  if (completed) {
    flowStatus = 'completed';
  } else if (raw.flowStatus === 'in_progress' || raw.flowStatus === 'not_started') {
    flowStatus = raw.flowStatus;
  } else {
    flowStatus = scheduledStepIds?.has(raw.id) ? 'in_progress' : 'not_started';
  }

  return {
    id: raw.id,
    taskId: raw.taskId,
    title: raw.title.trim(),
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 0,
    estimatedMinutes:
      typeof raw.estimatedMinutes === 'number' && raw.estimatedMinutes >= 30
        ? Math.round(raw.estimatedMinutes / 30) * 30
        : 60,
    completed,
    executionState,
    flowStatus,
    varianceReason: typeof raw.varianceReason === 'string' ? raw.varianceReason : '',
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : completed ? now : undefined,
    responsibility: raw.responsibility === 'Others' ? 'Others' : 'Me',
    dependsOnStepIds: Array.isArray(raw.dependsOnStepIds) ? raw.dependsOnStepIds : [],
    valueCategory: raw.valueCategory === 'NNVA' || raw.valueCategory === 'NVA' ? raw.valueCategory : 'VA',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

function normalizeFixedActivities(
  rawList: (FixedActivity | LegacyFixedActivityTemplate)[],
  validStepIds?: Set<string>
): FixedActivity[] {
  const now = Date.now();
  const result: FixedActivity[] = [];
  const seenIds = new Set<string>();

  for (const raw of rawList) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string') continue;

    const filterLinked = (ids?: string[]) =>
      Array.isArray(ids)
        ? ids.filter((id) => typeof id === 'string' && (!validStepIds || validStepIds.has(id)))
        : [];

    // Already an individualized instance with concrete date
    if ('date' in raw && typeof raw.date === 'string' && isValidDateString(raw.date)) {
      if (seenIds.has(raw.id)) continue;
      seenIds.add(raw.id);
      result.push({
        id: raw.id,
        title: raw.title.trim(),
        kind: VALID_FIXED_KINDS.has(raw.kind) ? raw.kind : 'meeting',
        date: raw.date,
        startMinutes: typeof raw.startMinutes === 'number' ? raw.startMinutes : 9 * 60,
        endMinutes:
          typeof raw.endMinutes === 'number'
            ? Math.max((typeof raw.startMinutes === 'number' ? raw.startMinutes : 9 * 60) + 30, raw.endMinutes)
            : 10 * 60,
        countsAsWorkingTime: Boolean(raw.countsAsWorkingTime),
        valueCategory:
          raw.valueCategory === 'NNVA' || raw.valueCategory === 'NVA' ? raw.valueCategory : 'NNVA',
        linkedStepIds: filterLinked(raw.linkedStepIds),
        seriesId: typeof raw.seriesId === 'string' ? raw.seriesId : undefined,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
      });
      continue;
    }

    // Legacy recurring template -> expand into independent per-date instances
    const legacy = raw as LegacyFixedActivityTemplate;
    const dates = expandFixedActivityDates({
      startDate:
        legacy.startDate && isValidDateString(legacy.startDate)
          ? legacy.startDate
          : getStartOfWeek(getTodayDateString()),
      endDate: legacy.endDate && isValidDateString(legacy.endDate) ? legacy.endDate : undefined,
      recurrence:
        legacy.recurrence && VALID_RECURRENCE.has(legacy.recurrence) ? legacy.recurrence : 'weekly',
      daysOfWeek: Array.isArray(legacy.daysOfWeek) ? legacy.daysOfWeek : [1],
    });

    for (const dateStr of dates) {
      const instanceId = `${legacy.id}-${dateStr}`;
      if (seenIds.has(instanceId)) continue;
      seenIds.add(instanceId);
      result.push({
        id: instanceId,
        title: legacy.title.trim(),
        kind: VALID_FIXED_KINDS.has(legacy.kind) ? legacy.kind : 'meeting',
        date: dateStr,
        startMinutes: typeof legacy.startMinutes === 'number' ? legacy.startMinutes : 9 * 60,
        endMinutes:
          typeof legacy.endMinutes === 'number'
            ? Math.max((typeof legacy.startMinutes === 'number' ? legacy.startMinutes : 9 * 60) + 30, legacy.endMinutes)
            : 10 * 60,
        countsAsWorkingTime: Boolean(legacy.countsAsWorkingTime),
        valueCategory:
          legacy.valueCategory === 'NNVA' || legacy.valueCategory === 'NVA' ? legacy.valueCategory : 'NNVA',
        linkedStepIds: [], // Legacy links kept empty on expansion or attached only to first date if needed
        seriesId: legacy.id,
        createdAt: typeof legacy.createdAt === 'number' ? legacy.createdAt : now,
        updatedAt: typeof legacy.updatedAt === 'number' ? legacy.updatedAt : now,
      });
    }
  }

  return result;
}

export function normalizePPCRecord(raw: Partial<WeeklyPPCRecord> & { weekStart: string }): WeeklyPPCRecord {
  const now = Date.now();
  return {
    weekStart: raw.weekStart,
    reasonsForVariance: typeof raw.reasonsForVariance === 'string' ? raw.reasonsForVariance : '',
    stepVariances: Array.isArray(raw.stepVariances) ? raw.stepVariances : [],
    snapshot: raw.snapshot
      ? {
          plannedCount: raw.snapshot.plannedCount ?? 0,
          completedCount: raw.snapshot.completedCount ?? 0,
          ppcPercent: raw.snapshot.ppcPercent ?? 0,
          completedItems: Array.isArray(raw.snapshot.completedItems) ? raw.snapshot.completedItems : [],
          incompleteItems: Array.isArray(raw.snapshot.incompleteItems) ? raw.snapshot.incompleteItems : [],
          locked: Boolean(raw.snapshot.locked),
          updatedAt: typeof raw.snapshot.updatedAt === 'number' ? raw.snapshot.updatedAt : now,
        }
      : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

export function createSampleWorkspace(todayStr = getTodayDateString()): PersistedWorkspace {
  const weekStart = getStartOfWeek(todayStr);
  const prevWeekStart = addDays(weekStart, -7);
  const prev2WeekStart = addDays(weekStart, -14);
  const now = Date.now();

  const task1Id = 'task-sample-1';
  const task2Id = 'task-sample-2';
  const task3Id = 'task-sample-3';

  const tasks: Task[] = [
    {
      id: task1Id,
      name: 'Q4 Operating Budget Review',
      description: 'Consolidate department expenses, reconcile variance sheets, and prepare final summary brief.',
      deadline: addDays(weekStart, 3),
      deadlines: [
        { id: 'dl-sample-1a', date: addDays(weekStart, 3), label: 'Variance Draft' },
        { id: 'dl-sample-1b', date: addDays(weekStart, 6), label: 'Final Brief' },
      ],
      status: 'in_progress',
      colorId: 'sage',
      responsibility: 'Me',
      valueCategory: 'VA',
      createdAt: now - 86400000 * 10,
      updatedAt: now - 100000,
    },
    {
      id: task2Id,
      name: 'Client Portal Architecture Spec',
      description: 'Draft system boundaries, auth flows, and milestone delivery phases for Q1 kickoff.',
      deadline: addDays(weekStart, 5),
      deadlines: [
        { id: 'dl-sample-2a', date: addDays(weekStart, 5), label: 'Security Review' },
        { id: 'dl-sample-2b', date: addDays(weekStart, 13), label: 'Spec Sign-off' },
      ],
      status: 'todo',
      colorId: 'sky',
      responsibility: 'Me',
      valueCategory: 'VA',
      createdAt: now - 86400000 * 8,
      updatedAt: now - 400000,
    },
    {
      id: task3Id,
      name: 'Home Studio Ergonomics Audit',
      description: 'Measure desk height, cable routing, and acoustic panel placement.',
      deadline: addDays(weekStart, 20),
      deadlines: [{ id: 'dl-sample-3a', date: addDays(weekStart, 20), label: 'Final Setup' }],
      status: 'todo',
      colorId: 'ochre',
      responsibility: 'Others',
      valueCategory: 'NNVA',
      createdAt: now - 86400000 * 5,
      updatedAt: now - 300000,
    },
  ];

  const steps: WBSStep[] = [
    {
      id: 'step-sample-1a',
      taskId: task1Id,
      title: 'Export ledger CSVs from finance',
      notes: 'Include Oct and Nov actuals.',
      order: 0,
      estimatedMinutes: 60,
      completed: true,
      executionState: 'done_expected',
      flowStatus: 'completed',
      varianceReason: '',
      completedAt: now - 86400000 * 2,
      responsibility: 'Me',
      dependsOnStepIds: [],
      valueCategory: 'NNVA',
      createdAt: now - 86400000 * 9,
      updatedAt: now - 86400000 * 2,
    },
    {
      id: 'step-sample-1b',
      taskId: task1Id,
      title: 'Reconcile vendor variance items',
      notes: 'Flag deltas above 5%.',
      order: 1,
      estimatedMinutes: 90,
      completed: false,
      executionState: 'not_done',
      flowStatus: 'in_progress',
      varianceReason: '',
      responsibility: 'Me',
      dependsOnStepIds: ['step-sample-1a'],
      valueCategory: 'VA',
      createdAt: now - 86400000 * 8,
      updatedAt: now - 300000,
    },
    {
      id: 'step-sample-1c',
      taskId: task1Id,
      title: 'Confirm contractor invoice adjustment',
      notes: 'Awaiting external finance confirmation.',
      order: 2,
      estimatedMinutes: 60,
      completed: false,
      executionState: 'not_done',
      flowStatus: 'not_started',
      varianceReason: '',
      responsibility: 'Others',
      dependsOnStepIds: ['step-sample-1b'],
      valueCategory: 'NNVA',
      createdAt: now - 86400000 * 7,
      updatedAt: now - 300000,
    },
    {
      id: 'step-sample-1d',
      taskId: task1Id,
      title: 'Write 1-page executive summary',
      notes: 'Ready only after contractor adjustment arrives.',
      order: 3,
      estimatedMinutes: 60,
      completed: false,
      executionState: 'not_done',
      flowStatus: 'not_started',
      varianceReason: '',
      responsibility: 'Me',
      dependsOnStepIds: ['step-sample-1c'],
      valueCategory: 'VA',
      createdAt: now - 86400000 * 7,
      updatedAt: now - 300000,
    },
    {
      id: 'step-sample-2a',
      taskId: task2Id,
      title: 'Map authentication & session states',
      notes: '',
      order: 0,
      estimatedMinutes: 90,
      completed: false,
      executionState: 'not_done',
      flowStatus: 'in_progress',
      varianceReason: '',
      responsibility: 'Me',
      dependsOnStepIds: [],
      valueCategory: 'VA',
      createdAt: now - 86400000 * 6,
      updatedAt: now - 390000,
    },
    {
      id: 'step-sample-2b',
      taskId: task2Id,
      title: 'Define API schema contracts',
      notes: '',
      order: 1,
      estimatedMinutes: 120,
      completed: false,
      executionState: 'not_done',
      flowStatus: 'not_started',
      varianceReason: '',
      responsibility: 'Me',
      dependsOnStepIds: ['step-sample-2a'],
      valueCategory: 'VA',
      createdAt: now - 86400000 * 6,
      updatedAt: now - 380000,
    },
    {
      id: 'step-sample-2c',
      taskId: task2Id,
      title: 'Vendor security sign-off review',
      notes: '',
      order: 2,
      estimatedMinutes: 60,
      completed: false,
      executionState: 'not_done',
      flowStatus: 'not_started',
      varianceReason: '',
      responsibility: 'Others',
      dependsOnStepIds: ['step-sample-2b'],
      valueCategory: 'NNVA',
      createdAt: now - 86400000 * 5,
      updatedAt: now - 370000,
    },
    {
      id: 'step-sample-3a',
      taskId: task3Id,
      title: 'Measure monitor & chair angles',
      notes: '',
      order: 0,
      estimatedMinutes: 30,
      completed: false,
      executionState: 'not_done',
      flowStatus: 'not_started',
      varianceReason: '',
      responsibility: 'Me',
      dependsOnStepIds: [],
      valueCategory: 'NNVA',
      createdAt: now - 86400000 * 4,
      updatedAt: now - 290000,
    },
  ];

  const scheduledBlocks: ScheduledBlock[] = [
    {
      id: 'block-sample-prev-1',
      stepId: 'step-sample-1a',
      taskId: task1Id,
      date: addDays(prevWeekStart, 2),
      startMinutes: 9 * 60,
      durationMinutes: 120,
      updatedAt: now - 86400000 * 5,
    },
    {
      id: 'block-sample-1',
      stepId: 'step-sample-1a',
      taskId: task1Id,
      date: addDays(weekStart, 2), // Monday
      startMinutes: 9 * 60,
      durationMinutes: 60,
      updatedAt: now - 100000,
    },
    {
      id: 'block-sample-2',
      stepId: 'step-sample-1b',
      taskId: task1Id,
      date: addDays(weekStart, 3), // Tuesday
      startMinutes: 10 * 60,
      durationMinutes: 90,
      updatedAt: now - 100000,
    },
    {
      id: 'block-sample-3',
      stepId: 'step-sample-2a',
      taskId: task2Id,
      date: addDays(weekStart, 4), // Wednesday
      startMinutes: 14 * 60,
      durationMinutes: 90,
      updatedAt: now - 100000,
    },
  ];

  // Generate individualized FixedActivity instances across prevWeek..+2 weeks
  const fixedActivities: FixedActivity[] = [];
  const lunchDates = expandFixedActivityDates({
    startDate: prevWeekStart,
    endDate: addDays(weekStart, 20),
    recurrence: 'weekly',
    daysOfWeek: [1, 2, 3, 4, 5],
  });
  for (const d of lunchDates) {
    fixedActivities.push({
      id: `fixed-sample-lunch-${d}`,
      title: 'Lunch Break',
      kind: 'lunch',
      date: d,
      startMinutes: 12 * 60,
      endMinutes: 13 * 60,
      countsAsWorkingTime: false,
      valueCategory: 'NVA',
      linkedStepIds: [],
      seriesId: 'series-sample-lunch',
      createdAt: now - 86400000 * 10,
      updatedAt: now - 86400000 * 10,
    });
  }

  const classDates = expandFixedActivityDates({
    startDate: prevWeekStart,
    endDate: addDays(weekStart, 20),
    recurrence: 'weekly',
    daysOfWeek: [1, 3],
  });
  for (const d of classDates) {
    fixedActivities.push({
      id: `fixed-sample-class-${d}`,
      title: 'Operations Systems Seminar',
      kind: 'class',
      date: d,
      startMinutes: 16 * 60,
      endMinutes: 17 * 60 + 30,
      countsAsWorkingTime: true,
      valueCategory: 'VA',
      linkedStepIds: [],
      seriesId: 'series-sample-class',
      createdAt: now - 86400000 * 10,
      updatedAt: now - 86400000 * 10,
    });
  }

  const ppcRecords: WeeklyPPCRecord[] = [
    {
      weekStart: prev2WeekStart,
      reasonsForVariance: 'Delayed stakeholder kickoff shifted discovery synthesis.',
      stepVariances: [
        {
          stepId: 'step-hist-1',
          stepTitle: 'Gather baseline departmental quotes',
          taskName: 'Q4 Operating Budget Review',
          reason: 'Two vendor quotes arrived after Friday cutoff.',
        },
      ],
      snapshot: {
        plannedCount: 3,
        completedCount: 2,
        ppcPercent: 67,
        completedItems: [
          {
            stepId: 'step-hist-0a',
            taskId: task1Id,
            stepTitle: 'Audit prior year cost centers',
            taskName: 'Q4 Operating Budget Review',
            executionState: 'done_expected',
          },
          {
            stepId: 'step-hist-0b',
            taskId: task2Id,
            stepTitle: 'Draft user persona flows',
            taskName: 'Client Portal Architecture Spec',
            executionState: 'done_expected',
          },
        ],
        incompleteItems: [
          {
            stepId: 'step-hist-1',
            taskId: task1Id,
            stepTitle: 'Gather baseline departmental quotes',
            taskName: 'Q4 Operating Budget Review',
            executionState: 'not_done',
            varianceReason: 'Two vendor quotes arrived after Friday cutoff.',
          },
        ],
        locked: true,
        updatedAt: now - 86400000 * 8,
      },
      updatedAt: now - 86400000 * 8,
    },
    {
      weekStart: prevWeekStart,
      reasonsForVariance: 'Unplanned client scope revision required re-baselining auth states.',
      stepVariances: [
        {
          stepId: 'step-sample-1a',
          stepTitle: 'Export ledger CSVs from finance',
          taskName: 'Q4 Operating Budget Review',
          reason: 'Finance ERP export needed manual re-formatting.',
        },
      ],
      snapshot: {
        plannedCount: 4,
        completedCount: 3,
        ppcPercent: 75,
        completedItems: [
          {
            stepId: 'step-sample-1a',
            taskId: task1Id,
            stepTitle: 'Export ledger CSVs from finance',
            taskName: 'Q4 Operating Budget Review',
            executionState: 'done_variance',
            varianceReason: 'Finance ERP export needed manual re-formatting.',
          },
          {
            stepId: 'step-hist-2a',
            taskId: task2Id,
            stepTitle: 'Benchmark SSO providers',
            taskName: 'Client Portal Architecture Spec',
            executionState: 'done_expected',
          },
          {
            stepId: 'step-hist-2b',
            taskId: task3Id,
            stepTitle: 'Measure desk clearance',
            taskName: 'Home Studio Ergonomics Audit',
            executionState: 'done_expected',
          },
        ],
        incompleteItems: [
          {
            stepId: 'step-hist-2c',
            taskId: task2Id,
            stepTitle: 'Draft webhook retry spec',
            taskName: 'Client Portal Architecture Spec',
            executionState: 'not_done',
          },
        ],
        locked: true,
        updatedAt: now - 86400000,
      },
      updatedAt: now - 86400000,
    },
  ];

  // Historical frozen CFD snapshots for the last 7 days + live today
  const cfdSnapshots: DailyCFDSnapshot[] = [
    { offset: -6, notStarted: 6, inProgress: 2, completed: 0 },
    { offset: -5, notStarted: 5, inProgress: 3, completed: 0 },
    { offset: -4, notStarted: 5, inProgress: 2, completed: 1 },
    { offset: -3, notStarted: 4, inProgress: 3, completed: 1 },
    { offset: -2, notStarted: 4, inProgress: 3, completed: 1 },
    { offset: -1, notStarted: 5, inProgress: 2, completed: 1 },
  ].map((row) => ({
    date: addDays(todayStr, row.offset),
    notStarted: row.notStarted,
    inProgress: row.inProgress,
    completed: row.completed,
    total: row.notStarted + row.inProgress + row.completed,
    locked: true,
    updatedAt: now + row.offset * 86400000,
  }));

  cfdSnapshots.push({
    date: todayStr,
    notStarted: steps.filter((s) => s.flowStatus === 'not_started').length,
    inProgress: steps.filter((s) => s.flowStatus === 'in_progress').length,
    completed: steps.filter((s) => s.flowStatus === 'completed').length,
    total: steps.length,
    locked: false,
    updatedAt: now,
  });

  return {
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    ppcRecords,
    cfdSnapshots,
    scheduleVersions: [],
    workCapacity: DEFAULT_WORK_CAPACITY,
  };
}

export async function loadWorkspace(): Promise<PersistedWorkspace> {
  const db = await openDatabase();
  try {
    const initialized = await getMetaValue(db, 'initialized');
    if (!initialized) {
      const sample = createSampleWorkspace();
      await saveWorkspace(sample, true);
      return sample;
    }
    const [
      rawTasks,
      rawSteps,
      scheduledBlocks,
      rawFixed,
      rawPpcRecords,
      cfdSnapshots,
      scheduleVersions,
      workCapacityRaw,
    ] = await Promise.all([
      getAllFromStore<Task>(db, STORES.TASKS),
      getAllFromStore<WBSStep>(db, STORES.STEPS),
      getAllFromStore<ScheduledBlock>(db, STORES.BLOCKS),
      getAllFromStore<FixedActivity | LegacyFixedActivityTemplate>(db, STORES.FIXED),
      getAllFromStore<WeeklyPPCRecord>(db, STORES.PPC),
      getAllFromStore<DailyCFDSnapshot>(db, STORES.CFD),
      getAllFromStore<ScheduleVersion>(db, STORES.VERSIONS),
      getMetaValue(db, 'workCapacity'),
    ]);

    const scheduledStepIds = new Set(scheduledBlocks.map((b) => b.stepId));
    const tasks = rawTasks.map((t) => normalizeTask(t));
    const steps = rawSteps.map((s) => normalizeStep(s, scheduledStepIds));
    const stepIds = new Set(steps.map((s) => s.id));
    const fixedActivities = normalizeFixedActivities(rawFixed, stepIds);
    const ppcRecords = rawPpcRecords.map((r) => normalizePPCRecord(r));
    const workCapacity =
      workCapacityRaw && typeof workCapacityRaw === 'object'
        ? (workCapacityRaw as WorkCapacitySettings)
        : DEFAULT_WORK_CAPACITY;

    return {
      tasks,
      steps,
      scheduledBlocks,
      fixedActivities,
      ppcRecords,
      cfdSnapshots: cfdSnapshots.sort((a, b) => a.date.localeCompare(b.date)),
      scheduleVersions: scheduleVersions.sort((a, b) => b.createdAt - a.createdAt),
      workCapacity,
    };
  } finally {
    db.close();
  }
}

export async function saveWorkspace(data: PersistedWorkspace, markInitialized = true): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [
        STORES.TASKS,
        STORES.STEPS,
        STORES.BLOCKS,
        STORES.FIXED,
        STORES.PPC,
        STORES.CFD,
        STORES.VERSIONS,
        STORES.META,
      ],
      'readwrite'
    );

    const taskStore = tx.objectStore(STORES.TASKS);
    const stepStore = tx.objectStore(STORES.STEPS);
    const blockStore = tx.objectStore(STORES.BLOCKS);
    const fixedStore = tx.objectStore(STORES.FIXED);
    const ppcStore = tx.objectStore(STORES.PPC);
    const cfdStore = tx.objectStore(STORES.CFD);
    const versionStore = tx.objectStore(STORES.VERSIONS);
    const metaStore = tx.objectStore(STORES.META);

    taskStore.clear();
    stepStore.clear();
    blockStore.clear();
    fixedStore.clear();
    ppcStore.clear();
    cfdStore.clear();
    versionStore.clear();

    for (const t of data.tasks) taskStore.put(t);
    for (const s of data.steps) stepStore.put(s);
    for (const b of data.scheduledBlocks) blockStore.put(b);
    for (const f of data.fixedActivities) fixedStore.put(f);
    for (const p of data.ppcRecords) ppcStore.put(p);
    for (const c of data.cfdSnapshots) cfdStore.put(c);
    for (const v of data.scheduleVersions) versionStore.put(v);

    metaStore.put({ key: 'workCapacity', value: data.workCapacity });
    if (markInitialized) {
      metaStore.put({ key: 'initialized', value: true });
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

const VALID_STATUSES = new Set(['todo', 'in_progress', 'completed']);
const VALID_COLORS = new Set(PASTEL_PALETTE.map((p) => p.id));
const VALID_FIXED_KINDS = new Set<FixedActivityKind>(['class', 'meeting', 'lunch', 'non_working']);
const VALID_RECURRENCE = new Set<RecurrenceFrequency>(['weekly', 'biweekly', 'once']);

export function validateImportPayload(
  raw: unknown
): { ok: true; data: PersistedWorkspace } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'The file does not contain a valid JSON object.' };
  }

  const obj = raw as Partial<AppDataExport>;
  if (!Array.isArray(obj.tasks) || !Array.isArray(obj.steps) || !Array.isArray(obj.scheduledBlocks)) {
    return {
      ok: false,
      error: 'Missing required collections: tasks, steps, and scheduledBlocks must be arrays.',
    };
  }

  const taskIds = new Set<string>();
  const tasks: Task[] = [];

  for (let i = 0; i < obj.tasks.length; i++) {
    const t = obj.tasks[i] as Partial<Task>;
    if (!t || typeof t.id !== 'string' || !t.id.trim() || typeof t.name !== 'string' || !t.name.trim()) {
      return { ok: false, error: `Task at index ${i} is missing a valid id or name.` };
    }
    const hasDeadlinesArr = Array.isArray(t.deadlines) && t.deadlines.some((d) => d && isValidDateString(d.date));
    if (!hasDeadlinesArr && (typeof t.deadline !== 'string' || !isValidDateString(t.deadline))) {
      return { ok: false, error: `Task "${t.name}" has an invalid deadline date (expected YYYY-MM-DD).` };
    }
    if (!t.status || !VALID_STATUSES.has(t.status)) {
      return { ok: false, error: `Task "${t.name}" has an invalid status.` };
    }
    taskIds.add(t.id);
    const normalized = normalizeTask({
      ...t,
      id: t.id,
      name: t.name,
      colorId:
        typeof t.colorId === 'string' && VALID_COLORS.has(t.colorId)
          ? t.colorId
          : PASTEL_PALETTE[i % PASTEL_PALETTE.length].id,
      responsibility: (t.responsibility === 'Others' ? 'Others' : 'Me') as Responsibility,
      valueCategory: (
        t.valueCategory === 'NNVA' || t.valueCategory === 'NVA' ? t.valueCategory : 'VA'
      ) as ValueCategory,
    });
    tasks.push(normalized);
  }

  const scheduledStepIds = new Set<string>();
  for (const b of obj.scheduledBlocks) {
    if (b && typeof b.stepId === 'string') scheduledStepIds.add(b.stepId);
  }

  const stepIds = new Set<string>();
  const steps: WBSStep[] = [];

  for (let i = 0; i < obj.steps.length; i++) {
    const s = obj.steps[i] as Partial<WBSStep>;
    if (!s || typeof s.id !== 'string' || !s.id.trim() || typeof s.title !== 'string' || !s.title.trim()) {
      return { ok: false, error: `Step at index ${i} is missing a valid id or title.` };
    }
    if (typeof s.taskId !== 'string' || !taskIds.has(s.taskId)) {
      return { ok: false, error: `Step "${s.title}" references a missing parent task.` };
    }
    stepIds.add(s.id);
    steps.push(
      normalizeStep(
        {
          ...s,
          id: s.id,
          taskId: s.taskId,
          title: s.title,
          order: typeof s.order === 'number' && Number.isFinite(s.order) ? s.order : i,
        },
        scheduledStepIds
      )
    );
  }

  for (const s of steps) {
    s.dependsOnStepIds = s.dependsOnStepIds.filter((d) => stepIds.has(d) && d !== s.id);
  }

  const scheduledBlocks: ScheduledBlock[] = [];
  for (let i = 0; i < obj.scheduledBlocks.length; i++) {
    const b = obj.scheduledBlocks[i] as Partial<ScheduledBlock>;
    if (!b || typeof b.id !== 'string' || !b.id.trim()) {
      return { ok: false, error: `Scheduled block at index ${i} is missing a valid id.` };
    }
    if (typeof b.stepId !== 'string' || !stepIds.has(b.stepId)) {
      return { ok: false, error: `Scheduled block at index ${i} references a missing WBS step.` };
    }
    if (typeof b.taskId !== 'string' || !taskIds.has(b.taskId)) {
      return { ok: false, error: `Scheduled block at index ${i} references a missing parent task.` };
    }
    if (typeof b.date !== 'string' || !isValidDateString(b.date)) {
      return { ok: false, error: `Scheduled block at index ${i} has an invalid date.` };
    }
    const startMinutes =
      typeof b.startMinutes === 'number' ? Math.max(0, Math.min(23 * 60 + 30, b.startMinutes)) : 9 * 60;
    const durationMinutes =
      typeof b.durationMinutes === 'number' ? Math.max(30, b.durationMinutes) : 60;
    scheduledBlocks.push({
      id: b.id,
      stepId: b.stepId,
      taskId: b.taskId,
      date: b.date,
      startMinutes,
      durationMinutes,
      updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : Date.now(),
    });
  }

  const fixedActivities = Array.isArray(obj.fixedActivities)
    ? normalizeFixedActivities(obj.fixedActivities, stepIds)
    : [];

  const ppcRecords: WeeklyPPCRecord[] = Array.isArray(obj.ppcRecords)
    ? obj.ppcRecords
        .filter((p): p is WeeklyPPCRecord => Boolean(p && typeof p.weekStart === 'string' && isValidDateString(p.weekStart)))
        .map((p) => normalizePPCRecord(p))
    : [];

  const cfdSnapshots: DailyCFDSnapshot[] = Array.isArray(obj.cfdSnapshots)
    ? obj.cfdSnapshots
        .filter((c): c is DailyCFDSnapshot => Boolean(c && typeof c.date === 'string' && isValidDateString(c.date)))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const scheduleVersions: ScheduleVersion[] = Array.isArray(obj.scheduleVersions)
    ? obj.scheduleVersions.filter(
        (v): v is ScheduleVersion => Boolean(v && typeof v.id === 'string' && Array.isArray(v.blocks))
      )
    : [];

  const workCapacity: WorkCapacitySettings =
    obj.workCapacity && typeof obj.workCapacity === 'object'
      ? {
          workdays: Array.isArray(obj.workCapacity.workdays)
            ? obj.workCapacity.workdays
            : DEFAULT_WORK_CAPACITY.workdays,
          workdayStartMinutes:
            typeof obj.workCapacity.workdayStartMinutes === 'number'
              ? obj.workCapacity.workdayStartMinutes
              : DEFAULT_WORK_CAPACITY.workdayStartMinutes,
          workdayEndMinutes:
            typeof obj.workCapacity.workdayEndMinutes === 'number'
              ? obj.workCapacity.workdayEndMinutes
              : DEFAULT_WORK_CAPACITY.workdayEndMinutes,
          dailyTargetHours:
            typeof obj.workCapacity.dailyTargetHours === 'number'
              ? obj.workCapacity.dailyTargetHours
              : DEFAULT_WORK_CAPACITY.dailyTargetHours,
          updatedAt:
            typeof obj.workCapacity.updatedAt === 'number'
              ? obj.workCapacity.updatedAt
              : Date.now(),
        }
      : DEFAULT_WORK_CAPACITY;

  return {
    ok: true,
    data: {
      tasks,
      steps,
      scheduledBlocks,
      fixedActivities,
      ppcRecords,
      cfdSnapshots,
      scheduleVersions,
      workCapacity,
    },
  };
}
