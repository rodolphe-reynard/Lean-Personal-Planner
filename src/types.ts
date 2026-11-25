export type ActiveTab = 'kanban' | 'master' | 'wbs' | 'heijunka' | 'weekly' | 'stats';

export type TaskStatus = 'todo' | 'in_progress' | 'completed';

export type WeeklyPriority = 'WILL';

export type StepPullLabel = 'SHOULD' | 'CAN' | null;

export type Responsibility = 'Me' | 'Others';

export type ValueCategory = 'VA' | 'NNVA' | 'NVA';

export type FixedActivityKind = 'class' | 'meeting' | 'lunch' | 'non_working';

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'once';

export type StepExecutionState = 'not_done' | 'done_expected' | 'done_variance';

export type StepFlowStatus = 'not_started' | 'in_progress' | 'completed';

export interface TaskDeadline {
  id: string;
  date: string; // YYYY-MM-DD local date string
  label?: string;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  deadline: string; // Earliest/primary YYYY-MM-DD for chronological sorting compatibility
  deadlines: TaskDeadline[];
  status: TaskStatus;
  colorId: string;
  responsibility: Responsibility;
  valueCategory: ValueCategory;
  createdAt: number;
  updatedAt: number;
}

export interface WBSStep {
  id: string;
  taskId: string;
  title: string;
  notes: string;
  order: number;
  estimatedMinutes: number;
  completed: boolean;
  executionState: StepExecutionState;
  flowStatus: StepFlowStatus;
  varianceReason: string;
  completedAt?: number;
  responsibility: Responsibility;
  dependsOnStepIds: string[];
  valueCategory: ValueCategory;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledBlock {
  id: string;
  stepId: string;
  taskId: string;
  date: string; // YYYY-MM-DD local date string
  startMinutes: number; // minutes from 00:00 (e.g. 540 = 09:00)
  durationMinutes: number; // snapped to 30-min increments, minimum 30
  updatedAt?: number;
}

export interface FixedActivity {
  id: string;
  title: string;
  kind: FixedActivityKind;
  date: string; // Concrete YYYY-MM-DD date for this individual instance
  startMinutes: number;
  endMinutes: number;
  countsAsWorkingTime: boolean;
  valueCategory: ValueCategory;
  linkedStepIds: string[];
  seriesId?: string; // Creation batch metadata only; does not couple edits or links
  createdAt: number;
  updatedAt: number;
}

export interface LegacyFixedActivityTemplate {
  id: string;
  title: string;
  kind: FixedActivityKind;
  daysOfWeek?: number[];
  startMinutes: number;
  endMinutes: number;
  recurrence?: RecurrenceFrequency;
  startDate?: string;
  endDate?: string;
  date?: string;
  countsAsWorkingTime: boolean;
  valueCategory: ValueCategory;
  linkedStepIds?: string[];
  seriesId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface PPCItemSummary {
  stepId: string;
  taskId: string;
  stepTitle: string;
  taskName: string;
  executionState: StepExecutionState;
  varianceReason?: string;
}

export interface StepVarianceEntry {
  stepId: string;
  stepTitle: string;
  taskName: string;
  reason: string;
}

export interface PPCSnapshot {
  plannedCount: number;
  completedCount: number;
  ppcPercent: number;
  completedItems: PPCItemSummary[];
  incompleteItems: PPCItemSummary[];
  locked: boolean;
  updatedAt: number;
}

export interface WeeklyPPCRecord {
  weekStart: string; // YYYY-MM-DD (Saturday)
  reasonsForVariance: string;
  stepVariances: StepVarianceEntry[];
  snapshot?: PPCSnapshot;
  updatedAt: number;
}

export interface DailyCFDSnapshot {
  date: string; // YYYY-MM-DD
  notStarted: number;
  inProgress: number;
  completed: number;
  total: number;
  locked: boolean;
  updatedAt: number;
}

export interface ScheduleVersion {
  id: string;
  createdAt: number;
  label: string;
  weekStart: string;
  blocks: ScheduledBlock[];
}

export interface WorkCapacitySettings {
  workdays: number[]; // 0=Sun..6=Sat
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  dailyTargetHours: number;
  updatedAt?: number;
}

export interface AIProposedBlockInput {
  stepId: string;
  taskId: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  reason: string;
}

export interface AIConflict {
  severity: 'warning' | 'error';
  message: string;
  date?: string;
}

export type ProposalChangeKind = 'added' | 'modified' | 'removed' | 'unchanged';

export interface ProposalDiffItem {
  kind: ProposalChangeKind;
  stepId: string;
  taskId: string;
  reason?: string;
  before?: ScheduledBlock;
  after?: ScheduledBlock;
}

export interface AIScheduleProposal {
  weekStart: string;
  summary: string;
  conflicts: AIConflict[];
  proposedWeekBlocks: ScheduledBlock[];
  diffs: ProposalDiffItem[];
}

export interface AppDataExport {
  version: number;
  exportedAt: string;
  tasks: Task[];
  steps: WBSStep[];
  scheduledBlocks: ScheduledBlock[];
  fixedActivities?: (FixedActivity | LegacyFixedActivityTemplate)[];
  ppcRecords?: WeeklyPPCRecord[];
  cfdSnapshots?: DailyCFDSnapshot[];
  scheduleVersions?: ScheduleVersion[];
  workCapacity?: WorkCapacitySettings;
}

export interface SyncConflict {
  id: string;
  collection:
    | 'tasks'
    | 'steps'
    | 'scheduledBlocks'
    | 'fixedActivities'
    | 'ppcRecords'
    | 'settings';
  docId: string;
  label: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  localPayload: unknown;
  remotePayload: unknown;
}
