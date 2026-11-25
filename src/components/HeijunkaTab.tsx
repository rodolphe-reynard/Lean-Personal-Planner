import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Flag,
  Scale,
  Scissors,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { WBSStep } from '../types';
import { getTaskSwatch } from '../utils/colors';
import {
  addDays,
  formatDayHeader,
  formatDuration,
  formatWeekRange,
  getISOWeekNumber,
  getStartOfWeek,
  getTaskDeadlines,
  getWeekDays,
} from '../utils/dateUtils';
import { getFixedActivitiesForDate } from '../utils/schedulingUtils';
import { StepSplitModal } from './StepSplitModal';

export const HeijunkaTab: React.FC = () => {
  const {
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    workCapacity,
    todayStr,
    displayedWeekStart,
  } = useAppState();

  const [heijunkaWeekStart, setHeijunkaWeekStart] = useState<string>(displayedWeekStart);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [splitTarget, setSplitTarget] = useState<{ step: WBSStep; taskName: string } | null>(null);
  const [stepPickerForTaskId, setStepPickerForTaskId] = useState<string | null>(null);

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const weekDays = useMemo(() => getWeekDays(heijunkaWeekStart), [heijunkaWeekStart]);

  // Historical Average Daily Working Hours across previous weeks with recorded workload
  const historicalDailyAvgHours = useMemo(() => {
    const dailyTotalsByWeek = new Map<string, number[]>();

    // Index scheduled blocks outside current displayed week (strictly earlier weeks)
    const minutesByDate = new Map<string, number>();
    for (const blk of scheduledBlocks) {
      const ws = getStartOfWeek(blk.date);
      if (ws >= heijunkaWeekStart) continue;
      minutesByDate.set(blk.date, (minutesByDate.get(blk.date) ?? 0) + blk.durationMinutes);
    }

    for (const fa of fixedActivities) {
      if (!fa.countsAsWorkingTime) continue;
      const ws = getStartOfWeek(fa.date);
      if (ws >= heijunkaWeekStart) continue;
      const dur = Math.max(0, fa.endMinutes - fa.startMinutes);
      minutesByDate.set(fa.date, (minutesByDate.get(fa.date) ?? 0) + dur);
    }

    for (const [dateStr, mins] of minutesByDate.entries()) {
      const ws = getStartOfWeek(dateStr);
      const arr = dailyTotalsByWeek.get(ws) ?? [0, 0, 0, 0, 0, 0, 0];
      const idx = getWeekDays(ws).indexOf(dateStr);
      if (idx >= 0) arr[idx] = mins;
      dailyTotalsByWeek.set(ws, arr);
    }

    if (dailyTotalsByWeek.size === 0) return null;
    let totalMinutesAllPriorWeeks = 0;
    let totalDays = 0;
    for (const arr of dailyTotalsByWeek.values()) {
      const weekSum = arr.reduce((a, b) => a + b, 0);
      if (weekSum > 0) {
        totalMinutesAllPriorWeeks += weekSum;
        totalDays += 7;
      }
    }
    if (totalDays === 0) return null;
    return Number((totalMinutesAllPriorWeeks / 60 / totalDays).toFixed(2));
  }, [scheduledBlocks, fixedActivities, heijunkaWeekStart]);

  // Deadlines falling inside each day of the displayed week
  const deadlinesByDay = useMemo(() => {
    const map = new Map<string, { taskId: string; taskName: string; colorId: string; label?: string }[]>();
    const weekSet = new Set(weekDays);
    for (const task of tasks) {
      for (const dl of getTaskDeadlines(task)) {
        if (weekSet.has(dl.date)) {
          const arr = map.get(dl.date) ?? [];
          arr.push({
            taskId: task.id,
            taskName: task.name,
            colorId: task.colorId,
            label: dl.label,
          });
          map.set(dl.date, arr);
        }
      }
    }
    return map;
  }, [tasks, weekDays]);

  const heijunkaData = useMemo(() => {
    const taskMinutesInWeek = new Map<string, number>();
    let totalFixedWorkingInWeek = 0;

    const days = weekDays.map((dateStr) => {
      const hdr = formatDayHeader(dateStr);
      const byTask = new Map<string, number>();

      for (const blk of scheduledBlocks) {
        if (blk.date !== dateStr) continue;
        byTask.set(blk.taskId, (byTask.get(blk.taskId) ?? 0) + blk.durationMinutes);
        taskMinutesInWeek.set(
          blk.taskId,
          (taskMinutesInWeek.get(blk.taskId) ?? 0) + blk.durationMinutes
        );
      }

      const dayFixed = getFixedActivitiesForDate(fixedActivities, dateStr);
      let fixedWorkingMinutes = 0;
      for (const fa of dayFixed) {
        if (fa.countsAsWorkingTime) {
          fixedWorkingMinutes += Math.max(0, fa.endMinutes - fa.startMinutes);
        }
      }
      totalFixedWorkingInWeek += fixedWorkingMinutes;

      const taskSegments = Array.from(byTask.entries())
        .map(([taskId, minutes]) => ({ taskId, minutes }))
        .sort((a, b) => b.minutes - a.minutes);

      const totalMinutes =
        fixedWorkingMinutes + taskSegments.reduce((acc, seg) => acc + seg.minutes, 0);

      return {
        dateStr,
        shortName: hdr.shortName,
        dayNum: hdr.dayNum,
        monthShort: hdr.monthShort,
        taskSegments,
        fixedWorkingMinutes,
        totalMinutes,
        totalHours: totalMinutes / 60,
        deadlines: deadlinesByDay.get(dateStr) ?? [],
      };
    });

    const totalWeeklyMinutes = days.reduce((acc, d) => acc + d.totalMinutes, 0);
    const optimalDailyHours = Number((totalWeeklyMinutes / 60 / 7).toFixed(2));

    const maxMinutes = Math.max(
      workCapacity.dailyTargetHours * 60,
      optimalDailyHours * 60,
      (historicalDailyAvgHours ?? 0) * 60,
      ...days.map((d) => d.totalMinutes),
      60
    );
    const maxScaleHours = Math.ceil(maxMinutes / 60);

    const activeDayHours = days.filter((d) => d.totalMinutes > 0).map((d) => d.totalHours);
    const peakDay = [...days].sort((a, b) => b.totalMinutes - a.totalMinutes)[0];
    const overloadedDays = days.filter((d) => d.totalHours > workCapacity.dailyTargetHours);
    const avgActiveHours =
      activeDayHours.length > 0
        ? activeDayHours.reduce((a, b) => a + b, 0) / activeDayHours.length
        : 0;
    const imbalanceRatio =
      avgActiveHours > 0 && peakDay ? Number((peakDay.totalHours / avgActiveHours).toFixed(2)) : 1;

    const weekTaskLegend = Array.from(taskMinutesInWeek.entries())
      .map(([taskId, minutes]) => ({
        taskId,
        task: taskMap.get(taskId),
        minutes,
      }))
      .filter((item) => Boolean(item.task))
      .sort((a, b) => b.minutes - a.minutes);

    return {
      days,
      totalWeeklyMinutes,
      optimalDailyHours,
      maxScaleHours,
      peakDay,
      overloadedDays,
      imbalanceRatio,
      weekTaskLegend,
      totalFixedWorkingInWeek,
    };
  }, [
    weekDays,
    scheduledBlocks,
    fixedActivities,
    workCapacity.dailyTargetHours,
    historicalDailyAvgHours,
    taskMap,
    deadlinesByDay,
  ]);

  const handleOpenSplitForTask = (taskId: string, preferredDate?: string) => {
    const task = taskMap.get(taskId);
    if (!task) return;

    const weekSet = new Set(weekDays);
    const scheduledStepIds = new Set(
      scheduledBlocks
        .filter(
          (b) =>
            b.taskId === taskId &&
            (preferredDate ? b.date === preferredDate : weekSet.has(b.date))
        )
        .map((b) => b.stepId)
    );

    const candidateSteps = steps
      .filter((s) => s.taskId === taskId && !s.completed)
      .sort((a, b) => {
        const aSched = scheduledStepIds.has(a.id) ? 0 : 1;
        const bSched = scheduledStepIds.has(b.id) ? 0 : 1;
        if (aSched !== bSched) return aSched - bSched;
        return b.estimatedMinutes - a.estimatedMinutes;
      });

    if (candidateSteps.length === 1) {
      setSplitTarget({ step: candidateSteps[0], taskName: task.name });
      setStepPickerForTaskId(null);
    } else if (candidateSteps.length > 1) {
      setStepPickerForTaskId((prev) => (prev === taskId ? null : taskId));
    }
  };

  const pickerSteps = useMemo(() => {
    if (!stepPickerForTaskId) return [];
    return steps
      .filter((s) => s.taskId === stepPickerForTaskId && !s.completed)
      .sort((a, b) => a.order - b.order);
  }, [stepPickerForTaskId, steps]);

  const CHART_HEIGHT_PX = 216;

  return (
    <div className="flex flex-col space-y-6 pb-8">
      {/* Header & Week Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-zinc-800" />
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              Heijunka — Workload Leveling & Bottlenecks
            </h1>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
            Level daily demand across the Sat–Fri week against optimal 7-day distribution, historical baseline, and milestone deadlines
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono tabular-nums text-zinc-600">
            Week {getISOWeekNumber(addDays(heijunkaWeekStart, 4))} · {formatWeekRange(heijunkaWeekStart)}
          </span>
          <div className="inline-flex items-center border border-zinc-300 rounded-md bg-white overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setHeijunkaWeekStart((prev) => addDays(prev, -7))}
              aria-label="Previous Heijunka week"
              className="px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100 border-r border-zinc-200"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setHeijunkaWeekStart(getStartOfWeek(todayStr))}
              className="px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 whitespace-nowrap"
            >
              Current
            </button>
            <button
              type="button"
              onClick={() => setHeijunkaWeekStart((prev) => addDays(prev, 7))}
              aria-label="Next Heijunka week"
              className="px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100 border-l border-zinc-200"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Bottleneck & Leveling Card */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-zinc-100">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">
              Weekly Bottleneck Histogram — Daily Working Hours by Task
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Includes scheduled WBS steps and working fixed commitments (classes/meetings); excludes lunch &amp; breaks. Hover a task segment to split steps.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <span className="w-3 border-t-2 border-dashed border-emerald-600 inline-block" />
              <span>
                Optimal:{' '}
                <span className="font-mono font-semibold text-emerald-800">
                  {heijunkaData.optimalDailyHours.toFixed(1)}h/d
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 border-t-2 border-dotted border-sky-600 inline-block" />
              <span>
                Historical Avg:{' '}
                <span className="font-mono font-semibold text-sky-800">
                  {historicalDailyAvgHours !== null ? `${historicalDailyAvgHours.toFixed(1)}h/d` : '—'}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 border-t-2 border-dashed border-red-400 inline-block" />
              <span>
                Peak Cap:{' '}
                <span className="font-mono font-semibold text-zinc-900">
                  {workCapacity.dailyTargetHours}h
                </span>
              </span>
            </div>
            <div>
              Spread:{' '}
              <span
                className={`font-mono font-semibold ${
                  heijunkaData.imbalanceRatio >= 1.5 ? 'text-amber-700' : 'text-zinc-900'
                }`}
              >
                {heijunkaData.imbalanceRatio}×
              </span>
            </div>
          </div>
        </div>

        {heijunkaData.overloadedDays.length > 0 && (
          <div className="mt-4 px-3.5 py-2 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-md flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Workload peak detected on{' '}
              {heijunkaData.overloadedDays
                .map((d) => `${d.shortName} ${d.dayNum} (${d.totalHours.toFixed(1)}h)`)
                .join(', ')}{' '}
              — exceeds your {workCapacity.dailyTargetHours}h daily target. Split oversized steps below to level demand toward{' '}
              {heijunkaData.optimalDailyHours.toFixed(1)}h/day.
            </span>
          </div>
        )}

        {/* Stacked Daily Histogram with Optimal, Historical Average & Peak Threshold Lines */}
        <div className="mt-6 relative">
          <div
            className="relative flex items-end gap-4 px-4 pt-8 pb-1 border-b border-zinc-200"
            style={{ height: `${CHART_HEIGHT_PX + 48}px` }}
          >
            {/* 1. Daily Target Peak Cap Line */}
            {workCapacity.dailyTargetHours <= heijunkaData.maxScaleHours && (
              <div
                aria-hidden="true"
                style={{
                  bottom: `${(workCapacity.dailyTargetHours / heijunkaData.maxScaleHours) * CHART_HEIGHT_PX}px`,
                }}
                className="absolute left-0 right-0 border-t-2 border-dashed border-red-400/80 pointer-events-none z-10"
              >
                <span className="text-[10px] font-mono font-semibold text-red-700 bg-white/95 px-1 -mt-4 inline-block">
                  Cap {workCapacity.dailyTargetHours}h
                </span>
              </div>
            )}

            {/* 2. Optimal Distribution Line = Week Total / 7 */}
            {heijunkaData.totalWeeklyMinutes > 0 &&
              heijunkaData.optimalDailyHours <= heijunkaData.maxScaleHours && (
                <div
                  aria-hidden="true"
                  style={{
                    bottom: `${(heijunkaData.optimalDailyHours / heijunkaData.maxScaleHours) * CHART_HEIGHT_PX}px`,
                  }}
                  className="absolute left-0 right-0 border-t-2 border-dashed border-emerald-600/85 pointer-events-none z-10 flex justify-end"
                >
                  <span className="text-[10px] font-mono font-semibold text-emerald-800 bg-white/95 px-1 -mt-4 inline-block">
                    Optimal {heijunkaData.optimalDailyHours.toFixed(1)}h
                  </span>
                </div>
              )}

            {/* 3. Historical Average Daily Workload Line */}
            {historicalDailyAvgHours !== null &&
              historicalDailyAvgHours > 0 &&
              historicalDailyAvgHours <= heijunkaData.maxScaleHours && (
                <div
                  aria-hidden="true"
                  style={{
                    bottom: `${(historicalDailyAvgHours / heijunkaData.maxScaleHours) * CHART_HEIGHT_PX}px`,
                  }}
                  className="absolute left-0 right-0 border-t-2 border-dotted border-sky-600/85 pointer-events-none z-10 flex justify-center"
                >
                  <span className="text-[10px] font-mono font-semibold text-sky-800 bg-white/95 px-1 -mt-4 inline-block">
                    Hist Avg {historicalDailyAvgHours.toFixed(1)}h
                  </span>
                </div>
              )}

            {heijunkaData.days.map((day) => {
              const isOverloaded = day.totalHours > workCapacity.dailyTargetHours;
              const isPeak =
                heijunkaData.peakDay &&
                heijunkaData.peakDay.dateStr === day.dateStr &&
                day.totalMinutes > 0;
              const totalHeightPx = Math.round(
                (day.totalHours / heijunkaData.maxScaleHours) * CHART_HEIGHT_PX
              );
              const isToday = day.dateStr === todayStr;

              return (
                <div
                  key={day.dateStr}
                  className="flex-1 flex flex-col items-center justify-end h-full min-w-[56px] relative"
                >
                  {/* Milestone Deadlines falling on this day */}
                  {day.deadlines.length > 0 && (
                    <div className="mb-1 flex flex-wrap items-center justify-center gap-1 z-20">
                      {day.deadlines.slice(0, 2).map((dl, i) => {
                        const swatch = getTaskSwatch(dl.colorId);
                        return (
                          <span
                            key={`${dl.taskId}-${i}`}
                            title={`Deadline: ${dl.taskName}${dl.label ? ` — ${dl.label}` : ''}`}
                            className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1 py-0.5 rounded border bg-white truncate max-w-[82px]"
                            style={{ borderColor: swatch.swatch, color: swatch.text }}
                          >
                            <Flag className="w-2.5 h-2.5 shrink-0" style={{ color: swatch.swatch }} />
                            <span className="truncate">{dl.label || dl.taskName}</span>
                          </span>
                        );
                      })}
                      {day.deadlines.length > 2 && (
                        <span className="text-[9px] font-mono text-zinc-500">
                          +{day.deadlines.length - 2}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mb-1.5 text-center tabular-nums">
                    <span
                      className={`text-[11px] font-mono font-semibold ${
                        isOverloaded
                          ? 'text-red-700'
                          : isPeak
                          ? 'text-zinc-900'
                          : 'text-zinc-600'
                      }`}
                    >
                      {day.totalMinutes > 0 ? `${day.totalHours.toFixed(1)}h` : '0h'}
                    </span>
                  </div>

                  {/* Stacked Column */}
                  <div
                    style={{ height: `${Math.max(day.totalMinutes > 0 ? 6 : 2, totalHeightPx)}px` }}
                    className={`w-full max-w-[72px] rounded-t overflow-hidden flex flex-col-reverse border transition-all relative z-[5] ${
                      isOverloaded
                        ? 'border-red-500 ring-2 ring-red-500/20'
                        : isToday
                        ? 'border-zinc-900'
                        : isPeak
                        ? 'border-zinc-700'
                        : 'border-zinc-300'
                    } ${day.totalMinutes === 0 ? 'bg-zinc-100 border-dashed' : 'bg-white'}`}
                  >
                    {day.fixedWorkingMinutes > 0 && (
                      <div
                        style={{
                          height: `${(day.fixedWorkingMinutes / day.totalMinutes) * 100}%`,
                          backgroundImage:
                            'repeating-linear-gradient(-45deg, #e4e4e7, #e4e4e7 4px, #f4f4f5 4px, #f4f4f5 8px)',
                        }}
                        title={`Fixed Working Commitments: ${formatDuration(day.fixedWorkingMinutes)}`}
                        className="w-full border-t border-zinc-300/80"
                      />
                    )}

                    {day.taskSegments.map((seg) => {
                      const task = taskMap.get(seg.taskId);
                      if (!task) return null;
                      const swatch = getTaskSwatch(task.colorId);
                      const isHovered = hoveredTaskId === task.id;
                      const hasIncompleteStep = steps.some(
                        (s) => s.taskId === task.id && !s.completed
                      );

                      return (
                        <div
                          key={seg.taskId}
                          onMouseEnter={() => setHoveredTaskId(task.id)}
                          onMouseLeave={() => setHoveredTaskId(null)}
                          style={{
                            height: `${(seg.minutes / day.totalMinutes) * 100}%`,
                            backgroundColor: swatch.bg,
                            borderTopColor: swatch.border,
                            color: swatch.text,
                          }}
                          title={`${task.name}: ${formatDuration(seg.minutes)}`}
                          className={`relative w-full border-t flex items-center justify-center overflow-hidden transition-all ${
                            isHovered ? 'brightness-95 ring-1 ring-inset ring-zinc-900' : ''
                          }`}
                        >
                          {isHovered && hasIncompleteStep && (
                            <button
                              type="button"
                              onClick={() => handleOpenSplitForTask(task.id, day.dateStr)}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-white/95 text-zinc-900 border border-zinc-300 rounded shadow-xs hover:bg-zinc-900 hover:text-white transition-colors"
                              title={`Split a step in "${task.name}" into two smaller steps`}
                            >
                              <Scissors className="w-2.5 h-2.5" />
                              Split
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* X-Axis Day Labels */}
          <div className="flex gap-4 px-4 mt-2">
            {heijunkaData.days.map((day) => {
              const isOverloaded = day.totalHours > workCapacity.dailyTargetHours;
              const isToday = day.dateStr === todayStr;
              return (
                <div key={day.dateStr} className="flex-1 text-center min-w-[56px]">
                  <div
                    className={`text-xs font-semibold ${
                      isOverloaded
                        ? 'text-red-700'
                        : isToday
                        ? 'text-zinc-950 underline underline-offset-4'
                        : 'text-zinc-800'
                    }`}
                  >
                    {day.shortName}
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-zinc-500">
                    {day.dayNum} {day.monthShort}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Task Breakdown Legend with Hover-Reveal Split Control */}
        <div className="mt-5 pt-4 border-t border-zinc-200">
          <div className="text-xs font-semibold text-zinc-700 mb-2.5">
            Weekly Working Time Decomposition (Hover a task to split a bottleneck step)
          </div>
          <div className="flex flex-wrap gap-2.5">
            {heijunkaData.totalFixedWorkingInWeek > 0 && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-300 rounded-md bg-zinc-50 text-xs tabular-nums">
                <span
                  className="w-3 h-3 rounded-sm border border-zinc-400"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(-45deg, #e4e4e7, #e4e4e7 3px, #f4f4f5 3px, #f4f4f5 6px)',
                  }}
                />
                <span className="font-medium text-zinc-800">Classes &amp; Fixed Work</span>
                <span className="font-mono text-zinc-500">
                  {formatDuration(heijunkaData.totalFixedWorkingInWeek)}
                </span>
              </div>
            )}

            {heijunkaData.weekTaskLegend.length === 0 &&
            heijunkaData.totalFixedWorkingInWeek === 0 ? (
              <span className="text-xs text-zinc-500">
                No working hours scheduled for this week yet.
              </span>
            ) : (
              heijunkaData.weekTaskLegend.map(({ taskId, task, minutes }) => {
                if (!task) return null;
                const swatch = getTaskSwatch(task.colorId);
                const incompleteSteps = steps.filter((s) => s.taskId === taskId && !s.completed);
                const isHovered = hoveredTaskId === taskId;

                return (
                  <div
                    key={taskId}
                    onMouseEnter={() => setHoveredTaskId(taskId)}
                    onMouseLeave={() => setHoveredTaskId(null)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 border rounded-md text-xs tabular-nums transition-colors ${
                      isHovered ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 bg-white'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-sm border shrink-0"
                      style={{ backgroundColor: swatch.bg, borderColor: swatch.swatch }}
                    />
                    <span className="font-medium text-zinc-900">{task.name}</span>
                    <span className="font-mono text-zinc-500">{formatDuration(minutes)}</span>

                    {incompleteSteps.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleOpenSplitForTask(taskId)}
                        className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border transition-opacity ${
                          isHovered || stepPickerForTaskId === taskId
                            ? 'opacity-100 bg-zinc-900 text-white border-zinc-900'
                            : 'opacity-75 bg-zinc-100 text-zinc-700 border-zinc-200 hover:opacity-100'
                        }`}
                      >
                        <Scissors className="w-3 h-3" />
                        Split Step
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {stepPickerForTaskId && pickerSteps.length > 0 && (
            <div className="mt-3 p-3.5 bg-zinc-50 border border-zinc-300 rounded-md">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-900">
                  Select a step from &ldquo;{taskMap.get(stepPickerForTaskId)?.name}&rdquo; to split into two:
                </span>
                <button
                  type="button"
                  onClick={() => setStepPickerForTaskId(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-900"
                >
                  Cancel
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {pickerSteps.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      setSplitTarget({
                        step: st,
                        taskName: taskMap.get(stepPickerForTaskId)?.name ?? '',
                      });
                      setStepPickerForTaskId(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded hover:border-zinc-900"
                  >
                    <Scissors className="w-3 h-3 text-zinc-500" />
                    <span className="font-medium text-zinc-800">{st.title}</span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      ({formatDuration(st.estimatedMinutes)})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <StepSplitModal
        step={splitTarget?.step ?? null}
        taskName={splitTarget?.taskName}
        onClose={() => setSplitTarget(null)}
      />
    </div>
  );
};
