import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Lock,
  TrendingUp,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { DailyCFDSnapshot, PPCItemSummary, ValueCategory } from '../types';
import { getTaskSwatch } from '../utils/colors';
import {
  addDays,
  formatCompactDate,
  formatDuration,
  formatShortDate,
  formatWeekRange,
  getISOWeekNumber,
  getStartOfWeek,
} from '../utils/dateUtils';
import { getFixedActivitiesForDate } from '../utils/schedulingUtils';

type PeriodFilterMode = 'week' | 'month' | 'custom';

export const StatisticsTab: React.FC = () => {
  const {
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    ppcRecords,
    cfdSnapshots,
    todayStr,
    displayedWeekStart,
    updateStep,
    updateTask,
  } = useAppState();

  const [statsWeekStart, setStatsWeekStart] = useState<string>(displayedWeekStart);

  // PPC hovered/pinned week state (Read-Only Inspector)
  const [activePpcWeek, setActivePpcWeek] = useState<string | null>(null);
  const [pinnedPpcWeek, setPinnedPpcWeek] = useState<string | null>(null);
  const closePpcTimerRef = useRef<number | null>(null);

  // NVA Filter state
  const [nvaFilterMode, setNvaFilterMode] = useState<PeriodFilterMode>('week');
  const [nvaMonth, setNvaMonth] = useState<string>(() => todayStr.slice(0, 7));
  const [nvaCustomFrom, setNvaCustomFrom] = useState<string>(displayedWeekStart);
  const [nvaCustomTo, setNvaCustomTo] = useState<string>(() => addDays(displayedWeekStart, 6));
  const [showClassificationEditor, setShowClassificationEditor] = useState(false);

  // CFD Filter & Hover state
  const [cfdFilterMode, setCfdFilterMode] = useState<PeriodFilterMode>('week');
  const [cfdMonth, setCfdMonth] = useState<string>(() => todayStr.slice(0, 7));
  const [cfdCustomFrom, setCfdCustomFrom] = useState<string>(() => addDays(todayStr, -13));
  const [cfdCustomTo, setCfdCustomTo] = useState<string>(todayStr);
  const [hoveredCfdIdx, setHoveredCfdIdx] = useState<number | null>(null);

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const stepMap = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const ppcRecordMap = useMemo(
    () => new Map(ppcRecords.map((r) => [r.weekStart, r])),
    [ppcRecords]
  );

  // ==================== A. PLAN RELIABILITY TREND (PPC %) ====================
  const ppcTimeline = useMemo(() => {
    const weeks = Array.from({ length: 8 }, (_, idx) =>
      addDays(statsWeekStart, (idx - 7) * 7)
    );

    return weeks.map((ws) => {
      const weekEnd = addDays(ws, 6);
      const isoWeek = getISOWeekNumber(addDays(ws, 4));
      const record = ppcRecordMap.get(ws);

      // Locked historical snapshot is immutable so past values never change retrospectively
      if (record?.snapshot?.locked) {
        return {
          weekStart: ws,
          isoWeek,
          rangeLabel: formatWeekRange(ws),
          plannedCount: record.snapshot.plannedCount,
          completedCount: record.snapshot.completedCount,
          ppcPercent: record.snapshot.plannedCount > 0 ? record.snapshot.ppcPercent : null,
          completedItems: record.snapshot.completedItems ?? [],
          incompleteItems: record.snapshot.incompleteItems ?? [],
          reasonsForVariance: record.reasonsForVariance ?? '',
          stepVariances: record.stepVariances ?? [],
          locked: true,
        };
      }

      const weekBlocks = scheduledBlocks.filter((b) => b.date >= ws && b.date <= weekEnd);
      const uniqueStepIds = new Set(weekBlocks.map((b) => b.stepId));

      if (uniqueStepIds.size > 0) {
        const completedItems: PPCItemSummary[] = [];
        const incompleteItems: PPCItemSummary[] = [];

        for (const sid of uniqueStepIds) {
          const st = stepMap.get(sid);
          if (!st) continue;
          const tk = taskMap.get(st.taskId);
          const item: PPCItemSummary = {
            stepId: st.id,
            taskId: st.taskId,
            stepTitle: st.title,
            taskName: tk?.name ?? 'Objective',
            executionState: st.executionState,
            varianceReason: st.varianceReason || undefined,
          };
          if (st.completed) completedItems.push(item);
          else incompleteItems.push(item);
        }

        const plannedCount = completedItems.length + incompleteItems.length;
        const completedCount = completedItems.length;
        const ppcPercent = plannedCount > 0 ? Math.round((completedCount / plannedCount) * 100) : null;

        return {
          weekStart: ws,
          isoWeek,
          rangeLabel: formatWeekRange(ws),
          plannedCount,
          completedCount,
          ppcPercent,
          completedItems,
          incompleteItems,
          reasonsForVariance: record?.reasonsForVariance ?? '',
          stepVariances: record?.stepVariances ?? [],
          locked: false,
        };
      }

      if (record?.snapshot && record.snapshot.plannedCount > 0) {
        return {
          weekStart: ws,
          isoWeek,
          rangeLabel: formatWeekRange(ws),
          plannedCount: record.snapshot.plannedCount,
          completedCount: record.snapshot.completedCount,
          ppcPercent: record.snapshot.ppcPercent,
          completedItems: record.snapshot.completedItems ?? [],
          incompleteItems: record.snapshot.incompleteItems ?? [],
          reasonsForVariance: record.reasonsForVariance ?? '',
          stepVariances: record.stepVariances ?? [],
          locked: Boolean(record.snapshot.locked),
        };
      }

      return {
        weekStart: ws,
        isoWeek,
        rangeLabel: formatWeekRange(ws),
        plannedCount: 0,
        completedCount: 0,
        ppcPercent: null as number | null,
        completedItems: [] as PPCItemSummary[],
        incompleteItems: [] as PPCItemSummary[],
        reasonsForVariance: record?.reasonsForVariance ?? '',
        stepVariances: record?.stepVariances ?? [],
        locked: false,
      };
    });
  }, [statsWeekStart, ppcRecordMap, scheduledBlocks, stepMap, taskMap]);

  // Historical Average PPC across all recorded historical weeks
  const historicalAvgPpc = useMemo(() => {
    const allWithData = new Map<string, number>();
    for (const r of ppcRecords) {
      if (r.snapshot && r.snapshot.plannedCount > 0) {
        allWithData.set(r.weekStart, r.snapshot.ppcPercent);
      }
    }
    for (const w of ppcTimeline) {
      if (w.ppcPercent !== null) {
        allWithData.set(w.weekStart, w.ppcPercent);
      }
    }
    if (allWithData.size === 0) return null;
    const vals = Array.from(allWithData.values());
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [ppcRecords, ppcTimeline]);

  const currentShownPpcWeek = pinnedPpcWeek ?? activePpcWeek ?? statsWeekStart;
  const activePpcEntry =
    ppcTimeline.find((w) => w.weekStart === currentShownPpcWeek) ?? ppcTimeline[ppcTimeline.length - 1];

  // ==================== B. NVA DISTRIBUTION ====================
  const resolveDateBounds = (
    mode: PeriodFilterMode,
    monthStr: string,
    fromStr: string,
    toStr: string
  ) => {
    if (mode === 'week') {
      return { from: statsWeekStart, to: addDays(statsWeekStart, 6) };
    }
    if (mode === 'month') {
      const [yStr, mStr] = monthStr.split('-');
      const y = Number(yStr);
      const m = Number(mStr);
      if (!Number.isNaN(y) && !Number.isNaN(m) && m >= 1 && m <= 12) {
        const lastDay = new Date(y, m, 0).getDate();
        return {
          from: `${yStr}-${mStr}-01`,
          to: `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
        };
      }
    }
    const from = fromStr <= toStr ? fromStr : toStr;
    const to = fromStr <= toStr ? toStr : fromStr;
    return { from, to };
  };

  const nvaDateBounds = useMemo(
    () => resolveDateBounds(nvaFilterMode, nvaMonth, nvaCustomFrom, nvaCustomTo),
    [nvaFilterMode, statsWeekStart, nvaMonth, nvaCustomFrom, nvaCustomTo]
  );

  const nvaSummary = useMemo(() => {
    const totals: Record<ValueCategory, number> = { VA: 0, NNVA: 0, NVA: 0 };

    for (const blk of scheduledBlocks) {
      if (blk.date < nvaDateBounds.from || blk.date > nvaDateBounds.to) continue;
      const step = stepMap.get(blk.stepId);
      const task = taskMap.get(blk.taskId);
      const cat: ValueCategory = step?.valueCategory ?? task?.valueCategory ?? 'VA';
      totals[cat] += blk.durationMinutes;
    }

    let cursor = nvaDateBounds.from;
    let guard = 0;
    while (cursor <= nvaDateBounds.to && guard < 95) {
      const dayFixed = getFixedActivitiesForDate(fixedActivities, cursor);
      for (const fa of dayFixed) {
        if (!fa.countsAsWorkingTime) continue;
        totals[fa.valueCategory] += Math.max(0, fa.endMinutes - fa.startMinutes);
      }
      cursor = addDays(cursor, 1);
      guard += 1;
    }

    const totalMinutes = totals.VA + totals.NNVA + totals.NVA;
    const pct = (m: number) => (totalMinutes > 0 ? Math.round((m / totalMinutes) * 100) : 0);

    return {
      VA: { minutes: totals.VA, pct: pct(totals.VA) },
      NNVA: { minutes: totals.NNVA, pct: pct(totals.NNVA) },
      NVA: { minutes: totals.NVA, pct: pct(totals.NVA) },
      totalMinutes,
    };
  }, [nvaDateBounds, scheduledBlocks, stepMap, taskMap, fixedActivities]);

  // ==================== C. CUMULATIVE FLOW DIAGRAM (CFD) ====================
  const cfdDateBounds = useMemo(
    () => resolveDateBounds(cfdFilterMode, cfdMonth, cfdCustomFrom, cfdCustomTo),
    [cfdFilterMode, statsWeekStart, cfdMonth, cfdCustomFrom, cfdCustomTo]
  );

  const filteredCfdSeries = useMemo(() => {
    const inRange = cfdSnapshots
      .filter((s) => s.date >= cfdDateBounds.from && s.date <= cfdDateBounds.to)
      .sort((a, b) => a.date.localeCompare(b.date));
    return inRange;
  }, [cfdSnapshots, cfdDateBounds]);

  const cfdGeometry = useMemo(() => {
    const width = 760;
    const height = 220;
    const padL = 36;
    const padR = 16;
    const padT = 16;
    const padB = 28;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxTotal = Math.max(
      1,
      ...filteredCfdSeries.map((d) => Math.max(d.total, d.completed + d.inProgress + d.notStarted))
    );
    const yCeil = Math.max(4, Math.ceil(maxTotal / 2) * 2);

    const n = filteredCfdSeries.length;
    const xAt = (i: number) =>
      n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW;
    const yAt = (val: number) => padT + plotH - (val / yCeil) * plotH;

    const buildBandPath = (
      topVals: number[],
      bottomVals: number[]
    ): string => {
      if (n === 0) return '';
      if (n === 1) {
        const x0 = padL;
        const x1 = padL + plotW;
        return `M ${x0} ${yAt(topVals[0])} L ${x1} ${yAt(topVals[0])} L ${x1} ${yAt(
          bottomVals[0]
        )} L ${x0} ${yAt(bottomVals[0])} Z`;
      }
      const upper = topVals
        .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
        .join(' ');
      const lower = [...bottomVals]
        .reverse()
        .map((v, revIdx) => {
          const origIdx = n - 1 - revIdx;
          return `L ${xAt(origIdx).toFixed(1)} ${yAt(v).toFixed(1)}`;
        })
        .join(' ');
      return `${upper} ${lower} Z`;
    };

    const compTop = filteredCfdSeries.map((d) => d.completed);
    const compBot = filteredCfdSeries.map(() => 0);

    const wipTop = filteredCfdSeries.map((d) => d.completed + d.inProgress);
    const wipBot = compTop;

    const notStartedTop = filteredCfdSeries.map(
      (d) => d.completed + d.inProgress + d.notStarted
    );
    const notStartedBot = wipTop;

    const linePath = (vals: number[]) =>
      vals.length <= 1
        ? ''
        : vals
            .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
            .join(' ');

    return {
      width,
      height,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      yCeil,
      xAt,
      yAt,
      completedArea: buildBandPath(compTop, compBot),
      inProgressArea: buildBandPath(wipTop, wipBot),
      notStartedArea: buildBandPath(notStartedTop, notStartedBot),
      completedLine: linePath(compTop),
      wipLine: linePath(wipTop),
      totalLine: linePath(notStartedTop),
    };
  }, [filteredCfdSeries]);

  const activeCfdPoint: DailyCFDSnapshot | null =
    hoveredCfdIdx !== null && filteredCfdSeries[hoveredCfdIdx]
      ? filteredCfdSeries[hoveredCfdIdx]
      : filteredCfdSeries[filteredCfdSeries.length - 1] ?? null;

  const cancelPpcClose = () => {
    if (closePpcTimerRef.current !== null) {
      window.clearTimeout(closePpcTimerRef.current);
      closePpcTimerRef.current = null;
    }
  };

  const schedulePpcClose = () => {
    cancelPpcClose();
    closePpcTimerRef.current = window.setTimeout(() => {
      if (!pinnedPpcWeek) setActivePpcWeek(null);
    }, 150);
  };

  // Polyline coordinates for PPC Trend overlay
  const ppcPointsSvg = useMemo(() => {
    const valid = ppcTimeline
      .map((w, idx) => ({ idx, ppc: w.ppcPercent }))
      .filter((x): x is { idx: number; ppc: number } => x.ppc !== null);
    if (valid.length < 2) return null;
    return valid
      .map((pt) => {
        const x = ((pt.idx + 0.5) / ppcTimeline.length) * 100;
        const y = 100 - pt.ppc;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [ppcTimeline]);

  return (
    <div className="flex flex-col space-y-6 pb-8">
      {/* Page Header & Shared Week Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Lean Flow &amp; Reliability Statistics
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
            Plan Reliability Trend (PPC), Value-Added Ratio (VA / NNVA / NVA), and Cumulative Flow Diagram (CFD)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono tabular-nums text-zinc-600">
            Week {getISOWeekNumber(addDays(statsWeekStart, 4))} · {formatWeekRange(statsWeekStart)}
          </span>
          <div className="inline-flex items-center border border-zinc-300 rounded-md bg-white overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setStatsWeekStart((prev) => addDays(prev, -7))}
              aria-label="Previous statistics week"
              className="px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100 border-r border-zinc-200"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setStatsWeekStart(getStartOfWeek(todayStr))}
              className="px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 whitespace-nowrap"
            >
              Current
            </button>
            <button
              type="button"
              onClick={() => setStatsWeekStart((prev) => addDays(prev, 7))}
              aria-label="Next statistics week"
              className="px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100 border-l border-zinc-200"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Top Row: Graph A (Plan Reliability Trend) + Graph B (NVA Distribution) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* GRAPH A: Plan Reliability Trend (PPC) */}
        <section className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-100">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-zinc-700" />
                <h2 className="text-sm font-semibold text-zinc-900">
                  A. Plan Reliability Trend (PPC)
                </h2>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                Immutable historical weekly PPC (%) with average baseline. Hover or click a week to inspect details &amp; variance.
              </p>
            </div>
            <div className="text-right tabular-nums shrink-0">
              <div className="text-lg font-mono font-semibold text-zinc-900">
                {historicalAvgPpc !== null ? `${historicalAvgPpc}%` : '—'}
              </div>
              <div className="text-[10px] text-zinc-500">Historical avg</div>
            </div>
          </div>

          {/* Chart */}
          <div className="mt-5">
            <div className="relative h-48 flex items-end gap-2 pt-6 pb-1 px-2 border-b border-zinc-200">
              {/* Static 100% / 50% grid lines */}
              {[100, 50].map((pct) => (
                <div
                  key={pct}
                  aria-hidden="true"
                  style={{ bottom: `${(pct / 100) * 140}px` }}
                  className="absolute left-0 right-0 border-t border-dashed border-zinc-200 pointer-events-none"
                >
                  <span className="text-[9px] font-mono text-zinc-400 bg-white pr-1 -mt-2 inline-block">
                    {pct}%
                  </span>
                </div>
              ))}

              {/* Historical Average Reference Line */}
              {historicalAvgPpc !== null && (
                <div
                  aria-hidden="true"
                  style={{ bottom: `${(historicalAvgPpc / 100) * 140}px` }}
                  className="absolute left-0 right-0 border-t-2 border-dashed border-sky-600/80 pointer-events-none z-20 flex justify-end"
                >
                  <span className="text-[10px] font-mono font-semibold text-sky-800 bg-white/95 px-1 -mt-4 inline-block">
                    Hist Avg {historicalAvgPpc}%
                  </span>
                </div>
              )}

              {/* Subtle SVG Trend Polyline behind bars */}
              {ppcPointsSvg && (
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute left-2 right-2 bottom-1 h-[140px] w-[calc(100%-1rem)] pointer-events-none z-[5]"
                >
                  <polyline
                    fill="none"
                    stroke="#52525b"
                    strokeWidth="1.4"
                    vectorEffect="non-scaling-stroke"
                    points={ppcPointsSvg}
                  />
                </svg>
              )}

              {ppcTimeline.map((week) => {
                const isSelected = currentShownPpcWeek === week.weekStart;
                const hasData = week.ppcPercent !== null;
                const barHeightPx = hasData
                  ? Math.max(8, Math.round(((week.ppcPercent ?? 0) / 100) * 140))
                  : 4;
                const hasVarianceNote =
                  Boolean(week.reasonsForVariance.trim()) ||
                  week.stepVariances.some((sv) => sv.reason.trim().length > 0);

                return (
                  <div
                    key={week.weekStart}
                    onMouseEnter={() => {
                      cancelPpcClose();
                      setActivePpcWeek(week.weekStart);
                    }}
                    onMouseLeave={schedulePpcClose}
                    onClick={() =>
                      setPinnedPpcWeek((prev) =>
                        prev === week.weekStart ? null : week.weekStart
                      )
                    }
                    className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer group relative z-10"
                  >
                    <span className="text-[10px] font-mono tabular-nums text-zinc-700 mb-1">
                      {hasData ? `${week.ppcPercent}%` : '·'}
                    </span>

                    <div
                      style={{ height: `${barHeightPx}px` }}
                      className={`w-full max-w-[38px] rounded-t transition-all ${
                        !hasData
                          ? 'bg-zinc-100 border border-dashed border-zinc-300'
                          : isSelected
                          ? 'bg-zinc-900'
                          : 'bg-zinc-400/85 group-hover:bg-zinc-700'
                      }`}
                    />

                    <div className="h-2.5 flex items-center justify-center mt-0.5 gap-0.5">
                      {hasVarianceNote && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-amber-500"
                          title="Variance reason recorded"
                        />
                      )}
                      {week.locked && (
                        <span title="Locked historical snapshot">
                          <Lock className="w-2.5 h-2.5 text-zinc-400" />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* X-Axis Labels */}
            <div className="flex gap-2 px-2 mt-1.5">
              {ppcTimeline.map((week) => {
                const isSelected = currentShownPpcWeek === week.weekStart;
                return (
                  <div
                    key={week.weekStart}
                    className={`flex-1 text-center text-[10px] font-mono tabular-nums ${
                      isSelected ? 'font-semibold text-zinc-900' : 'text-zinc-500'
                    }`}
                  >
                    W{week.isoWeek}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Read-Only Hover / Pinned Week Breakdown */}
          {activePpcEntry && (
            <div
              onMouseEnter={cancelPpcClose}
              onMouseLeave={schedulePpcClose}
              className="mt-4 p-3.5 bg-zinc-50 border border-zinc-200 rounded-md space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-200/80">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-900 tabular-nums">
                    Week {activePpcEntry.isoWeek} · {activePpcEntry.rangeLabel}
                  </span>
                  {activePpcEntry.locked && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 bg-white border border-zinc-200 rounded">
                      <Lock className="w-2.5 h-2.5" />
                      Locked
                    </span>
                  )}
                </div>
                <div className="text-xs font-mono tabular-nums text-zinc-700 font-semibold">
                  {activePpcEntry.ppcPercent !== null
                    ? `${activePpcEntry.completedCount}/${activePpcEntry.plannedCount} completed (${activePpcEntry.ppcPercent}%)`
                    : 'No planned commitments'}
                </div>
              </div>

              {(activePpcEntry.completedItems.length > 0 ||
                activePpcEntry.incompleteItems.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                  <div>
                    <div className="font-semibold text-emerald-800 mb-1">
                      Completed ({activePpcEntry.completedItems.length})
                    </div>
                    {activePpcEntry.completedItems.length === 0 ? (
                      <div className="text-zinc-400">None</div>
                    ) : (
                      <ul className="space-y-1 max-h-28 overflow-y-auto pr-1">
                        {activePpcEntry.completedItems.map((item) => (
                          <li key={item.stepId} className="flex items-start gap-1.5 text-zinc-700">
                            {item.executionState === 'done_variance' ? (
                              <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" />
                            )}
                            <span className="min-w-0 truncate">
                              <span className="font-medium text-zinc-900">{item.stepTitle}</span>{' '}
                              <span className="text-zinc-400">({item.taskName})</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <div className="font-semibold text-zinc-700 mb-1">
                      Incomplete ({activePpcEntry.incompleteItems.length})
                    </div>
                    {activePpcEntry.incompleteItems.length === 0 ? (
                      <div className="text-zinc-400">None</div>
                    ) : (
                      <ul className="space-y-1 max-h-28 overflow-y-auto pr-1">
                        {activePpcEntry.incompleteItems.map((item) => (
                          <li key={item.stepId} className="flex items-start gap-1.5 text-zinc-700">
                            <Circle className="w-3 h-3 text-zinc-400 shrink-0 mt-0.5" />
                            <span className="min-w-0 truncate">
                              <span className="font-medium text-zinc-900">{item.stepTitle}</span>{' '}
                              <span className="text-zinc-400">({item.taskName})</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-zinc-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-zinc-700">
                    Reasons for Variance
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    Edit in Weekly Work Plan → Variance &amp; Review
                  </span>
                </div>

                {activePpcEntry.reasonsForVariance.trim() ? (
                  <p className="text-xs text-zinc-800 bg-white border border-zinc-200 rounded px-2.5 py-1.5 leading-relaxed">
                    {activePpcEntry.reasonsForVariance}
                  </p>
                ) : (
                  <p className="text-[11px] text-zinc-400 italic">
                    No weekly variance note recorded.
                  </p>
                )}

                {activePpcEntry.stepVariances.filter((sv) => sv.reason.trim()).length > 0 && (
                  <ul className="space-y-1 pt-1">
                    {activePpcEntry.stepVariances
                      .filter((sv) => sv.reason.trim())
                      .map((sv) => (
                        <li
                          key={sv.stepId}
                          className="text-[11px] bg-amber-50/70 border border-amber-200 rounded px-2 py-1 text-amber-950"
                        >
                          <span className="font-semibold">{sv.stepTitle}:</span> {sv.reason}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        {/* GRAPH B: NVA Time Distribution */}
        <section className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-zinc-100">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                B. Value-Added vs Non-Value-Added Time
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                {formatShortDate(nvaDateBounds.from)} – {formatShortDate(nvaDateBounds.to)} ·{' '}
                <span className="font-mono text-zinc-700">
                  {formatDuration(nvaSummary.totalMinutes)} total classified
                </span>
              </p>
            </div>

            <div className="inline-flex items-center p-0.5 bg-zinc-100 border border-zinc-200 rounded-md">
              {(
                [
                  { id: 'week', label: 'Week' },
                  { id: 'month', label: 'Month' },
                  { id: 'custom', label: 'Custom' },
                ] as { id: PeriodFilterMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setNvaFilterMode(opt.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                    nvaFilterMode === opt.id
                      ? 'bg-white text-zinc-900 shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {nvaFilterMode === 'month' && (
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="nva-month" className="text-xs text-zinc-600">
                Month:
              </label>
              <input
                id="nva-month"
                type="month"
                value={nvaMonth}
                onChange={(e) => setNvaMonth(e.target.value)}
                className="px-2.5 py-1 text-xs font-mono text-zinc-900 bg-white border border-zinc-300 rounded"
              />
            </div>
          )}

          {nvaFilterMode === 'custom' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="NVA start date"
                value={nvaCustomFrom}
                onChange={(e) => setNvaCustomFrom(e.target.value)}
                className="px-2.5 py-1 text-xs font-mono text-zinc-900 bg-white border border-zinc-300 rounded"
              />
              <span className="text-xs text-zinc-400">to</span>
              <input
                type="date"
                aria-label="NVA end date"
                value={nvaCustomTo}
                onChange={(e) => setNvaCustomTo(e.target.value)}
                className="px-2.5 py-1 text-xs font-mono text-zinc-900 bg-white border border-zinc-300 rounded"
              />
            </div>
          )}

          <div className="mt-5">
            <div className="h-7 w-full rounded-md overflow-hidden border border-zinc-200 bg-zinc-100 flex">
              {nvaSummary.totalMinutes === 0 ? (
                <div className="w-full flex items-center justify-center text-[11px] text-zinc-400">
                  No scheduled working blocks in selected period
                </div>
              ) : (
                <>
                  {nvaSummary.VA.minutes > 0 && (
                    <div
                      style={{ width: `${(nvaSummary.VA.minutes / nvaSummary.totalMinutes) * 100}%` }}
                      className="h-full bg-emerald-600 transition-all"
                      title={`VA: ${formatDuration(nvaSummary.VA.minutes)} (${nvaSummary.VA.pct}%)`}
                    />
                  )}
                  {nvaSummary.NNVA.minutes > 0 && (
                    <div
                      style={{
                        width: `${(nvaSummary.NNVA.minutes / nvaSummary.totalMinutes) * 100}%`,
                      }}
                      className="h-full bg-amber-400 transition-all"
                      title={`NNVA: ${formatDuration(nvaSummary.NNVA.minutes)} (${nvaSummary.NNVA.pct}%)`}
                    />
                  )}
                  {nvaSummary.NVA.minutes > 0 && (
                    <div
                      style={{ width: `${(nvaSummary.NVA.minutes / nvaSummary.totalMinutes) * 100}%` }}
                      className="h-full bg-rose-500 transition-all"
                      title={`NVA: ${formatDuration(nvaSummary.NVA.minutes)} (${nvaSummary.NVA.pct}%)`}
                    />
                  )}
                </>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                {
                  key: 'VA' as ValueCategory,
                  label: 'Value-Added',
                  dotClass: 'bg-emerald-600',
                  stat: nvaSummary.VA,
                },
                {
                  key: 'NNVA' as ValueCategory,
                  label: 'Necessary NVA',
                  dotClass: 'bg-amber-400',
                  stat: nvaSummary.NNVA,
                },
                {
                  key: 'NVA' as ValueCategory,
                  label: 'Non-Value-Added',
                  dotClass: 'bg-rose-500',
                  stat: nvaSummary.NVA,
                },
              ].map((cat) => (
                <div
                  key={cat.key}
                  className="p-3 border border-zinc-200 rounded-md bg-zinc-50/50"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-600">
                    <span className={`w-2 h-2 rounded-sm ${cat.dotClass}`} />
                    {cat.key} · {cat.label}
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between tabular-nums">
                    <span className="text-base font-mono font-semibold text-zinc-900">
                      {formatDuration(cat.stat.minutes)}
                    </span>
                    <span className="text-xs font-mono text-zinc-500">{cat.stat.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-100">
            <button
              type="button"
              onClick={() => setShowClassificationEditor((v) => !v)}
              className="text-xs font-medium text-zinc-700 hover:text-zinc-900 underline underline-offset-4"
            >
              {showClassificationEditor
                ? 'Hide task & step classification editor'
                : 'Classify objectives & steps (VA / NNVA / NVA)'}
            </button>

            {showClassificationEditor && (
              <div className="mt-3 max-h-52 overflow-y-auto border border-zinc-200 rounded-md divide-y divide-zinc-200/80">
                {tasks.length === 0 ? (
                  <div className="p-4 text-xs text-zinc-500 text-center">No tasks to classify.</div>
                ) : (
                  tasks.map((task) => {
                    const swatch = getTaskSwatch(task.colorId);
                    const tSteps = steps
                      .filter((s) => s.taskId === task.id)
                      .sort((a, b) => a.order - b.order);
                    return (
                      <div key={task.id} className="p-2.5 bg-white space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-sm border shrink-0"
                              style={{ backgroundColor: swatch.bg, borderColor: swatch.swatch }}
                            />
                            <span className="text-xs font-semibold text-zinc-900 truncate">
                              {task.name}
                            </span>
                          </div>
                          <select
                            value={task.valueCategory}
                            aria-label={`Lean classification for ${task.name}`}
                            onChange={(e) =>
                              updateTask(task.id, {
                                valueCategory: e.target.value as ValueCategory,
                              })
                            }
                            className="px-1.5 py-0.5 text-[11px] font-mono bg-zinc-50 border border-zinc-200 rounded"
                          >
                            <option value="VA">VA</option>
                            <option value="NNVA">NNVA</option>
                            <option value="NVA">NVA</option>
                          </select>
                        </div>

                        {tSteps.map((s) => (
                          <div
                            key={s.id}
                            className="pl-4 flex items-center justify-between gap-2 text-[11px] text-zinc-600"
                          >
                            <span className="truncate">{s.title}</span>
                            <select
                              value={s.valueCategory}
                              aria-label={`Lean classification for ${s.title}`}
                              onChange={(e) =>
                                updateStep(s.id, {
                                  valueCategory: e.target.value as ValueCategory,
                                })
                              }
                              className="px-1.5 py-0.5 text-[10px] font-mono bg-white border border-zinc-200 rounded shrink-0"
                            >
                              <option value="VA">VA</option>
                              <option value="NNVA">NNVA</option>
                              <option value="NVA">NVA</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* GRAPH C: Cumulative Flow Diagram (CFD) */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-zinc-100">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-700" />
              <h2 className="text-sm font-semibold text-zinc-900">
                C. Cumulative Flow Diagram (CFD)
              </h2>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
              {formatShortDate(cfdDateBounds.from)} – {formatShortDate(cfdDateBounds.to)} · Tracks Not Started, In Progress (WIP), and Completed steps with immutable past daily snapshots.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Band Legend */}
            <div className="flex items-center gap-3 text-[11px] text-zinc-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                Completed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
                In Progress (WIP)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-zinc-300" />
                Not Started
              </span>
            </div>

            <div className="inline-flex items-center p-0.5 bg-zinc-100 border border-zinc-200 rounded-md">
              {(
                [
                  { id: 'week', label: 'Week' },
                  { id: 'month', label: 'Month' },
                  { id: 'custom', label: 'Custom' },
                ] as { id: PeriodFilterMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setCfdFilterMode(opt.id);
                    setHoveredCfdIdx(null);
                  }}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                    cfdFilterMode === opt.id
                      ? 'bg-white text-zinc-900 shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {cfdFilterMode === 'month' && (
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="cfd-month" className="text-xs text-zinc-600">
              Month:
            </label>
            <input
              id="cfd-month"
              type="month"
              value={cfdMonth}
              onChange={(e) => {
                setCfdMonth(e.target.value);
                setHoveredCfdIdx(null);
              }}
              className="px-2.5 py-1 text-xs font-mono text-zinc-900 bg-white border border-zinc-300 rounded"
            />
          </div>
        )}

        {cfdFilterMode === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="CFD start date"
              value={cfdCustomFrom}
              onChange={(e) => {
                setCfdCustomFrom(e.target.value);
                setHoveredCfdIdx(null);
              }}
              className="px-2.5 py-1 text-xs font-mono text-zinc-900 bg-white border border-zinc-300 rounded"
            />
            <span className="text-xs text-zinc-400">to</span>
            <input
              type="date"
              aria-label="CFD end date"
              value={cfdCustomTo}
              onChange={(e) => {
                setCfdCustomTo(e.target.value);
                setHoveredCfdIdx(null);
              }}
              className="px-2.5 py-1 text-xs font-mono text-zinc-900 bg-white border border-zinc-300 rounded"
            />
          </div>
        )}

        {filteredCfdSeries.length === 0 ? (
          <div className="mt-5 p-8 border border-dashed border-zinc-300 rounded-md text-center text-xs text-zinc-500">
            No CFD daily snapshots fall inside the selected date range. Daily snapshots lock automatically each day you plan and execute steps.
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {/* Active / Hovered Day Readout Bar */}
            {activeCfdPoint && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 bg-zinc-50 border border-zinc-200 rounded-md text-xs tabular-nums">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-zinc-900">
                    {formatShortDate(activeCfdPoint.date)}
                  </span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono border rounded bg-white border-zinc-200 text-zinc-600">
                    {activeCfdPoint.locked ? (
                      <>
                        <Lock className="w-2.5 h-2.5" />
                        Frozen Snapshot
                      </>
                    ) : (
                      'Live Today'
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-4 font-mono">
                  <span className="text-emerald-700 font-semibold">
                    Completed: {activeCfdPoint.completed}
                  </span>
                  <span className="text-sky-700 font-semibold">
                    In Progress: {activeCfdPoint.inProgress}
                  </span>
                  <span className="text-zinc-600 font-semibold">
                    Not Started: {activeCfdPoint.notStarted}
                  </span>
                  <span className="text-zinc-900 font-bold">
                    Total Steps: {activeCfdPoint.total}
                  </span>
                </div>
              </div>
            )}

            {/* Stacked Area Chart SVG */}
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${cfdGeometry.width} ${cfdGeometry.height}`}
                className="w-full h-56 select-none"
                role="img"
                aria-label="Cumulative Flow Diagram showing Completed, In Progress, and Not Started steps over time"
              >
                {/* Horizontal Y-Axis Gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                  const val = Math.round(frac * cfdGeometry.yCeil);
                  const y = cfdGeometry.yAt(val);
                  return (
                    <g key={frac}>
                      <line
                        x1={cfdGeometry.padL}
                        x2={cfdGeometry.width - cfdGeometry.padR}
                        y1={y}
                        y2={y}
                        stroke="#e4e4e7"
                        strokeDasharray={frac === 0 ? undefined : '3 3'}
                      />
                      <text
                        x={cfdGeometry.padL - 8}
                        y={y + 3}
                        textAnchor="end"
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                        fill="#71717a"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Top Band: Not Started */}
                <path d={cfdGeometry.notStartedArea} fill="#d4d4d8" fillOpacity="0.65" />
                {/* Middle Band: In Progress (WIP) */}
                <path d={cfdGeometry.inProgressArea} fill="#0ea5e9" fillOpacity="0.45" />
                {/* Bottom Band: Completed */}
                <path d={cfdGeometry.completedArea} fill="#10b981" fillOpacity="0.55" />

                {/* Crisp Boundary Strokes */}
                {cfdGeometry.totalLine && (
                  <path
                    d={cfdGeometry.totalLine}
                    fill="none"
                    stroke="#71717a"
                    strokeWidth="1.5"
                  />
                )}
                {cfdGeometry.wipLine && (
                  <path
                    d={cfdGeometry.wipLine}
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth="1.5"
                  />
                )}
                {cfdGeometry.completedLine && (
                  <path
                    d={cfdGeometry.completedLine}
                    fill="none"
                    stroke="#059669"
                    strokeWidth="1.75"
                  />
                )}

                {/* Vertical Crosshair & Points + Interactive Hover Columns */}
                {filteredCfdSeries.map((pt, i) => {
                  const cx = cfdGeometry.xAt(i);
                  const isFocused =
                    hoveredCfdIdx === i ||
                    (hoveredCfdIdx === null && i === filteredCfdSeries.length - 1);
                  const colW =
                    filteredCfdSeries.length <= 1
                      ? cfdGeometry.plotW
                      : cfdGeometry.plotW / Math.max(1, filteredCfdSeries.length - 1);

                  const showLabel =
                    filteredCfdSeries.length <= 10 ||
                    i === 0 ||
                    i === filteredCfdSeries.length - 1 ||
                    i % Math.ceil(filteredCfdSeries.length / 7) === 0;

                  return (
                    <g key={pt.date}>
                      {isFocused && (
                        <>
                          <line
                            x1={cx}
                            x2={cx}
                            y1={cfdGeometry.padT}
                            y2={cfdGeometry.padT + cfdGeometry.plotH}
                            stroke="#18181b"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          <circle
                            cx={cx}
                            cy={cfdGeometry.yAt(pt.completed)}
                            r="3.5"
                            fill="#059669"
                            stroke="#ffffff"
                            strokeWidth="1.2"
                          />
                          <circle
                            cx={cx}
                            cy={cfdGeometry.yAt(pt.completed + pt.inProgress)}
                            r="3.5"
                            fill="#0284c7"
                            stroke="#ffffff"
                            strokeWidth="1.2"
                          />
                          <circle
                            cx={cx}
                            cy={cfdGeometry.yAt(pt.completed + pt.inProgress + pt.notStarted)}
                            r="3.5"
                            fill="#52525b"
                            stroke="#ffffff"
                            strokeWidth="1.2"
                          />
                        </>
                      )}

                      {showLabel && (
                        <text
                          x={cx}
                          y={cfdGeometry.height - 8}
                          textAnchor="middle"
                          fontSize="10"
                          fontFamily="JetBrains Mono, monospace"
                          fill={isFocused ? '#18181b' : '#71717a'}
                          fontWeight={isFocused ? '600' : '400'}
                        >
                          {formatCompactDate(pt.date)}
                        </text>
                      )}

                      {/* Invisible hover hit strip */}
                      <rect
                        x={cx - colW / 2}
                        y={cfdGeometry.padT}
                        width={colW}
                        height={cfdGeometry.plotH + cfdGeometry.padB}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoveredCfdIdx(i)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
