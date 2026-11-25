import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  History,
  RotateCcw,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { AIConflict, AIProposedBlockInput, AIScheduleProposal, ProposalChangeKind } from '../types';
import { getTaskSwatch } from '../utils/colors';
import {
  formatDuration,
  formatMinutesToTime,
  formatShortDate,
  formatWeekRange,
  getISOWeekNumber,
  getTaskDeadlines,
  getWeekDays,
  addDays,
} from '../utils/dateUtils';
import {
  calculateWeeklyCapacityStats,
  getFixedActivitiesForDate,
  validateAndBuildAIProposal,
} from '../utils/schedulingUtils';
import { useLanguage } from '../i18n/LanguageContext';

interface AIScheduleModalProps {
  isOpen: boolean;
  initialMode?: 'assistant' | 'history';
  onClose: () => void;
}

const DIFF_STYLES: Record<ProposalChangeKind, string> = {
  added: 'text-emerald-800 bg-emerald-50 border-emerald-200',
  modified: 'text-amber-800 bg-amber-50 border-amber-200',
  removed: 'text-red-800 bg-red-50 border-red-200',
  unchanged: 'text-zinc-600 bg-zinc-50 border-zinc-200',
};

export const AIScheduleModal: React.FC<AIScheduleModalProps> = ({
  isOpen,
  initialMode = 'assistant',
  onClose,
}) => {
  const {
    tasks,
    steps,
    scheduledBlocks,
    fixedActivities,
    scheduleVersions,
    workCapacity,
    displayedWeekStart,
    todayStr,
    applyProposedWeekSchedule,
    restoreScheduleVersion,
    undoLastScheduleChange,
  } = useAppState();
  const { t, language } = useLanguage();

  const [mode, setMode] = useState<'assistant' | 'history'>(initialMode);
  const [preferenceNote, setPreferenceNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AIScheduleProposal | null>(null);
  const [appliedBanner, setAppliedBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    setError(null);
    setAppliedBanner(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, initialMode, onClose]);

  const weekDays = useMemo(() => getWeekDays(displayedWeekStart), [displayedWeekStart]);
  const weekDaySet = useMemo(() => new Set(weekDays), [weekDays]);
  const isoWeekNum = useMemo(() => getISOWeekNumber(addDays(displayedWeekStart, 4)), [displayedWeekStart]);
  const weekRangeLabel = useMemo(
    () => formatWeekRange(displayedWeekStart, language),
    [displayedWeekStart, language]
  );

  const currentWeekBlocks = useMemo(
    () => scheduledBlocks.filter((b) => weekDaySet.has(b.date)),
    [scheduledBlocks, weekDaySet]
  );

  const allBlocksOutsideWeek = useMemo(
    () => scheduledBlocks.filter((b) => !weekDaySet.has(b.date)),
    [scheduledBlocks, weekDaySet]
  );

  const capacityStats = useMemo(
    () => calculateWeeklyCapacityStats(weekDays, fixedActivities, scheduledBlocks, workCapacity),
    [weekDays, fixedActivities, scheduledBlocks, workCapacity]
  );

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const stepMap = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);

  if (!isOpen) return null;

  const handleGenerateProposal = async () => {
    setIsGenerating(true);
    setError(null);
    setAppliedBanner(null);

    try {
      const materializedFixed = weekDays.flatMap((date) =>
        getFixedActivitiesForDate(fixedActivities, date).map((fa) => ({
          id: fa.id,
          title: fa.title,
          kind: fa.kind,
          date,
          startMinutes: fa.startMinutes,
          endMinutes: fa.endMinutes,
          countsAsWorkingTime: fa.countsAsWorkingTime,
          linkedStepIds: fa.linkedStepIds,
        }))
      );

      const activeTasks = tasks.filter((t) => t.status !== 'completed');
      const activeTaskIds = new Set(activeTasks.map((t) => t.id));
      const relevantSteps = steps.filter((s) => activeTaskIds.has(s.taskId));

      const response = await fetch('/api/ai/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart: displayedWeekStart,
          weekDays,
          todayStr,
          workdayStartMinutes: workCapacity.workdayStartMinutes,
          workdayEndMinutes: workCapacity.workdayEndMinutes,
          dailyTargetMinutes: Math.round(workCapacity.dailyTargetHours * 60),
          userPreference: preferenceNote.trim() || undefined,
          tasks: activeTasks.map((t) => ({
            id: t.id,
            name: t.name,
            deadline: t.deadline,
            deadlines: getTaskDeadlines(t).map((d) => ({ date: d.date, label: d.label })),
            status: t.status,
            responsibility: t.responsibility,
            valueCategory: t.valueCategory,
          })),
          steps: relevantSteps.map((s) => ({
            id: s.id,
            taskId: s.taskId,
            title: s.title,
            order: s.order,
            estimatedMinutes: s.estimatedMinutes,
            completed: s.completed,
            responsibility: s.responsibility,
            dependsOnStepIds: s.dependsOnStepIds,
            valueCategory: s.valueCategory,
          })),
          fixedActivities: materializedFixed,
          currentBlocks: currentWeekBlocks,
          language,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t.aiModal.errGenerate);
      }

      const validated = validateAndBuildAIProposal({
        weekStart: displayedWeekStart,
        weekDays,
        summary: typeof data.summary === 'string' ? data.summary : t.aiModal.defaultSummary,
        aiConflicts: Array.isArray(data.conflicts) ? (data.conflicts as AIConflict[]) : [],
        rawProposed: Array.isArray(data.proposedBlocks)
          ? (data.proposedBlocks as AIProposedBlockInput[])
          : [],
        tasks,
        steps,
        fixedActivities,
        currentWeekBlocks,
        allBlocksOutsideWeek,
        lang: language,
      });

      setProposal(validated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.aiModal.errReach);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveAndApply = () => {
    if (!proposal) return;
    applyProposedWeekSchedule(
      proposal.weekStart,
      proposal.proposedWeekBlocks,
      t.aiModal.snapshotLabel(isoWeekNum)
    );
    setProposal(null);
    setAppliedBanner(t.aiModal.bannerApplied);
  };

  const changedDiffs = proposal ? proposal.diffs.filter((d) => d.kind !== 'unchanged') : [];
  const unchangedCount = proposal ? proposal.diffs.filter((d) => d.kind === 'unchanged').length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-schedule-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-white border border-zinc-200 rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-zinc-800" />
              <h2 id="ai-schedule-title" className="text-base font-semibold text-zinc-900">
                {t.aiModal.title}
              </h2>
            </div>

            <div className="flex items-center gap-1 p-0.5 bg-zinc-100 rounded-md border border-zinc-200">
              <button
                type="button"
                onClick={() => setMode('assistant')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'assistant'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {t.aiModal.optimizeTab(isoWeekNum)}
              </button>
              <button
                type="button"
                onClick={() => setMode('history')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'history'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {t.aiModal.historyTab(scheduleVersions.length)}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {scheduleVersions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  undoLastScheduleChange();
                  setAppliedBanner(t.aiModal.bannerUndone);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 whitespace-nowrap shrink-0"
              >
                <Undo2 className="w-3.5 h-3.5" />
                {t.aiModal.undoLastApply}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md"
              aria-label={t.common.closeModal}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {appliedBanner && (
            <div className="px-3.5 py-2.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{appliedBanner}</span>
            </div>
          )}

          {error && (
            <div className="px-3.5 py-2.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {mode === 'assistant' ? (
            <>
              {/* Context Summary */}
              <div className="bg-zinc-50 border border-zinc-200 rounded-md p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-zinc-900">
                      {t.aiModal.weekLine(isoWeekNum, weekRangeLabel)}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                      {t.aiModal.contextNote}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-zinc-700">
                    <span>{t.aiModal.placed(formatDuration(capacityStats.scheduledStepsMinutes))}</span>
                    <span>{t.aiModal.fixedWork(formatDuration(capacityStats.fixedWorkingMinutes))}</span>
                    <span className="font-semibold text-zinc-900">
                      {t.aiModal.available(formatDuration(capacityStats.remainingAvailableMinutes))}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={preferenceNote}
                    onChange={(e) => setPreferenceNote(e.target.value)}
                    placeholder={t.aiModal.guidancePlaceholder}
                    className="flex-1 px-3 py-2 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={handleGenerateProposal}
                    disabled={isGenerating}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {isGenerating
                      ? t.aiModal.analyzingBtn
                      : proposal
                      ? t.aiModal.regenerateBtn
                      : t.aiModal.generateBtn}
                  </button>
                </div>
              </div>

              {/* Proposal Review & Diff */}
              {proposal && (
                <div className="space-y-4">
                  <div className="border border-zinc-200 rounded-md p-4 bg-white">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {t.aiModal.summaryHeading}
                    </div>
                    <p className="text-sm text-zinc-800 mt-1 leading-relaxed">{proposal.summary}</p>
                  </div>

                  {/* Detected Conflicts */}
                  {proposal.conflicts.length > 0 && (
                    <div className="border border-amber-200 bg-amber-50/60 rounded-md p-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                        {t.aiModal.conflictsHeading(proposal.conflicts.length)}
                      </div>
                      <ul className="space-y-1 text-xs text-amber-900 list-disc pl-5">
                        {proposal.conflicts.map((c, idx) => (
                          <li key={idx}>
                            {c.date ? (
                              <span className="font-mono">{formatShortDate(c.date, language)}: </span>
                            ) : null}
                            {c.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Diff Comparison */}
                  <div className="border border-zinc-200 rounded-md overflow-hidden">
                    <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-zinc-800">
                        {t.aiModal.comparisonHeading}
                      </h3>
                      <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                        {t.aiModal.changesSummary(changedDiffs.length, unchangedCount)}
                      </span>
                    </div>

                    {proposal.diffs.length === 0 ? (
                      <div className="p-6 text-center text-xs text-zinc-500">
                        {t.aiModal.noProposals}
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-200/80 max-h-[300px] overflow-y-auto">
                        {proposal.diffs.map((item, idx) => {
                          const step = stepMap.get(item.stepId);
                          const task = taskMap.get(item.taskId);
                          const swatch = task ? getTaskSwatch(task.colorId) : null;
                          const badgeStyle = DIFF_STYLES[item.kind];
                          const badgeLabel = t.aiModal.diffLabels[item.kind];

                          return (
                            <div key={`${item.stepId}-${idx}`} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <span
                                  className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded shrink-0 mt-0.5 ${badgeStyle}`}
                                >
                                  {badgeLabel}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    {swatch && (
                                      <span
                                        className="w-2.5 h-2.5 rounded-sm border shrink-0"
                                        style={{
                                          backgroundColor: swatch.bg,
                                          borderColor: swatch.swatch,
                                        }}
                                      />
                                    )}
                                    <span className="text-xs font-medium text-zinc-900 truncate">
                                      {step?.title ?? item.stepId}
                                    </span>
                                    {task && (
                                      <span className="text-[11px] text-zinc-500 truncate">
                                        ({task.name})
                                      </span>
                                    )}
                                  </div>
                                  {item.reason && (
                                    <p className="text-[11px] text-zinc-500 mt-0.5">{item.reason}</p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums shrink-0">
                                {item.before ? (
                                  <span className={item.kind === 'removed' ? 'line-through text-red-700' : 'text-zinc-500'}>
                                    {formatShortDate(item.before.date, language)}{' '}
                                    {formatMinutesToTime(item.before.startMinutes)}–
                                    {formatMinutesToTime(
                                      item.before.startMinutes + item.before.durationMinutes
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-zinc-400">{t.common.unscheduled}</span>
                                )}

                                {(item.kind === 'added' || item.kind === 'modified') && (
                                  <>
                                    <ArrowRight className="w-3 h-3 text-zinc-400" />
                                    {item.after && (
                                      <span className="font-semibold text-zinc-900">
                                        {formatShortDate(item.after.date, language)}{' '}
                                        {formatMinutesToTime(item.after.startMinutes)}–
                                        {formatMinutesToTime(
                                          item.after.startMinutes + item.after.durationMinutes
                                        )}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Explicit Approval Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-200">
                    <span className="text-xs text-zinc-500">
                      {t.aiModal.applyHint(isoWeekNum)}
                    </span>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setProposal(null)}
                        className="px-4 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 whitespace-nowrap shrink-0"
                      >
                        {t.aiModal.discardBtn}
                      </button>
                      <button
                        type="button"
                        onClick={handleApproveAndApply}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 whitespace-nowrap shrink-0"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t.aiModal.approveBtn}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Version History View */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                    <History className="w-4 h-4 text-zinc-700" />
                    {t.aiModal.historyTitle}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {t.aiModal.historyDesc}
                  </p>
                </div>
              </div>

              {scheduleVersions.length === 0 ? (
                <div className="p-8 border border-dashed border-zinc-300 rounded-md text-center text-xs text-zinc-500">
                  {t.aiModal.noVersions}
                </div>
              ) : (
                <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-md">
                  {scheduleVersions.map((ver) => (
                    <div
                      key={ver.id}
                      className="px-4 py-3 flex items-center justify-between gap-4 bg-white"
                    >
                      <div>
                        <div className="text-xs font-medium text-zinc-900">{ver.label}</div>
                        <div className="text-[11px] font-mono tabular-nums text-zinc-500 mt-0.5">
                          {t.aiModal.savedMeta(
                            new Date(ver.createdAt).toLocaleString(
                              language === 'fr' ? 'fr-FR' : 'en-US'
                            ),
                            ver.blocks.length
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          restoreScheduleVersion(ver.id);
                          setAppliedBanner(t.aiModal.bannerRestored(ver.label));
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {t.aiModal.restoreBtn}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
