import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  History,
  Layers,
  Link2,
  Lock,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { FixedActivity, ScheduledBlock, Task, TaskDeadline, WBSStep } from '../types';
import { getTaskSwatch } from '../utils/colors';
import {
  addDays,
  doesTaskHaveDeadlineInWeek,
  formatCompactDate,
  formatDayHeader,
  formatDuration,
  formatMinutesToTime,
  formatShortDate,
  formatWeekRange,
  getISOWeekNumber,
  getNextRelevantDeadline,
  getStartOfWeek,
  getTaskDeadlines,
  getWeekDays,
  isTaskOverdue,
} from '../utils/dateUtils';
import {
  getFixedActivitiesForDate,
  getStepPullClassification,
  validateStepPlacement,
} from '../utils/schedulingUtils';
import { FixedActivityModal } from './FixedActivityModal';
import { AIScheduleModal } from './AIScheduleModal';
import { StepExecutionControl } from './StepExecutionControl';
import { useLanguage } from '../i18n/LanguageContext';

interface WeeklyPlanTabProps {
  onNewTask: () => void;
}

const START_HOUR = 7; // 07:00
const END_HOUR = 22; // 22:00
const START_MINUTES = START_HOUR * 60;
const END_MINUTES = END_HOUR * 60;
const SLOT_MINUTES = 30;
const SLOT_HEIGHT_PX = 26; // 52px per hour -> 780px total grid height
const PX_PER_MINUTE = SLOT_HEIGHT_PX / SLOT_MINUTES;

function snapMinutes(rawMinutes: number): number {
  return Math.round(rawMinutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

interface PositionedBlock {
  block: ScheduledBlock;
  colIndex: number;
  totalCols: number;
}

function computeDayBlockLayout(dayBlocks: ScheduledBlock[]): PositionedBlock[] {
  if (dayBlocks.length === 0) return [];
  const sorted = [...dayBlocks].sort(
    (a, b) => a.startMinutes - b.startMinutes || b.durationMinutes - a.durationMinutes
  );

  const result: PositionedBlock[] = [];
  let cluster: ScheduledBlock[] = [];
  let clusterEnd = -1;

  const flushCluster = (items: ScheduledBlock[]) => {
    if (items.length === 0) return;
    const laneEnds: number[] = [];
    const assigned: { block: ScheduledBlock; colIndex: number }[] = [];

    for (const blk of items) {
      let placedCol = -1;
      for (let c = 0; c < laneEnds.length; c++) {
        if (laneEnds[c] <= blk.startMinutes) {
          placedCol = c;
          laneEnds[c] = blk.startMinutes + blk.durationMinutes;
          break;
        }
      }
      if (placedCol === -1) {
        placedCol = laneEnds.length;
        laneEnds.push(blk.startMinutes + blk.durationMinutes);
      }
      assigned.push({ block: blk, colIndex: placedCol });
    }

    const totalCols = laneEnds.length;
    for (const item of assigned) {
      result.push({
        block: item.block,
        colIndex: item.colIndex,
        totalCols,
      });
    }
  };

  for (const blk of sorted) {
    const end = blk.startMinutes + blk.durationMinutes;
    if (cluster.length === 0 || blk.startMinutes < clusterEnd) {
      cluster.push(blk);
      clusterEnd = Math.max(clusterEnd, end);
    } else {
      flushCluster(cluster);
      cluster = [blk];
      clusterEnd = end;
    }
  }
  flushCluster(cluster);
  return result;
}

type ActiveDrag =
  | {
      kind: 'new-step';
      step: WBSStep;
      task: Task;
      startX: number;
      startY: number;
      clientX: number;
      clientY: number;
      isDragging: boolean;
      targetDate: string | null;
      targetStartMinutes: number | null;
      targetFixedActivity: { id: string; title: string } | null;
    }
  | {
      kind: 'move-block';
      block: ScheduledBlock;
      step: WBSStep;
      task: Task;
      startX: number;
      startY: number;
      clientX: number;
      clientY: number;
      grabOffsetMinutes: number;
      isDragging: boolean;
      targetDate: string | null;
      targetStartMinutes: number | null;
    }
  | {
      kind: 'resize-block';
      block: ScheduledBlock;
      step: WBSStep;
      startY: number;
      initialDuration: number;
      previewDuration: number;
    };

interface DayDeadlineMarker {
  task: Task;
  deadline: TaskDeadline;
}

export const WeeklyPlanTab: React.FC<WeeklyPlanTabProps> = ({ onNewTask }) => {
  const {
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    ppcRecords,
    scheduleVersions,
    todayStr,
    displayedWeekStart,
    goToPrevWeek,
    goToNextWeek,
    goToCurrentWeek,
    scheduleStep,
    updateScheduledBlock,
    unscheduleBlock,
    deleteFixedActivity,
    setStepExecutionState,
    toggleStepInProgress,
    linkStepToFixedActivity,
    unlinkStepFromFixedActivity,
    updateWeekVarianceReason,
    updateStepVariance,
    undoLastScheduleChange,
    openTaskInWBS,
  } = useAppState();
  const { language, t } = useLanguage();

  const [flyout, setFlyout] = useState<{
    taskId: string;
    rect: { top: number; right: number; left: number; bottom: number };
  } | null>(null);
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null);
  const pinnedTaskIdRef = useRef<string | null>(null);
  pinnedTaskIdRef.current = pinnedTaskId;
  const openOverlayCountRef = useRef(0);
  const isPointerInSidebarCardRef = useRef(false);
  const isPointerInFlyoutRef = useRef(false);
  const [showCompletedSidebar, setShowCompletedSidebar] = useState(false);

  const [fixedModalState, setFixedModalState] = useState<{
    open: boolean;
    editId: string | null;
  }>({ open: false, editId: null });
  const [aiModalState, setAiModalState] = useState<{
    open: boolean;
    mode: 'assistant' | 'history';
  }>({ open: false, mode: 'assistant' });
  const [varianceModalOpen, setVarianceModalOpen] = useState(false);
  const [placementError, setPlacementError] = useState<string | null>(null);

  const closeFlyoutTimerRef = useRef<number | null>(null);
  const calendarScrollRef = useRef<HTMLDivElement | null>(null);
  const dayColumnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fixedBlockRefs = useRef<Record<string, { el: HTMLDivElement | null; activity: FixedActivity }>>({});
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  activeDragRef.current = activeDrag;

  const cancelCloseFlyout = () => {
    if (closeFlyoutTimerRef.current !== null) {
      window.clearTimeout(closeFlyoutTimerRef.current);
      closeFlyoutTimerRef.current = null;
    }
  };

  const scheduleCloseFlyout = () => {
    cancelCloseFlyout();
    closeFlyoutTimerRef.current = window.setTimeout(() => {
      if (
        openOverlayCountRef.current > 0 ||
        isPointerInFlyoutRef.current ||
        isPointerInSidebarCardRef.current
      ) {
        return;
      }
      setFlyout((prev) => {
        if (prev && pinnedTaskIdRef.current === prev.taskId) return prev;
        return null;
      });
    }, 100);
  };

  useEffect(() => {
    openOverlayCountRef.current = 0;
  }, [flyout?.taskId]);

  useEffect(() => {
    if (!flyout) {
      isPointerInFlyoutRef.current = false;
    }
  }, [flyout]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinnedTaskId(null);
        setFlyout(null);
        setVarianceModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      cancelCloseFlyout();
    };
  }, []);

  const weekDays = useMemo(() => getWeekDays(displayedWeekStart), [displayedWeekStart]);
  const weekDaySet = useMemo(() => new Set(weekDays), [weekDays]);
  const currentWeekStart = useMemo(() => getStartOfWeek(todayStr), [todayStr]);
  const isViewingCurrentWeek = displayedWeekStart === currentWeekStart;
  const isoWeekNum = useMemo(
    () => getISOWeekNumber(addDays(displayedWeekStart, 4)),
    [displayedWeekStart]
  );
  const weekRangeLabel = useMemo(
    () => formatWeekRange(displayedWeekStart, language),
    [displayedWeekStart, language]
  );

  const taskMap = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  const stepMap = useMemo(() => {
    const m = new Map<string, WBSStep>();
    for (const s of steps) m.set(s.id, s);
    return m;
  }, [steps]);

  const stepsByTask = useMemo(() => {
    const map = new Map<string, WBSStep[]>();
    for (const s of steps) {
      const arr = map.get(s.taskId) ?? [];
      arr.push(s);
      map.set(s.taskId, arr);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.order - b.order);
    }
    return map;
  }, [steps]);

  const scheduledStepIdsInWeek = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of scheduledBlocks) {
      if (weekDaySet.has(b.date)) {
        counts.set(b.stepId, (counts.get(b.stepId) ?? 0) + 1);
      }
    }
    return counts;
  }, [scheduledBlocks, weekDaySet]);

  const blocksByDay = useMemo(() => {
    const map = new Map<string, ScheduledBlock[]>();
    for (const d of weekDays) map.set(d, []);
    for (const b of scheduledBlocks) {
      const arr = map.get(b.date);
      if (arr) arr.push(b);
    }
    return map;
  }, [scheduledBlocks, weekDays]);

  const fixedActivitiesByDay = useMemo(() => {
    const map = new Map<string, FixedActivity[]>();
    for (const d of weekDays) {
      map.set(d, getFixedActivitiesForDate(fixedActivities, d));
    }
    return map;
  }, [fixedActivities, weekDays]);

  const linkedStepIdsInWeek = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of weekDays) {
      for (const fa of fixedActivitiesByDay.get(d) ?? []) {
        for (const sid of fa.linkedStepIds) {
          counts.set(sid, (counts.get(sid) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [weekDays, fixedActivitiesByDay]);

  // Multi-deadline markers mapped onto matching week day columns
  const deadlinesByDay = useMemo(() => {
    const map = new Map<string, DayDeadlineMarker[]>();
    for (const d of weekDays) map.set(d, []);
    for (const task of tasks) {
      for (const dl of getTaskDeadlines(task)) {
        const arr = map.get(dl.date);
        if (arr) {
          arr.push({ task, deadline: dl });
        }
      }
    }
    return map;
  }, [tasks, weekDays]);

  // Separate active tasks into WILL (any milestone falls inside displayed week) vs Horizon (no milestone in displayed week)
  const { willTasks, horizonTasks, completedTasks } = useMemo(() => {
    const active = [...tasks]
      .filter((t) => t.status !== 'completed')
      .sort((a, b) => a.deadline.localeCompare(b.deadline));
    const completed = [...tasks]
      .filter((t) => t.status === 'completed')
      .sort((a, b) => a.deadline.localeCompare(b.deadline));

    const will: Task[] = [];
    const horizon: Task[] = [];
    for (const t of active) {
      if (doesTaskHaveDeadlineInWeek(t, displayedWeekStart)) {
        will.push(t);
      } else {
        horizon.push(t);
      }
    }
    return { willTasks: will, horizonTasks: horizon, completedTasks: completed };
  }, [tasks, displayedWeekStart]);

  const currentWeekPpcRecord = useMemo(
    () => ppcRecords.find((r) => r.weekStart === displayedWeekStart) ?? null,
    [ppcRecords, displayedWeekStart]
  );

  const weekUniqueScheduledSteps = useMemo(() => {
    const seen = new Set<string>();
    const list: WBSStep[] = [];
    for (const blk of scheduledBlocks) {
      if (!weekDaySet.has(blk.date) || seen.has(blk.stepId)) continue;
      seen.add(blk.stepId);
      const step = stepMap.get(blk.stepId);
      if (step) list.push(step);
    }
    return list;
  }, [scheduledBlocks, weekDaySet, stepMap]);

  const weekPpcSummary = useMemo(() => {
    const total = weekUniqueScheduledSteps.length;
    const completed = weekUniqueScheduledSteps.filter((s) => s.completed).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : null;
    const stepVarianceCount =
      currentWeekPpcRecord?.stepVariances.filter((sv) => sv.reason.trim().length > 0).length ?? 0;
    const hasNotes =
      Boolean(currentWeekPpcRecord?.reasonsForVariance.trim()) || stepVarianceCount > 0;
    return { total, completed, pct, hasNotes, stepVarianceCount };
  }, [weekUniqueScheduledSteps, currentWeekPpcRecord]);

  const hitTestFixedActivity = (
    clientX: number,
    clientY: number
  ): { id: string; title: string } | null => {
    for (const entry of Object.values(fixedBlockRefs.current)) {
      if (!entry.el) continue;
      const rect = entry.el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return { id: entry.activity.id, title: entry.activity.title };
      }
    }
    return null;
  };

  const hitTestCalendar = (
    clientX: number,
    clientY: number,
    durationMinutes: number,
    grabOffsetMinutes = 0
  ): { date: string | null; startMinutes: number | null } => {
    const scrollEl = calendarScrollRef.current;
    if (scrollEl) {
      const scrollRect = scrollEl.getBoundingClientRect();
      if (
        clientX < scrollRect.left ||
        clientX > scrollRect.right ||
        clientY < scrollRect.top ||
        clientY > scrollRect.bottom
      ) {
        return { date: null, startMinutes: null };
      }
    }

    for (const date of weekDays) {
      const el = dayColumnRefs.current[date];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        const yInGrid = clientY - rect.top;
        const rawMinutes = START_MINUTES + yInGrid / PX_PER_MINUTE - grabOffsetMinutes;
        const snapped = snapMinutes(rawMinutes);
        const clamped = clamp(snapped, START_MINUTES, END_MINUTES - durationMinutes);
        return { date, startMinutes: clamped };
      }
    }
    return { date: null, startMinutes: null };
  };

  const validationDepsRef = useRef({ steps, scheduledBlocks, fixedActivities, language });
  validationDepsRef.current = { steps, scheduledBlocks, fixedActivities, language };

  useEffect(() => {
    if (!activeDrag) return;

    const handlePointerMove = (e: PointerEvent) => {
      const current = activeDragRef.current;
      if (!current) return;

      if (current.kind === 'new-step') {
        const dist = Math.hypot(e.clientX - current.startX, e.clientY - current.startY);
        const isDragging = current.isDragging || dist > 4;
        const fixedHit = isDragging ? hitTestFixedActivity(e.clientX, e.clientY) : null;
        const hit =
          isDragging && !fixedHit
            ? hitTestCalendar(e.clientX, e.clientY, current.step.estimatedMinutes, 15)
            : { date: null, startMinutes: null };
        setActiveDrag({
          ...current,
          clientX: e.clientX,
          clientY: e.clientY,
          isDragging,
          targetDate: hit.date,
          targetStartMinutes: hit.startMinutes,
          targetFixedActivity: fixedHit,
        });
      } else if (current.kind === 'move-block') {
        const dist = Math.hypot(e.clientX - current.startX, e.clientY - current.startY);
        const isDragging = current.isDragging || dist > 4;
        const hit = isDragging
          ? hitTestCalendar(
              e.clientX,
              e.clientY,
              current.block.durationMinutes,
              current.grabOffsetMinutes
            )
          : { date: current.block.date, startMinutes: current.block.startMinutes };
        setActiveDrag({
          ...current,
          clientX: e.clientX,
          clientY: e.clientY,
          isDragging,
          targetDate: hit.date,
          targetStartMinutes: hit.startMinutes,
        });
      } else if (current.kind === 'resize-block') {
        const deltaY = e.clientY - current.startY;
        const deltaMin = snapMinutes(deltaY / PX_PER_MINUTE);
        const maxDuration = END_MINUTES - current.block.startMinutes;
        const nextDur = clamp(current.initialDuration + deltaMin, SLOT_MINUTES, maxDuration);
        setActiveDrag({
          ...current,
          previewDuration: nextDur,
        });
      }
    };

    const handlePointerUp = () => {
      const current = activeDragRef.current;
      if (!current) return;
      const deps = validationDepsRef.current;

      if (current.kind === 'new-step') {
        if (current.isDragging && current.targetFixedActivity) {
          linkStepToFixedActivity(current.targetFixedActivity.id, current.step.id);
          setPlacementError(null);
        } else if (current.isDragging && current.targetDate && current.targetStartMinutes !== null) {
          const check = validateStepPlacement({
            step: current.step,
            date: current.targetDate,
            startMinutes: current.targetStartMinutes,
            durationMinutes: current.step.estimatedMinutes,
            allSteps: deps.steps,
            scheduledBlocks: deps.scheduledBlocks,
            fixedActivities: deps.fixedActivities,
            lang: deps.language,
          });
          if (!check.ok) {
            setPlacementError(check.reason);
          } else {
            setPlacementError(null);
            scheduleStep({
              stepId: current.step.id,
              taskId: current.task.id,
              date: current.targetDate,
              startMinutes: current.targetStartMinutes,
              durationMinutes: current.step.estimatedMinutes,
            });
          }
        }
      } else if (current.kind === 'move-block') {
        if (current.isDragging && current.targetDate && current.targetStartMinutes !== null) {
          if (
            current.targetDate !== current.block.date ||
            current.targetStartMinutes !== current.block.startMinutes
          ) {
            const check = validateStepPlacement({
              step: current.step,
              date: current.targetDate,
              startMinutes: current.targetStartMinutes,
              durationMinutes: current.block.durationMinutes,
              ignoreBlockId: current.block.id,
              allSteps: deps.steps,
              scheduledBlocks: deps.scheduledBlocks,
              fixedActivities: deps.fixedActivities,
              lang: deps.language,
            });
            if (!check.ok) {
              setPlacementError(check.reason);
            } else {
              setPlacementError(null);
              updateScheduledBlock(current.block.id, {
                date: current.targetDate,
                startMinutes: current.targetStartMinutes,
              });
            }
          }
        }
      } else if (current.kind === 'resize-block') {
        if (current.previewDuration !== current.initialDuration) {
          const check = validateStepPlacement({
            step: current.step,
            date: current.block.date,
            startMinutes: current.block.startMinutes,
            durationMinutes: current.previewDuration,
            ignoreBlockId: current.block.id,
            allSteps: deps.steps,
            scheduledBlocks: deps.scheduledBlocks,
            fixedActivities: deps.fixedActivities,
            lang: deps.language,
          });
          if (!check.ok) {
            setPlacementError(check.reason);
          } else {
            setPlacementError(null);
            updateScheduledBlock(current.block.id, {
              durationMinutes: current.previewDuration,
            });
          }
        }
      }

      setActiveDrag(null);
      setFlyout((prev) => (prev && pinnedTaskId === prev.taskId ? prev : null));
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    Boolean(activeDrag),
    weekDays,
    scheduleStep,
    updateScheduledBlock,
    linkStepToFixedActivity,
    pinnedTaskId,
  ]);

  const openTaskFlyout = (taskId: string, el: HTMLElement) => {
    cancelCloseFlyout();
    const r = el.getBoundingClientRect();
    setFlyout({
      taskId,
      rect: { top: r.top, right: r.right, left: r.left, bottom: r.bottom },
    });
  };

  const togglePinTask = (taskId: string, el: HTMLElement) => {
    if (pinnedTaskId === taskId) {
      setPinnedTaskId(null);
    } else {
      setPinnedTaskId(taskId);
      openTaskFlyout(taskId, el);
    }
  };

  const renderSidebarTaskCard = (task: Task, isWill: boolean) => {
    const swatch = getTaskSwatch(task.colorId);
    const taskSteps = stepsByTask.get(task.id) ?? [];
    const placedStepsInWeek = taskSteps.filter(
      (s) =>
        (scheduledStepIdsInWeek.get(s.id) ?? 0) > 0 ||
        (linkedStepIdsInWeek.get(s.id) ?? 0) > 0
    ).length;
    const deadlines = getTaskDeadlines(task);
    const nextDl = getNextRelevantDeadline(task, todayStr);
    const overdue = isTaskOverdue(task, task.status, todayStr);
    const isFlyoutActive = flyout?.taskId === task.id || pinnedTaskId === task.id;

    return (
      <div
        key={task.id}
        onMouseEnter={(e) => {
          isPointerInSidebarCardRef.current = true;
          cancelCloseFlyout();
          if (pinnedTaskId && pinnedTaskId !== task.id) return;
          openTaskFlyout(task.id, e.currentTarget);
        }}
        onMouseLeave={() => {
          isPointerInSidebarCardRef.current = false;
          if (pinnedTaskId === task.id) return;
          scheduleCloseFlyout();
        }}
        className={`border rounded-md bg-white transition-colors ${
          isFlyoutActive ? 'border-zinc-500 bg-zinc-50/70' : 'border-zinc-200 hover:border-zinc-300'
        }`}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => togglePinTask(task.id, e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              togglePinTask(task.id, e.currentTarget);
            }
          }}
          className="p-2.5 cursor-pointer select-none"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm border shrink-0 mt-1"
                style={{
                  backgroundColor: swatch.bg,
                  borderColor: swatch.swatch,
                }}
              />
              <span
                className={`text-xs font-medium leading-snug ${
                  task.status === 'completed' ? 'line-through text-zinc-500' : 'text-zinc-900'
                }`}
              >
                {task.name}
              </span>
            </div>

            {isWill && task.status !== 'completed' && (
              <span className="text-[10px] font-mono font-semibold tracking-wide px-1.5 py-0.5 rounded shrink-0 bg-zinc-900 text-white">
                {t.weekly.willTag}
              </span>
            )}
          </div>

          <div className="mt-1.5 pl-4 flex items-center justify-between gap-2 text-[11px] tabular-nums">
            <span
              className={overdue ? 'font-semibold text-red-700' : 'text-zinc-500'}
              title={deadlines
                .map((d) => `${d.label ? `${d.label}: ` : ''}${formatShortDate(d.date, language)}`)
                .join('\n')}
            >
              {formatShortDate(nextDl.date, language)}
              {deadlines.length > 1 ? ` (+${deadlines.length - 1})` : ''}
              {overdue ? ` · ${t.weekly.overdueTag}` : ''}
              {task.responsibility === 'Others' ? ` · ${t.common.responsibility.Others}` : ''}
            </span>
            <span className="font-mono text-zinc-500" title={t.weekly.placedInWwpTitle}>
              {t.weekly.inWwp(placedStepsInWeek, taskSteps.length)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const hourMarks = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i),
    []
  );

  const newStepGhostValid = useMemo(() => {
    if (
      activeDrag?.kind !== 'new-step' ||
      !activeDrag.isDragging ||
      !activeDrag.targetDate ||
      activeDrag.targetStartMinutes === null
    ) {
      return true;
    }
    return validateStepPlacement({
      step: activeDrag.step,
      date: activeDrag.targetDate,
      startMinutes: activeDrag.targetStartMinutes,
      durationMinutes: activeDrag.step.estimatedMinutes,
      allSteps: steps,
      scheduledBlocks,
      fixedActivities,
      lang: language,
    }).ok;
  }, [activeDrag, steps, scheduledBlocks, fixedActivities, language]);

  const moveBlockGhostValid = useMemo(() => {
    if (
      activeDrag?.kind !== 'move-block' ||
      !activeDrag.isDragging ||
      !activeDrag.targetDate ||
      activeDrag.targetStartMinutes === null
    ) {
      return true;
    }
    return validateStepPlacement({
      step: activeDrag.step,
      date: activeDrag.targetDate,
      startMinutes: activeDrag.targetStartMinutes,
      durationMinutes: activeDrag.block.durationMinutes,
      ignoreBlockId: activeDrag.block.id,
      allSteps: steps,
      scheduledBlocks,
      fixedActivities,
      lang: language,
    }).ok;
  }, [activeDrag, steps, scheduledBlocks, fixedActivities, language]);

  return (
    <div className="flex flex-col h-full">
      {/* Top Week Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-zinc-200">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              {t.weekly.title}
            </h1>
            <span className="text-xs font-mono tabular-nums text-zinc-500">
              {t.weekly.weekPrefix(isoWeekNum, weekRangeLabel)}
            </span>
            {isViewingCurrentWeek && (
              <span className="text-[11px] font-medium text-zinc-900 bg-zinc-200/80 px-2 py-0.5 rounded">
                {t.weekly.currentWeek}
              </span>
            )}
            {weekPpcSummary.pct !== null && (
              <span className="text-[11px] font-mono tabular-nums text-zinc-700 bg-white border border-zinc-200 px-2 py-0.5 rounded">
                {t.weekly.ppcBadge(weekPpcSummary.pct, weekPpcSummary.completed, weekPpcSummary.total)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setVarianceModalOpen(true)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-md transition-colors whitespace-nowrap shrink-0 ${
              weekPpcSummary.hasNotes
                ? 'text-amber-900 bg-amber-50 border-amber-300 hover:bg-amber-100/70'
                : 'text-zinc-700 bg-white border-zinc-300 hover:bg-zinc-50'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" />
            {t.weekly.varianceReviewBtn}
          </button>

          <button
            type="button"
            onClick={() => setFixedModalState({ open: true, editId: null })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 whitespace-nowrap shrink-0"
          >
            <Lock className="w-3.5 h-3.5" />
            {t.weekly.fixedActivitiesBtn}
          </button>

          <button
            type="button"
            onClick={() => setAiModalState({ open: true, mode: 'assistant' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t.weekly.aiScheduleBtn}
          </button>

          {scheduleVersions.length > 0 && (
            <div className="inline-flex items-center border border-zinc-300 rounded-md bg-white overflow-hidden shrink-0">
              <button
                type="button"
                onClick={undoLastScheduleChange}
                title={t.weekly.undoTitle}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 border-r border-zinc-200 whitespace-nowrap"
              >
                <Undo2 className="w-3.5 h-3.5" />
                {t.weekly.undoBtn}
              </button>
              <button
                type="button"
                onClick={() => setAiModalState({ open: true, mode: 'history' })}
                title={t.weekly.historyTitle}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono text-zinc-700 hover:bg-zinc-100 whitespace-nowrap"
              >
                <History className="w-3.5 h-3.5" />
                {scheduleVersions.length}
              </button>
            </div>
          )}

          <div className="inline-flex items-center border border-zinc-300 rounded-md bg-white overflow-hidden shrink-0">
            <button
              type="button"
              onClick={goToPrevWeek}
              aria-label={t.weekly.prevWeekAria}
              className="px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100 border-r border-zinc-200 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={goToCurrentWeek}
              className="px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 transition-colors whitespace-nowrap"
            >
              {t.common.today}
            </button>
            <button
              type="button"
              onClick={goToNextWeek}
              aria-label={t.weekly.nextWeekAria}
              className="px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100 border-l border-zinc-200 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {placementError && (
        <div className="mt-3 px-3.5 py-2.5 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            {placementError}
          </span>
          <button
            type="button"
            onClick={() => setPlacementError(null)}
            className="p-0.5 text-red-600 hover:text-red-900"
            aria-label={t.weekly.dismissErrorAria}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Split: Active Objectives Sidebar + 7-Day Agenda Grid */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 flex-1 min-h-0 items-start">
        {/* Left Sidebar */}
        <aside className="bg-zinc-100/70 border border-zinc-200 rounded-lg p-3 space-y-4 lg:max-h-[820px] lg:overflow-y-auto">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-xs font-semibold text-zinc-800">{t.weekly.activeObjectives}</h2>
            <button
              type="button"
              onClick={onNewTask}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-900"
            >
              <Plus className="w-3 h-3" />
              {t.weekly.newBtn}
            </button>
          </div>

          {tasks.length === 0 ? (
            <div className="bg-white border border-dashed border-zinc-300 rounded-md p-5 text-center">
              <p className="text-xs font-medium text-zinc-700">{t.weekly.emptyTitle}</p>
              <p className="text-[11px] text-zinc-500 mt-1">{t.weekly.emptyDesc}</p>
              <button
                type="button"
                onClick={onNewTask}
                className="mt-3 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 rounded hover:bg-zinc-800"
              >
                {t.weekly.createObjective}
              </button>
            </div>
          ) : (
            <>
              {/* WILL Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[11px] font-mono font-semibold text-zinc-900">
                    {t.weekly.willHeader}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                    {willTasks.length}
                  </span>
                </div>
                {willTasks.length === 0 ? (
                  <div className="px-3 py-2.5 text-[11px] text-zinc-400 bg-white/60 border border-zinc-200/80 rounded-md">
                    {t.weekly.noWill}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {willTasks.map((tItem) => renderSidebarTaskCard(tItem, true))}
                  </div>
                )}
              </div>

              {/* Active Horizon Section (no SHOULD/CAN label at task level) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[11px] font-mono font-semibold text-zinc-600">
                    {t.weekly.horizonHeader}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                    {horizonTasks.length}
                  </span>
                </div>
                {horizonTasks.length === 0 ? (
                  <div className="px-3 py-2.5 text-[11px] text-zinc-400 bg-white/60 border border-zinc-200/80 rounded-md">
                    {t.weekly.noHorizon}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {horizonTasks.map((tItem) => renderSidebarTaskCard(tItem, false))}
                  </div>
                )}
              </div>

              {/* Completed Toggle */}
              {completedTasks.length > 0 && (
                <div className="pt-2 border-t border-zinc-200">
                  <button
                    type="button"
                    onClick={() => setShowCompletedSidebar((v) => !v)}
                    className="w-full flex items-center justify-between px-1 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-800"
                  >
                    <span>{t.weekly.completedToggle}</span>
                    <span className="font-mono tabular-nums">
                      {showCompletedSidebar ? t.weekly.hide : t.weekly.show(completedTasks.length)}
                    </span>
                  </button>
                  {showCompletedSidebar && (
                    <div className="mt-2 space-y-2">
                      {completedTasks.map((tItem) => renderSidebarTaskCard(tItem, false))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </aside>

        {/* Weekly Calendar Grid (Sat–Fri) */}
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[780px]">
              {/* Day Headers */}
              <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-zinc-200 bg-zinc-50/90">
                <div className="py-2.5 px-2 text-[10px] font-mono text-zinc-400 border-r border-zinc-200 flex items-end justify-end">
                  {t.weekly.timeHeader}
                </div>
                {weekDays.map((dateStr) => {
                  const hdr = formatDayHeader(dateStr, language);
                  const isToday = dateStr === todayStr;
                  const dayDeadlines = deadlinesByDay.get(dateStr) ?? [];

                  return (
                    <div
                      key={dateStr}
                      className={`py-2 px-2 border-r last:border-r-0 border-zinc-200 flex flex-col justify-between gap-1 ${
                        isToday ? 'bg-zinc-900 text-white' : ''
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <span
                          className={`text-xs font-semibold ${
                            isToday ? 'text-white' : 'text-zinc-800'
                          }`}
                        >
                          {hdr.shortName}
                        </span>
                        <span
                          className={`text-xs font-mono tabular-nums ${
                            isToday ? 'text-zinc-200' : 'text-zinc-500'
                          }`}
                        >
                          {hdr.dayNum} {hdr.monthShort}
                        </span>
                      </div>

                      {dayDeadlines.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {dayDeadlines.slice(0, 2).map((dl, idx) => {
                            const sw = getTaskSwatch(dl.task.colorId);
                            return (
                              <span
                                key={`${dl.task.id}-${dl.deadline.id}-${idx}`}
                                title={t.weekly.deadlineTooltip(
                                  dl.task.name,
                                  dl.deadline.label,
                                  formatCompactDate(dl.deadline.date, language)
                                )}
                                className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-[9px] font-mono bg-white border truncate max-w-full"
                                style={{
                                  borderColor: sw.swatch,
                                  color: sw.text,
                                }}
                              >
                                <Flag
                                  className="w-2.5 h-2.5 shrink-0"
                                  style={{ color: sw.swatch }}
                                />
                                <span className="truncate">
                                  {dl.deadline.label || dl.task.name}
                                </span>
                              </span>
                            );
                          })}
                          {dayDeadlines.length > 2 && (
                            <span
                              className={`text-[9px] font-mono ${
                                isToday ? 'text-zinc-300' : 'text-zinc-500'
                              }`}
                            >
                              +{dayDeadlines.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Time Slots Body */}
              <div ref={calendarScrollRef} className="relative">
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
                  {/* Time Axis */}
                  <div
                    className="border-r border-zinc-200 bg-zinc-50/40 select-none"
                    style={{ height: `${(END_HOUR - START_HOUR) * 2 * SLOT_HEIGHT_PX}px` }}
                  >
                    {hourMarks.map((hr) => (
                      <div
                        key={hr}
                        className="border-b border-zinc-200/80 pr-2 pt-1 text-right"
                        style={{ height: `${SLOT_HEIGHT_PX * 2}px` }}
                      >
                        <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                          {String(hr).padStart(2, '0')}:00
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* 7 Day Columns */}
                  {weekDays.map((dateStr) => {
                    const isToday = dateStr === todayStr;
                    const dayBlocks = blocksByDay.get(dateStr) ?? [];
                    const dayFixed = fixedActivitiesByDay.get(dateStr) ?? [];
                    const dayDeadlines = deadlinesByDay.get(dateStr) ?? [];
                    const positioned = computeDayBlockLayout(dayBlocks);

                    const showNewGhost =
                      activeDrag?.kind === 'new-step' &&
                      activeDrag.isDragging &&
                      !activeDrag.targetFixedActivity &&
                      activeDrag.targetDate === dateStr &&
                      activeDrag.targetStartMinutes !== null;

                    const showMoveGhost =
                      activeDrag?.kind === 'move-block' &&
                      activeDrag.isDragging &&
                      activeDrag.targetDate === dateStr &&
                      activeDrag.targetStartMinutes !== null;

                    return (
                      <div
                        key={dateStr}
                        ref={(el) => {
                          dayColumnRefs.current[dateStr] = el;
                        }}
                        className={`relative border-r last:border-r-0 border-zinc-200 ${
                          isToday ? 'bg-zinc-50/70' : 'bg-white'
                        }`}
                        style={{ height: `${(END_HOUR - START_HOUR) * 2 * SLOT_HEIGHT_PX}px` }}
                      >
                        {/* 30-minute Grid Slot Lines */}
                        {hourMarks.map((hr) => (
                          <React.Fragment key={hr}>
                            <div
                              className="border-b border-zinc-100 pointer-events-none"
                              style={{ height: `${SLOT_HEIGHT_PX}px` }}
                            />
                            <div
                              className="border-b border-zinc-200/80 pointer-events-none"
                              style={{ height: `${SLOT_HEIGHT_PX}px` }}
                            />
                          </React.Fragment>
                        ))}

                        {/* Fixed Activities (Individual Per-Date Instances — Clickable to Edit) */}
                        {dayFixed.map((fa) => {
                          const clampedStart = Math.max(START_MINUTES, fa.startMinutes);
                          const clampedEnd = Math.min(END_MINUTES, fa.endMinutes);
                          if (clampedEnd <= clampedStart) return null;

                          const topPx = (clampedStart - START_MINUTES) * PX_PER_MINUTE;
                          const heightPx = Math.max(
                            SLOT_HEIGHT_PX,
                            (clampedEnd - clampedStart) * PX_PER_MINUTE
                          );
                          const refKey = `${dateStr}::${fa.id}`;
                          const isLinkDropTarget =
                            activeDrag?.kind === 'new-step' &&
                            activeDrag.isDragging &&
                            activeDrag.targetFixedActivity?.id === fa.id;

                          const resolvedLinked = fa.linkedStepIds
                            .map((sid) => stepMap.get(sid))
                            .filter((s): s is WBSStep => Boolean(s));

                          return (
                            <div
                              key={refKey}
                              ref={(el) => {
                                if (el) {
                                  fixedBlockRefs.current[refKey] = { el, activity: fa };
                                } else {
                                  delete fixedBlockRefs.current[refKey];
                                }
                              }}
                              onClick={() => {
                                if (activeDrag?.kind === 'new-step' && activeDrag.isDragging) return;
                                setFixedModalState({ open: true, editId: fa.id });
                              }}
                              style={{
                                top: `${topPx + 1}px`,
                                height: `${heightPx - 2}px`,
                                backgroundImage: fa.countsAsWorkingTime
                                  ? 'repeating-linear-gradient(-45deg, #f4f4f5, #f4f4f5 6px, #ececee 6px, #ececee 12px)'
                                  : 'repeating-linear-gradient(-45deg, #fafafa, #fafafa 6px, #f4f4f5 6px, #f4f4f5 12px)',
                              }}
                              className={`group absolute left-1 right-1 z-[8] rounded border px-1.5 py-1 flex flex-col justify-between overflow-hidden select-none cursor-pointer transition-colors hover:border-zinc-700 ${
                                isLinkDropTarget
                                  ? 'border-2 border-zinc-900 ring-2 ring-zinc-900/20'
                                  : fa.countsAsWorkingTime
                                  ? 'border-zinc-400 text-zinc-800'
                                  : 'border-zinc-300 text-zinc-500'
                              }`}
                              title={t.weekly.fixedTooltip(
                                fa.title,
                                `${formatMinutesToTime(fa.startMinutes)}–${formatMinutesToTime(
                                  fa.endMinutes
                                )}`,
                                fa.countsAsWorkingTime
                              )}
                            >
                              <div className="flex items-start justify-between gap-1 min-w-0">
                                <div className="flex items-center gap-1 min-w-0">
                                  <Lock className="w-2.5 h-2.5 shrink-0 opacity-70" />
                                  <span className="text-[11px] font-semibold truncate">
                                    {fa.title}
                                  </span>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFixedModalState({ open: true, editId: fa.id });
                                    }}
                                    title={t.weekly.editFixedTitle}
                                    aria-label={t.weekly.editFixedAria(fa.title)}
                                    className="p-0.5 rounded bg-white/80 text-zinc-600 hover:text-zinc-950 hover:bg-white transition-colors"
                                  >
                                    <Pencil className="w-2.5 h-2.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteFixedActivity(fa.id);
                                    }}
                                    title={t.weekly.deleteFixedTitle}
                                    aria-label={t.weekly.deleteFixedAria(fa.title)}
                                    className="p-0.5 rounded bg-white/80 text-zinc-600 hover:text-red-600 hover:bg-white transition-colors"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              </div>

                              {isLinkDropTarget && (
                                <div className="text-[10px] font-semibold text-zinc-900 bg-white/90 rounded px-1 py-0.5 truncate">
                                  {t.weekly.dropToLink}
                                </div>
                              )}

                              {!isLinkDropTarget && resolvedLinked.length > 0 && heightPx >= 44 && (
                                <div
                                  className="space-y-0.5 overflow-y-auto pr-0.5"
                                  onClick={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  {resolvedLinked.map((ls) => {
                                    const lt = taskMap.get(ls.taskId);
                                    const lswatch = lt ? getTaskSwatch(lt.colorId) : null;
                                    return (
                                      <div
                                        key={ls.id}
                                        className="flex items-center gap-1 bg-white/90 border border-zinc-300/80 rounded px-1 py-0.5 text-[10px]"
                                      >
                                        <StepExecutionControl
                                          compact
                                          executionState={ls.executionState}
                                          stepTitle={ls.title}
                                          varianceReason={ls.varianceReason}
                                          onChangeState={(nextState, reason) =>
                                            setStepExecutionState(
                                              ls.id,
                                              nextState,
                                              reason,
                                              displayedWeekStart
                                            )
                                          }
                                        />
                                        {lswatch && (
                                          <span
                                            className="w-1.5 h-1.5 rounded-full shrink-0"
                                            style={{ backgroundColor: lswatch.swatch }}
                                          />
                                        )}
                                        <span
                                          className={`flex-1 min-w-0 truncate ${
                                            ls.completed ? 'line-through text-zinc-400' : 'text-zinc-800'
                                          }`}
                                        >
                                          {ls.title}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            unlinkStepFromFixedActivity(fa.id, ls.id);
                                          }}
                                          className="text-zinc-400 hover:text-red-600 shrink-0"
                                          title={t.weekly.unlinkTitle}
                                          aria-label={t.weekly.unlinkAria(ls.title)}
                                        >
                                          <X className="w-2.5 h-2.5" />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {heightPx >= 42 && resolvedLinked.length === 0 && !isLinkDropTarget && (
                                <div className="text-[10px] font-mono tabular-nums opacity-70 leading-none">
                                  {formatMinutesToTime(fa.startMinutes)}–{formatMinutesToTime(fa.endMinutes)}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Snapped Drop Ghost (New Step from Sidebar) */}
                        {showNewGhost &&
                          activeDrag.kind === 'new-step' &&
                          activeDrag.targetStartMinutes !== null && (
                            <div
                              className={`absolute left-1 right-1 z-20 rounded border-2 border-dashed px-2 py-1 pointer-events-none ${
                                newStepGhostValid ? 'border-zinc-800' : 'border-red-600'
                              }`}
                              style={{
                                top: `${(activeDrag.targetStartMinutes - START_MINUTES) * PX_PER_MINUTE}px`,
                                height: `${activeDrag.step.estimatedMinutes * PX_PER_MINUTE}px`,
                                backgroundColor: newStepGhostValid
                                  ? getTaskSwatch(activeDrag.task.colorId).bg
                                  : '#fef2f2',
                                opacity: 0.9,
                              }}
                            >
                              <div className="text-[11px] font-semibold text-zinc-900 truncate">
                                {activeDrag.step.title}
                              </div>
                              <div className="text-[10px] font-mono tabular-nums text-zinc-700">
                                {newStepGhostValid
                                  ? `${formatMinutesToTime(activeDrag.targetStartMinutes)} – ${formatMinutesToTime(
                                      activeDrag.targetStartMinutes + activeDrag.step.estimatedMinutes
                                    )}`
                                  : t.weekly.blockedConflict}
                              </div>
                            </div>
                          )}

                        {/* Snapped Drop Ghost (Moving Existing Block) */}
                        {showMoveGhost &&
                          activeDrag.kind === 'move-block' &&
                          activeDrag.targetStartMinutes !== null && (
                            <div
                              className={`absolute left-1 right-1 z-20 rounded border-2 border-dashed px-2 py-1 pointer-events-none ${
                                moveBlockGhostValid ? 'border-zinc-800' : 'border-red-600'
                              }`}
                              style={{
                                top: `${(activeDrag.targetStartMinutes - START_MINUTES) * PX_PER_MINUTE}px`,
                                height: `${activeDrag.block.durationMinutes * PX_PER_MINUTE}px`,
                                backgroundColor: moveBlockGhostValid
                                  ? getTaskSwatch(activeDrag.task.colorId).bg
                                  : '#fef2f2',
                                opacity: 0.85,
                              }}
                            >
                              <div className="text-[11px] font-semibold text-zinc-900 truncate">
                                {activeDrag.step.title}
                              </div>
                              <div className="text-[10px] font-mono tabular-nums text-zinc-700">
                                {moveBlockGhostValid
                                  ? `${formatMinutesToTime(activeDrag.targetStartMinutes)} – ${formatMinutesToTime(
                                      activeDrag.targetStartMinutes + activeDrag.block.durationMinutes
                                    )}`
                                  : t.weekly.blockedConflict}
                              </div>
                            </div>
                          )}

                        {/* Scheduled Blocks */}
                        {positioned.map(({ block, colIndex, totalCols }) => {
                          const task = taskMap.get(block.taskId);
                          const step = stepMap.get(block.stepId);
                          if (!task || !step) return null;

                          const swatch = getTaskSwatch(task.colorId);
                          const isBeingMoved =
                            activeDrag?.kind === 'move-block' &&
                            activeDrag.isDragging &&
                            activeDrag.block.id === block.id;
                          const isBeingResized =
                            activeDrag?.kind === 'resize-block' &&
                            activeDrag.block.id === block.id;

                          const displayDuration = isBeingResized
                            ? activeDrag.previewDuration
                            : block.durationMinutes;

                          const topPx = (block.startMinutes - START_MINUTES) * PX_PER_MINUTE;
                          const heightPx = Math.max(SLOT_HEIGHT_PX, displayDuration * PX_PER_MINUTE);
                          const widthPct = 100 / totalCols;
                          const leftPct = colIndex * widthPct;
                          const isCompact = heightPx <= 32;

                          return (
                            <div
                              key={block.id}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                const target = e.target as HTMLElement;
                                if (
                                  target.closest('[data-block-action]') ||
                                  target.closest('[data-resize-handle]')
                                ) {
                                  return;
                                }
                                e.preventDefault();
                                const rect = e.currentTarget.getBoundingClientRect();
                                const grabOffsetMinutes = Math.max(
                                  0,
                                  (e.clientY - rect.top) / PX_PER_MINUTE
                                );
                                setActiveDrag({
                                  kind: 'move-block',
                                  block,
                                  step,
                                  task,
                                  startX: e.clientX,
                                  startY: e.clientY,
                                  clientX: e.clientX,
                                  clientY: e.clientY,
                                  grabOffsetMinutes,
                                  isDragging: false,
                                  targetDate: block.date,
                                  targetStartMinutes: block.startMinutes,
                                });
                              }}
                              style={{
                                top: `${topPx + 1}px`,
                                height: `${heightPx - 2}px`,
                                left: `calc(${leftPct}% + 2px)`,
                                width: `calc(${widthPct}% - 4px)`,
                                backgroundColor: swatch.bg,
                                borderColor: swatch.border,
                                color: swatch.text,
                                opacity: isBeingMoved ? 0.35 : step.completed ? 0.72 : 1,
                              }}
                              className="group absolute z-10 rounded border px-1.5 py-1 flex flex-col justify-between overflow-visible cursor-grab active:cursor-grabbing select-none"
                            >
                              <div className="flex items-start gap-1 min-w-0">
                                <StepExecutionControl
                                  executionState={step.executionState}
                                  stepTitle={step.title}
                                  varianceReason={step.varianceReason}
                                  onChangeState={(nextState, reason) =>
                                    setStepExecutionState(
                                      step.id,
                                      nextState,
                                      reason,
                                      displayedWeekStart
                                    )
                                  }
                                />

                                <div className="min-w-0 flex-1 leading-tight overflow-hidden">
                                  <div
                                    className={`text-[11px] font-semibold truncate ${
                                      step.completed ? 'line-through' : ''
                                    }`}
                                    title={`${step.title} (${task.name})${
                                      step.executionState === 'done_variance' && step.varianceReason
                                        ? ` — ${t.weekly.stepTooltipVariance}: ${step.varianceReason}`
                                        : ''
                                    }`}
                                  >
                                    {step.title}
                                  </div>
                                  {!isCompact && (
                                    <div className="text-[10px] opacity-75 truncate mt-0.5">
                                      {task.name}
                                    </div>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  data-block-action="true"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    unscheduleBlock(block.id);
                                  }}
                                  title={t.weekly.removeCalendarTitle}
                                  aria-label={t.weekly.unscheduleAria(step.title)}
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-black/10 transition-opacity shrink-0"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>

                              {heightPx >= 46 && (
                                <div className="text-[10px] font-mono tabular-nums opacity-75 leading-none pb-0.5 flex items-center justify-between gap-1">
                                  <span>
                                    {formatMinutesToTime(block.startMinutes)} –{' '}
                                    {formatMinutesToTime(block.startMinutes + displayDuration)}
                                  </span>
                                  {step.executionState === 'done_variance' && (
                                    <span className="text-[9px] font-semibold text-amber-800">
                                      {t.weekly.varianceTag}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Bottom Resize Handle */}
                              <div
                                data-resize-handle="true"
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setActiveDrag({
                                    kind: 'resize-block',
                                    block,
                                    step,
                                    startY: e.clientY,
                                    initialDuration: block.durationMinutes,
                                    previewDuration: block.durationMinutes,
                                  });
                                }}
                                title={t.weekly.resizeTitle}
                                className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize flex items-center justify-center opacity-0 group-hover:opacity-100"
                              >
                                <span className="w-6 h-0.5 rounded-full bg-black/30" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right-Side Flyout for Hovered / Pinned Task WBS Steps */}
      {flyout &&
        !(activeDrag?.kind === 'new-step' && activeDrag.isDragging) &&
        (() => {
          const flyoutTask = taskMap.get(flyout.taskId);
          if (!flyoutTask) return null;
          const swatch = getTaskSwatch(flyoutTask.colorId);
          const taskSteps = stepsByTask.get(flyoutTask.id) ?? [];
          const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
          const estimatedHeight = Math.min(400, 72 + Math.max(1, taskSteps.length) * 42);
          const leftPos = isDesktop
            ? Math.min(flyout.rect.right + 8, window.innerWidth - 364)
            : Math.max(12, Math.min(flyout.rect.left, window.innerWidth - 364));
          const topPos = isDesktop
            ? Math.max(12, Math.min(flyout.rect.top, window.innerHeight - estimatedHeight - 16))
            : Math.max(12, Math.min(flyout.rect.bottom + 6, window.innerHeight - estimatedHeight - 16));

          return (
            <div
              onMouseEnter={() => {
                isPointerInFlyoutRef.current = true;
                cancelCloseFlyout();
              }}
              onMouseLeave={() => {
                isPointerInFlyoutRef.current = false;
                if (pinnedTaskId === flyoutTask.id) return;
                scheduleCloseFlyout();
              }}
              style={{ left: `${leftPos}px`, top: `${topPos}px` }}
              className="fixed z-40 w-[352px] bg-white border border-zinc-300 rounded-lg shadow-md p-3"
            >
              <div
                aria-hidden="true"
                className="hidden lg:block absolute -left-3 top-0 bottom-0 w-3"
              />

              <div className="flex items-start justify-between gap-2 pb-2 mb-2 border-b border-zinc-100">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm border shrink-0"
                    style={{ backgroundColor: swatch.bg, borderColor: swatch.swatch }}
                  />
                  <span className="text-xs font-semibold text-zinc-900 truncate">
                    {flyoutTask.name}
                  </span>
                </div>
                {pinnedTaskId === flyoutTask.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setPinnedTaskId(null);
                      setFlyout(null);
                    }}
                    className="p-0.5 text-zinc-400 hover:text-zinc-800 rounded shrink-0"
                    aria-label={t.weekly.closeFlyoutAria}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {taskSteps.length === 0 ? (
                <div className="flex items-center justify-between gap-2 py-2 text-xs text-zinc-500">
                  <span>{t.weekly.noStepsYet}</span>
                  <button
                    type="button"
                    onClick={() => openTaskInWBS(flyoutTask.id)}
                    className="inline-flex items-center gap-1 font-medium text-zinc-900 hover:underline"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    {t.weekly.addInWbs}
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {taskSteps.map((step, idx) => {
                    const weekSchedCount = scheduledStepIdsInWeek.get(step.id) ?? 0;
                    const weekLinkedCount = linkedStepIdsInWeek.get(step.id) ?? 0;
                    const isPlacedInWwp = weekSchedCount > 0 || weekLinkedCount > 0;
                    const hasDeps = step.dependsOnStepIds.length > 0;
                    const pullLabel = getStepPullClassification(step, stepMap);

                    return (
                      <div
                        key={step.id}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          if ((e.target as HTMLElement).closest('[data-step-checkbox]')) return;
                          e.preventDefault();
                          setActiveDrag({
                            kind: 'new-step',
                            step,
                            task: flyoutTask,
                            startX: e.clientX,
                            startY: e.clientY,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            isDragging: false,
                            targetDate: null,
                            targetStartMinutes: null,
                            targetFixedActivity: null,
                          });
                        }}
                        title={
                          isPlacedInWwp
                            ? t.weekly.alreadyPlacedTitle
                            : t.weekly.dragToScheduleTitle
                        }
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs cursor-grab active:cursor-grabbing select-none transition-opacity"
                        style={
                          isPlacedInWwp
                            ? {
                                backgroundColor: '#f4f4f5',
                                borderColor: '#d4d4d8',
                                color: '#71717a',
                                opacity: 0.72,
                              }
                            : {
                                backgroundColor: swatch.bg,
                                borderColor: swatch.border,
                                color: swatch.text,
                                opacity: step.completed ? 0.65 : 1,
                              }
                        }
                      >
                        <StepExecutionControl
                          executionState={step.executionState}
                          stepTitle={step.title}
                          varianceReason={step.varianceReason}
                          onOverlayOpenChange={(open) => {
                            openOverlayCountRef.current = Math.max(
                              0,
                              openOverlayCountRef.current + (open ? 1 : -1)
                            );
                            if (open) {
                              cancelCloseFlyout();
                            } else if (
                              openOverlayCountRef.current === 0 &&
                              pinnedTaskIdRef.current !== flyoutTask.id
                            ) {
                              scheduleCloseFlyout();
                            }
                          }}
                          onChangeState={(nextState, reason) =>
                            setStepExecutionState(step.id, nextState, reason, displayedWeekStart)
                          }
                        />

                        <span className="font-mono text-[10px] opacity-70 tabular-nums shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>

                        <span
                          className={`flex-1 min-w-0 truncate font-medium ${
                            step.completed ? 'line-through' : ''
                          }`}
                        >
                          {step.title}
                        </span>

                        {/* Dynamic Pull Tag: ONLY SHOULD or CAN for incomplete 'Me' steps */}
                        {pullLabel === 'SHOULD' && (
                          <span
                            title={t.weekly.shouldTooltip}
                            className={`px-1 py-0.5 text-[9px] font-mono font-semibold rounded shrink-0 border ${
                              isPlacedInWwp
                                ? 'bg-zinc-200/70 text-zinc-500 border-zinc-300'
                                : 'bg-amber-50 text-amber-800 border-amber-300'
                            }`}
                          >
                            {t.weekly.shouldTag}
                          </span>
                        )}
                        {pullLabel === 'CAN' && (
                          <span
                            title={t.weekly.canTooltip}
                            className={`px-1 py-0.5 text-[9px] font-mono font-semibold rounded shrink-0 border ${
                              isPlacedInWwp
                                ? 'bg-zinc-200/70 text-zinc-500 border-zinc-300'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            }`}
                          >
                            {t.weekly.canTag}
                          </span>
                        )}

                        {!step.completed && (
                          <button
                            type="button"
                            data-step-checkbox="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStepInProgress(step.id);
                            }}
                            title={
                              step.flowStatus === 'in_progress'
                                ? t.weekly.wipTooltip
                                : t.weekly.startTooltip
                            }
                            className={`px-1 py-0.5 text-[9px] font-mono font-medium rounded border shrink-0 inline-flex items-center gap-0.5 ${
                              isPlacedInWwp
                                ? 'bg-zinc-100 text-zinc-500 border-zinc-300 hover:border-zinc-500'
                                : step.flowStatus === 'in_progress'
                                ? 'bg-sky-100 text-sky-900 border-sky-300'
                                : 'bg-white/70 text-zinc-600 border-zinc-300 hover:border-zinc-700'
                            }`}
                          >
                            <Play className="w-2 h-2" />
                            {step.flowStatus === 'in_progress' ? t.weekly.wipBtn : t.weekly.startBtn}
                          </button>
                        )}

                        {hasDeps && (
                          <span title={t.weekly.hasDepsTitle} className="shrink-0">
                            <Link2 className="w-3 h-3 opacity-60" />
                          </span>
                        )}

                        <span className="font-mono text-[10px] opacity-75 tabular-nums shrink-0">
                          {step.responsibility === 'Others'
                            ? `${t.common.responsibility.Others} · `
                            : ''}
                          {formatDuration(step.estimatedMinutes)}
                          {weekSchedCount > 0 ? ` · ${weekSchedCount}×` : ''}
                          {weekLinkedCount > 0 ? ` · ${t.weekly.linkedTag}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

      {/* Floating Drag Preview when pulling a WBS Step Rectangle from the Sidebar */}
      {activeDrag?.kind === 'new-step' && activeDrag.isDragging && (
        <div
          className="fixed z-50 pointer-events-none rounded border px-2.5 py-1.5 text-xs font-medium shadow-sm w-56 flex items-center justify-between gap-2"
          style={{
            left: `${activeDrag.clientX + 12}px`,
            top: `${activeDrag.clientY + 12}px`,
            backgroundColor: getTaskSwatch(activeDrag.task.colorId).bg,
            borderColor: getTaskSwatch(activeDrag.task.colorId).border,
            color: getTaskSwatch(activeDrag.task.colorId).text,
          }}
        >
          <span className="truncate">
            {activeDrag.targetFixedActivity
              ? t.weekly.linkToFixed(activeDrag.targetFixedActivity.title)
              : activeDrag.step.title}
          </span>
          <span className="font-mono text-[10px] opacity-75 shrink-0">
            {formatDuration(activeDrag.step.estimatedMinutes)}
          </span>
        </div>
      )}

      {/* Weekly Variance & Step Review Modal */}
      {varianceModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wwp-variance-title"
          onClick={() => setVarianceModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-white border border-zinc-200 rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
              <div>
                <h2 id="wwp-variance-title" className="text-base font-semibold text-zinc-900">
                  {t.weekly.varianceModalTitle(isoWeekNum)}
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                  {weekRangeLabel} ·{' '}
                  {weekPpcSummary.pct !== null
                    ? t.weekly.varianceModalStepsSummary(
                        weekPpcSummary.completed,
                        weekPpcSummary.total,
                        weekPpcSummary.pct
                      )
                    : t.weekly.noStepsScheduledYet}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVarianceModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md"
                aria-label={t.weekly.closeVarianceAria}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <label
                  htmlFor="wwp-overall-variance"
                  className="block text-xs font-semibold text-zinc-800 mb-1.5"
                >
                  {t.weekly.overallVarianceLabel}
                </label>
                <textarea
                  id="wwp-overall-variance"
                  rows={3}
                  value={currentWeekPpcRecord?.reasonsForVariance ?? ''}
                  onChange={(e) =>
                    updateWeekVarianceReason(displayedWeekStart, e.target.value)
                  }
                  placeholder={t.weekly.overallVariancePlaceholder}
                  className="w-full px-3 py-2 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900 resize-none"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  {t.weekly.overallVarianceHint}
                </p>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {t.weekly.breakdownHeading(weekUniqueScheduledSteps.length)}
                </h3>

                {weekUniqueScheduledSteps.length === 0 ? (
                  <div className="p-5 border border-dashed border-zinc-300 rounded-md text-center text-xs text-zinc-500">
                    {t.weekly.noStepsInWeek(isoWeekNum)}
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-md">
                    {weekUniqueScheduledSteps.map((step) => {
                      const task = taskMap.get(step.taskId);
                      const swatch = task ? getTaskSwatch(task.colorId) : null;
                      const recordedEntry = currentWeekPpcRecord?.stepVariances.find(
                        (sv) => sv.stepId === step.id
                      );
                      const currentReason = recordedEntry?.reason ?? step.varianceReason ?? '';

                      return (
                        <div key={step.id} className="p-3 bg-white space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <StepExecutionControl
                                executionState={step.executionState}
                                stepTitle={step.title}
                                varianceReason={currentReason}
                                onChangeState={(nextState, reason) =>
                                  setStepExecutionState(
                                    step.id,
                                    nextState,
                                    reason,
                                    displayedWeekStart
                                  )
                                }
                              />
                              {swatch && (
                                <span
                                  className="w-2.5 h-2.5 rounded-sm border shrink-0"
                                  style={{ backgroundColor: swatch.bg, borderColor: swatch.swatch }}
                                />
                              )}
                              <span className="text-xs font-semibold text-zinc-900 truncate">
                                {step.title}
                              </span>
                              {task && (
                                <span className="text-[11px] text-zinc-500 truncate">
                                  ({task.name})
                                </span>
                              )}
                            </div>

                            <span className="shrink-0">
                              {step.executionState === 'done_expected' ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {t.execution.doneExpected}
                                </span>
                              ) : step.executionState === 'done_variance' ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded">
                                  <AlertTriangle className="w-3 h-3" />
                                  {t.execution.doneVarianceShort}
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-700 border border-zinc-200 rounded">
                                  {t.execution.notDone}
                                </span>
                              )}
                            </span>
                          </div>

                          {(step.executionState === 'done_variance' ||
                            step.executionState === 'not_done' ||
                            currentReason.trim().length > 0) && (
                            <input
                              type="text"
                              value={currentReason}
                              onChange={(e) =>
                                updateStepVariance(displayedWeekStart, step.id, e.target.value)
                              }
                              placeholder={t.weekly.stepVariancePlaceholder}
                              className="w-full px-2.5 py-1 text-[11px] text-zinc-900 bg-zinc-50 border border-zinc-200 rounded focus:outline-none focus:border-zinc-900"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <FixedActivityModal
        isOpen={fixedModalState.open}
        initialEditActivityId={fixedModalState.editId}
        onClose={() => setFixedModalState({ open: false, editId: null })}
      />

      <AIScheduleModal
        isOpen={aiModalState.open}
        initialMode={aiModalState.mode}
        onClose={() => setAiModalState((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
};
