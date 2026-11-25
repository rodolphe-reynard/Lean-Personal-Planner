import {
  AIConflict,
  AIProposedBlockInput,
  AIScheduleProposal,
  FixedActivity,
  ProposalDiffItem,
  RecurrenceFrequency,
  ScheduledBlock,
  StepPullLabel,
  Task,
  WBSStep,
  WorkCapacitySettings,
} from '../types';
import {
  addDays,
  formatMinutesToTime,
  formatShortDate,
  getStartOfWeek,
  isValidDateString,
  parseLocalDate,
} from './dateUtils';

export const DEFAULT_WORK_CAPACITY: WorkCapacitySettings = {
  workdays: [1, 2, 3, 4, 5], // Mon–Fri working days
  workdayStartMinutes: 8 * 60, // 08:00
  workdayEndMinutes: 18 * 60, // 18:00
  dailyTargetHours: 8,
};

export function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && endA > startB;
}

/**
 * Generates concrete YYYY-MM-DD dates for batch creation of independent FixedActivity instances.
 * When recurrence is 'weekly' or 'biweekly' and endDate is omitted, defaults to an 8-week horizon.
 */
export function expandFixedActivityDates(input: {
  startDate: string;
  endDate?: string;
  recurrence: RecurrenceFrequency;
  daysOfWeek: number[];
}): string[] {
  const start = isValidDateString(input.startDate) ? input.startDate : addDays(getStartOfWeek(new Date().toISOString().slice(0, 10)), 0);
  if (input.recurrence === 'once') {
    return [start];
  }

  const defaultEnd = addDays(start, 55); // 8 Sat–Fri weeks inclusive
  const end = input.endDate && isValidDateString(input.endDate) && input.endDate >= start
    ? input.endDate
    : defaultEnd;

  const anchorWeek = parseLocalDate(getStartOfWeek(start)).getTime();
  const daySet = new Set(input.daysOfWeek);
  const dates: string[] = [];
  let cursor = start;
  let guard = 0;

  while (cursor <= end && guard < 366) {
    const dow = parseLocalDate(cursor).getDay();
    if (daySet.has(dow)) {
      if (input.recurrence === 'biweekly') {
        const targetWeek = parseLocalDate(getStartOfWeek(cursor)).getTime();
        const diffWeeks = Math.round((targetWeek - anchorWeek) / (7 * 86400000));
        if (Math.abs(diffWeeks) % 2 === 0) {
          dates.push(cursor);
        }
      } else {
        dates.push(cursor);
      }
    }
    cursor = addDays(cursor, 1);
    guard += 1;
  }

  return dates;
}

/**
 * Fixed activities are individual per-date instances.
 */
export function getFixedActivitiesForDate(
  fixedActivities: FixedActivity[],
  dateStr: string
): FixedActivity[] {
  return fixedActivities
    .filter((fa) => fa.date === dateStr)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

/**
 * Checks if adding `candidatePredId` as a predecessor of `stepId` creates a dependency cycle.
 */
export function hasDependencyCycle(
  steps: WBSStep[],
  stepId: string,
  candidatePredId: string
): boolean {
  if (stepId === candidatePredId) return true;
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const stack = [candidatePredId];

  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === stepId) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);
    const node = stepById.get(curr);
    if (node) {
      for (const p of node.dependsOnStepIds) {
        if (!visited.has(p)) stack.push(p);
      }
    }
  }
  return false;
}

/**
 * Dynamic WWP Pull Classification for Individual Steps:
 * - Only applies to incomplete steps where responsibility === 'Me'.
 * - SHOULD: Has at least one unfinished predecessor (direct or transitive) assigned to 'Others'.
 * - CAN: No unfinished 'Others' predecessors; available for 'Me' to perform.
 * - Steps assigned to 'Others' (or already completed) receive null.
 */
export function getStepPullClassification(
  step: WBSStep,
  stepMap: Map<string, WBSStep>
): StepPullLabel {
  if (step.responsibility !== 'Me' || step.completed) {
    return null;
  }

  const visited = new Set<string>();
  const stack = [...step.dependsOnStepIds];

  while (stack.length > 0) {
    const predId = stack.pop()!;
    if (visited.has(predId)) continue;
    visited.add(predId);
    const pred = stepMap.get(predId);
    if (!pred) continue;

    if (!pred.completed && pred.responsibility === 'Others') {
      return 'SHOULD';
    }
    for (const upstreamId of pred.dependsOnStepIds) {
      if (!visited.has(upstreamId)) {
        stack.push(upstreamId);
      }
    }
  }

  return 'CAN';
}

function compareDateTime(dateA: string, minA: number, dateB: string, minB: number): number {
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  return minA - minB;
}

/**
 * Validates placing or moving a scheduled block against:
 * 1) Fixed activities on that date (cannot overlap/overwrite)
 * 2) Step predecessors (cannot schedule before any incomplete predecessor completes)
 * 3) Dependent successors (cannot move/extend a predecessor past an already-scheduled successor)
 */
export function validateStepPlacement(params: {
  step: WBSStep;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  ignoreBlockId?: string;
  allSteps: WBSStep[];
  scheduledBlocks: ScheduledBlock[];
  fixedActivities: FixedActivity[];
}): { ok: true } | { ok: false; reason: string } {
  const {
    step,
    date,
    startMinutes,
    durationMinutes,
    ignoreBlockId,
    allSteps,
    scheduledBlocks,
    fixedActivities,
  } = params;

  const endMinutes = startMinutes + durationMinutes;

  // 1. Fixed activities immutability check
  const dayFixed = getFixedActivitiesForDate(fixedActivities, date);
  for (const fa of dayFixed) {
    if (intervalsOverlap(startMinutes, endMinutes, fa.startMinutes, fa.endMinutes)) {
      return {
        ok: false,
        reason: `Cannot overwrite fixed activity "${fa.title}" (${formatMinutesToTime(
          fa.startMinutes
        )}–${formatMinutesToTime(fa.endMinutes)}). Drag onto it to link instead.`,
      };
    }
  }

  const stepMap = new Map(allSteps.map((s) => [s.id, s]));
  const otherBlocks = scheduledBlocks.filter((b) => b.id !== ignoreBlockId);

  // 2. Predecessor dependency check
  for (const predId of step.dependsOnStepIds) {
    const pred = stepMap.get(predId);
    if (!pred || pred.completed) continue;

    const predBlocks = otherBlocks.filter((b) => b.stepId === pred.id);
    if (predBlocks.length === 0) {
      return {
        ok: false,
        reason: `Predecessor "${pred.title}" must be completed or scheduled first.`,
      };
    }

    const hasEarlierCompletion = predBlocks.some(
      (pb) =>
        compareDateTime(pb.date, pb.startMinutes + pb.durationMinutes, date, startMinutes) <= 0
    );
    if (!hasEarlierCompletion) {
      const earliest = [...predBlocks].sort(
        (a, b) => compareDateTime(a.date, a.startMinutes, b.date, b.startMinutes)
      )[0];
      return {
        ok: false,
        reason: `Cannot schedule "${step.title}" before predecessor "${pred.title}" finishes (${formatShortDate(
          earliest.date
        )} ${formatMinutesToTime(earliest.startMinutes + earliest.durationMinutes)}).`,
      };
    }
  }

  // 3. Successor dependency check (if moving/resizing an incomplete predecessor)
  if (!step.completed) {
    const successors = allSteps.filter((s) => s.dependsOnStepIds.includes(step.id));
    for (const succ of successors) {
      const succBlocks = otherBlocks.filter((b) => b.stepId === succ.id);
      for (const sb of succBlocks) {
        if (compareDateTime(date, endMinutes, sb.date, sb.startMinutes) > 0) {
          return {
            ok: false,
            reason: `Cannot move "${step.title}" past dependent step "${succ.title}" (${formatShortDate(
              sb.date
            )} ${formatMinutesToTime(sb.startMinutes)}).`,
          };
        }
      }
    }
  }

  return { ok: true };
}

export interface WeeklyCapacitySummary {
  grossCapacityMinutes: number;
  nonWorkingFixedOverlapMinutes: number;
  netCapacityMinutes: number;
  fixedWorkingMinutes: number;
  scheduledStepsMinutes: number;
  totalWorkingMinutes: number;
  remainingAvailableMinutes: number;
}

export function calculateWeeklyCapacityStats(
  weekDays: string[],
  fixedActivities: FixedActivity[],
  scheduledBlocks: ScheduledBlock[],
  workCapacity: WorkCapacitySettings
): WeeklyCapacitySummary {
  const workdaySet = new Set(workCapacity.workdays);
  const dailyWindow = Math.max(0, workCapacity.workdayEndMinutes - workCapacity.workdayStartMinutes);
  let grossCapacityMinutes = 0;
  let nonWorkingFixedOverlapMinutes = 0;
  let fixedWorkingMinutes = 0;

  for (const dateStr of weekDays) {
    const dayOfWeek = parseLocalDate(dateStr).getDay();
    const isWorkday = workdaySet.has(dayOfWeek);
    if (isWorkday) {
      grossCapacityMinutes += dailyWindow;
    }

    const dayFixed = getFixedActivitiesForDate(fixedActivities, dateStr);
    for (const fa of dayFixed) {
      const dur = Math.max(0, fa.endMinutes - fa.startMinutes);
      if (fa.countsAsWorkingTime) {
        fixedWorkingMinutes += dur;
      } else if (isWorkday) {
        const overlapStart = Math.max(fa.startMinutes, workCapacity.workdayStartMinutes);
        const overlapEnd = Math.min(fa.endMinutes, workCapacity.workdayEndMinutes);
        if (overlapEnd > overlapStart) {
          nonWorkingFixedOverlapMinutes += overlapEnd - overlapStart;
        }
      }
    }
  }

  const weekSet = new Set(weekDays);
  const scheduledStepsMinutes = scheduledBlocks
    .filter((b) => weekSet.has(b.date))
    .reduce((acc, b) => acc + b.durationMinutes, 0);

  const netCapacityMinutes = Math.max(0, grossCapacityMinutes - nonWorkingFixedOverlapMinutes);
  const totalWorkingMinutes = fixedWorkingMinutes + scheduledStepsMinutes;
  const remainingAvailableMinutes = Math.max(0, netCapacityMinutes - totalWorkingMinutes);

  return {
    grossCapacityMinutes,
    nonWorkingFixedOverlapMinutes,
    netCapacityMinutes,
    fixedWorkingMinutes,
    scheduledStepsMinutes,
    totalWorkingMinutes,
    remainingAvailableMinutes,
  };
}

export function validateAndBuildAIProposal(params: {
  weekStart: string;
  weekDays: string[];
  summary: string;
  aiConflicts: AIConflict[];
  rawProposed: AIProposedBlockInput[];
  tasks: Task[];
  steps: WBSStep[];
  fixedActivities: FixedActivity[];
  currentWeekBlocks: ScheduledBlock[];
  allBlocksOutsideWeek: ScheduledBlock[];
}): AIScheduleProposal {
  const {
    weekStart,
    weekDays,
    summary,
    aiConflicts,
    rawProposed,
    tasks,
    steps,
    fixedActivities,
    currentWeekBlocks,
    allBlocksOutsideWeek,
  } = params;

  const weekDaySet = new Set(weekDays);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const conflicts: AIConflict[] = [...aiConflicts];

  const accepted: ScheduledBlock[] = [];
  const reasonsByStepId = new Map<string, string>();

  const isSlotFree = (date: string, startMin: number, durMin: number): boolean => {
    const endMin = startMin + durMin;
    if (startMin < 7 * 60 || endMin > 22 * 60) return false;
    const dayFixed = getFixedActivitiesForDate(fixedActivities, date);
    for (const fa of dayFixed) {
      if (intervalsOverlap(startMin, endMin, fa.startMinutes, fa.endMinutes)) return false;
    }
    for (const blk of accepted) {
      if (blk.date === date && intervalsOverlap(startMin, endMin, blk.startMinutes, blk.startMinutes + blk.durationMinutes)) {
        return false;
      }
    }
    return true;
  };

  const sortedCandidates = [...rawProposed]
    .filter((item) => {
      const step = stepMap.get(item.stepId);
      const task = taskMap.get(item.taskId);
      if (!step || !task) return false;
      if (!weekDaySet.has(item.date)) return false;
      if (step.completed) return false;
      if (step.responsibility === 'Others') {
        const wasAlreadyScheduled = currentWeekBlocks.some((b) => b.stepId === step.id);
        if (!wasAlreadyScheduled) {
          conflicts.push({
            severity: 'warning',
            message: `Skipped "${step.title}" because responsibility is assigned to Others.`,
          });
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startMinutes - b.startMinutes;
    });

  const currentByStep = new Map<string, ScheduledBlock[]>();
  for (const b of currentWeekBlocks) {
    const arr = currentByStep.get(b.stepId) ?? [];
    arr.push(b);
    currentByStep.set(b.stepId, arr);
  }

  const now = Date.now();
  for (const cand of sortedCandidates) {
    const step = stepMap.get(cand.stepId)!;
    const snappedStart = Math.max(
      7 * 60,
      Math.min(21 * 60 + 30, Math.round(cand.startMinutes / 30) * 30)
    );
    const snappedDuration = Math.max(30, Math.round(cand.durationMinutes / 30) * 30);

    const combinedBlocks = [...allBlocksOutsideWeek, ...accepted];
    const depCheck = validateStepPlacement({
      step,
      date: cand.date,
      startMinutes: snappedStart,
      durationMinutes: snappedDuration,
      allSteps: steps,
      scheduledBlocks: combinedBlocks,
      fixedActivities,
    });

    let chosenDate = cand.date;
    let chosenStart = snappedStart;

    if (!depCheck.ok || !isSlotFree(chosenDate, chosenStart, snappedDuration)) {
      let placed = false;
      const startDayIdx = weekDays.indexOf(cand.date);
      for (let dIdx = Math.max(0, startDayIdx); dIdx < weekDays.length && !placed; dIdx++) {
        const tryDate = weekDays[dIdx];
        const minTryStart = dIdx === startDayIdx ? snappedStart : 8 * 60;
        for (let m = minTryStart; m + snappedDuration <= 20 * 60; m += 30) {
          if (!isSlotFree(tryDate, m, snappedDuration)) continue;
          const tryCheck = validateStepPlacement({
            step,
            date: tryDate,
            startMinutes: m,
            durationMinutes: snappedDuration,
            allSteps: steps,
            scheduledBlocks: combinedBlocks,
            fixedActivities,
          });
          if (tryCheck.ok) {
            chosenDate = tryDate;
            chosenStart = m;
            placed = true;
            break;
          }
        }
      }

      if (!placed) {
        conflicts.push({
          severity: 'warning',
          date: cand.date,
          message: `Could not schedule "${step.title}": ${
            !depCheck.ok ? depCheck.reason : 'No conflict-free time slot available.'
          }`,
        });
        continue;
      }
    }

    const existingList = currentByStep.get(step.id);
    const reusedId =
      existingList && existingList.length > 0
        ? existingList.shift()!.id
        : `ai-block-${step.id}-${accepted.length + 1}`;

    accepted.push({
      id: reusedId,
      stepId: step.id,
      taskId: cand.taskId,
      date: chosenDate,
      startMinutes: chosenStart,
      durationMinutes: snappedDuration,
      updatedAt: now,
    });
    reasonsByStepId.set(step.id, cand.reason);
  }

  const diffs: ProposalDiffItem[] = [];
  const currentMap = new Map(currentWeekBlocks.map((b) => [b.id, b]));
  const acceptedMap = new Map(accepted.map((b) => [b.id, b]));

  for (const nextBlk of accepted) {
    const prevBlk = currentMap.get(nextBlk.id);
    if (!prevBlk) {
      diffs.push({
        kind: 'added',
        stepId: nextBlk.stepId,
        taskId: nextBlk.taskId,
        reason: reasonsByStepId.get(nextBlk.stepId),
        after: nextBlk,
      });
    } else if (
      prevBlk.date !== nextBlk.date ||
      prevBlk.startMinutes !== nextBlk.startMinutes ||
      prevBlk.durationMinutes !== nextBlk.durationMinutes
    ) {
      diffs.push({
        kind: 'modified',
        stepId: nextBlk.stepId,
        taskId: nextBlk.taskId,
        reason: reasonsByStepId.get(nextBlk.stepId),
        before: prevBlk,
        after: nextBlk,
      });
    } else {
      diffs.push({
        kind: 'unchanged',
        stepId: nextBlk.stepId,
        taskId: nextBlk.taskId,
        before: prevBlk,
        after: nextBlk,
      });
    }
  }

  for (const prevBlk of currentWeekBlocks) {
    if (!acceptedMap.has(prevBlk.id)) {
      diffs.push({
        kind: 'removed',
        stepId: prevBlk.stepId,
        taskId: prevBlk.taskId,
        before: prevBlk,
      });
    }
  }

  return {
    weekStart,
    summary,
    conflicts,
    proposedWeekBlocks: accepted,
    diffs,
  };
}
