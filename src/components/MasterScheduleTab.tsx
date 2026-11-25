import React, { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { Responsibility, Task, TaskStatus, ValueCategory } from '../types';
import { getSwatchLabel, getTaskSwatch } from '../utils/colors';
import {
  formatCompactDate,
  formatRelativeDeadline,
  formatShortDate,
  getISOWeekNumber,
  getTaskDeadlines,
  isValidDateString,
} from '../utils/dateUtils';
import { ConfirmModal } from './ConfirmModal';
import { useLanguage } from '../i18n/LanguageContext';

interface MasterScheduleTabProps {
  onNewTask: () => void;
  onEditTask: (task: Task) => void;
}

type StatusFilter = 'all' | TaskStatus;

export const MasterScheduleTab: React.FC<MasterScheduleTabProps> = ({
  onNewTask,
  onEditTask,
}) => {
  const {
    tasks,
    steps,
    scheduledBlocks,
    todayStr,
    updateTask,
    deleteTaskCascade,
    openTaskInWBS,
  } = useAppState();
  const { language, t } = useLanguage();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());

  const toggleExpandDeadlines = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const sortedTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...tasks]
      .filter((t) => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp = a.deadline.localeCompare(b.deadline);
        if (cmp !== 0) return cmp;
        return a.createdAt - b.createdAt;
      });
  }, [tasks, statusFilter, searchQuery]);

  const stepStatsByTask = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const s of steps) {
      const cur = map.get(s.taskId) ?? { total: 0, done: 0 };
      cur.total += 1;
      if (s.completed) cur.done += 1;
      map.set(s.taskId, cur);
    }
    return map;
  }, [steps]);

  const scheduledCountByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of scheduledBlocks) {
      map.set(b.taskId, (map.get(b.taskId) ?? 0) + 1);
    }
    return map;
  }, [scheduledBlocks]);

  const deleteStepCount = taskToDelete ? (stepStatsByTask.get(taskToDelete.id)?.total ?? 0) : 0;
  const deleteBlockCount = taskToDelete ? (scheduledCountByTask.get(taskToDelete.id) ?? 0) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{t.master.title}</h1>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
            {t.master.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-zinc-200/70 rounded-md">
            {(
              [
                { id: 'all', label: t.master.filterAll },
                { id: 'todo', label: t.common.status.todo },
                { id: 'in_progress', label: t.common.status.in_progress },
                { id: 'completed', label: t.common.status.completed },
              ] as { id: StatusFilter; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStatusFilter(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === opt.id
                    ? 'bg-white text-zinc-900'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.master.searchPlaceholder}
              aria-label={t.master.searchAria}
              className="w-48 pl-8 pr-3 py-1.5 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
            />
          </div>

          <button
            type="button"
            onClick={onNewTask}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.master.newObjective}
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-8 bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <h2 className="text-base font-semibold text-zinc-900">{t.master.emptyTitle}</h2>
          <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
            {t.master.emptyDesc}
          </p>
          <button
            type="button"
            onClick={onNewTask}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.master.createFirst}
          </button>
        </div>
      ) : sortedTasks.length === 0 ? (
        <div className="mt-6 bg-white border border-zinc-200 rounded-lg p-10 text-center">
          <p className="text-sm text-zinc-600">{t.master.noFilterMatch}</p>
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all');
              setSearchQuery('');
            }}
            className="mt-3 text-xs font-medium text-zinc-900 underline underline-offset-4"
          >
            {t.master.resetFilters}
          </button>
        </div>
      ) : (
        <div className="mt-5 bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] font-semibold text-zinc-500">
                  <th className="py-2.5 pl-4 pr-3 w-[30%]">{t.master.colObjective}</th>
                  <th className="py-2.5 px-3 w-[20%]">{t.master.colDeadlines}</th>
                  <th className="py-2.5 px-3 w-[12%]">{t.master.colStatus}</th>
                  <th className="py-2.5 px-3 w-[10%]">{t.master.colOwner}</th>
                  <th className="py-2.5 px-3 w-[8%]">{t.master.colLean}</th>
                  <th className="py-2.5 px-3 w-[11%]">{t.master.colWbsSteps}</th>
                  <th className="py-2.5 pl-3 pr-4 text-right w-[9%]">{t.master.colActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/80 text-sm">
                {sortedTasks.map((task) => {
                  const swatch = getTaskSwatch(task.colorId);
                  const stepStat = stepStatsByTask.get(task.id) ?? { total: 0, done: 0 };
                  const scheduledCount = scheduledCountByTask.get(task.id) ?? 0;
                  const deadlines = getTaskDeadlines(task);
                  const deadlineInfo = formatRelativeDeadline(
                    task.deadline,
                    todayStr,
                    task.status,
                    language
                  );

                  const isExpanded = expandedTaskIds.has(task.id);

                  return (
                    <React.Fragment key={task.id}>
                      <tr className="hover:bg-zinc-50/80 transition-colors group">
                        <td className="py-3 pl-4 pr-3 align-top">
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() => toggleExpandDeadlines(task.id)}
                              aria-expanded={isExpanded}
                              aria-label={
                                isExpanded
                                  ? t.master.collapseDeadlinesAria(task.name)
                                  : t.master.expandDeadlinesAria(task.name)
                              }
                              title={
                                isExpanded
                                  ? t.master.collapseDeadlinesAria(task.name)
                                  : t.master.expandDeadlinesAria(task.name)
                              }
                              className="mt-0.5 p-0.5 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200/70 transition-colors shrink-0"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <span
                              className="w-3 h-3 rounded-sm border shrink-0 mt-1"
                              style={{
                                backgroundColor: swatch.bg,
                                borderColor: swatch.swatch,
                              }}
                              title={t.master.colorTitle(getSwatchLabel(swatch, language))}
                            />
                            <div className="min-w-0">
                              <div
                                className={`font-medium leading-snug ${
                                  task.status === 'completed'
                                    ? 'line-through text-zinc-500'
                                    : 'text-zinc-900'
                                }`}
                              >
                                {task.name}
                              </div>
                              {task.description && (
                                <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
                                  {task.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Primary Editable Deadline + Expandable Chronological Milestones */}
                        <td className="py-3 px-3 align-top">
                          <div className="flex flex-col gap-1">
                            <input
                              type="date"
                              value={task.deadline}
                              aria-label={t.master.primaryDeadlineAria(task.name)}
                              onChange={(e) => {
                                const nextVal = e.target.value;
                                if (isValidDateString(nextVal)) {
                                  updateTask(task.id, { deadline: nextVal });
                                }
                              }}
                              className="w-36 px-2 py-1 text-xs font-mono tabular-nums text-zinc-800 bg-white border border-zinc-200 rounded hover:border-zinc-400 focus:outline-none focus:border-zinc-900"
                            />
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] tabular-nums">
                              <span
                                className={
                                  deadlineInfo.isOverdue
                                    ? 'font-semibold text-red-700'
                                    : deadlineInfo.isDueSoon
                                    ? 'font-medium text-amber-700'
                                    : 'text-zinc-500'
                                }
                              >
                                {deadlineInfo.label}
                              </span>
                              {deadlines.length > 1 && (
                                <>
                                  <span className="text-zinc-300" aria-hidden="true">·</span>
                                  <button
                                    type="button"
                                    onClick={() => toggleExpandDeadlines(task.id)}
                                    className="font-mono text-zinc-700 hover:text-zinc-950 underline underline-offset-2"
                                    title={deadlines
                                      .map((d) => `${d.label ? `${d.label}: ` : ''}${d.date}`)
                                      .join(' | ')}
                                  >
                                    +{deadlines.length - 1} ({deadlines
                                      .slice(1, 3)
                                      .map((d) => formatCompactDate(d.date, language))
                                      .join(', ')})
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </td>

                      <td className="py-3 px-3 align-top">
                        <select
                          value={task.status}
                          aria-label={t.master.statusAria(task.name)}
                          onChange={(e) =>
                            updateTask(task.id, { status: e.target.value as TaskStatus })
                          }
                          className="px-2 py-1 text-xs font-medium text-zinc-800 bg-white border border-zinc-200 rounded hover:border-zinc-400 focus:outline-none focus:border-zinc-900 cursor-pointer"
                        >
                          <option value="todo">{t.common.status.todo}</option>
                          <option value="in_progress">{t.common.status.in_progress}</option>
                          <option value="completed">{t.common.status.completed}</option>
                        </select>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <select
                          value={task.responsibility}
                          aria-label={t.master.ownerAria(task.name)}
                          onChange={(e) =>
                            updateTask(task.id, {
                              responsibility: e.target.value as Responsibility,
                            })
                          }
                          className="px-2 py-1 text-xs font-medium text-zinc-800 bg-white border border-zinc-200 rounded hover:border-zinc-400 focus:outline-none focus:border-zinc-900 cursor-pointer"
                        >
                          <option value="Me">{t.common.responsibility.Me}</option>
                          <option value="Others">{t.common.responsibility.Others}</option>
                        </select>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <select
                          value={task.valueCategory}
                          aria-label={t.master.leanAria(task.name)}
                          onChange={(e) =>
                            updateTask(task.id, {
                              valueCategory: e.target.value as ValueCategory,
                            })
                          }
                          className="px-2 py-1 text-xs font-mono font-medium text-zinc-800 bg-white border border-zinc-200 rounded hover:border-zinc-400 focus:outline-none focus:border-zinc-900 cursor-pointer"
                        >
                          <option value="VA">VA</option>
                          <option value="NNVA">NNVA</option>
                          <option value="NVA">NVA</option>
                        </select>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                            <span className="font-mono text-zinc-700">
                              {t.master.stepsRatio(stepStat.done, stepStat.total)}
                            </span>
                            {scheduledCount > 0 && (
                              <span className="text-[11px] text-zinc-400 font-mono">
                                {scheduledCount}×
                              </span>
                            )}
                          </div>
                          {stepStat.total > 0 && (
                            <div className="h-1 w-24 bg-zinc-100 rounded-full overflow-hidden">
                              <div
                                className="h-full"
                                style={{
                                  width: `${Math.round((stepStat.done / stepStat.total) * 100)}%`,
                                  backgroundColor: swatch.swatch,
                                }}
                              />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => openTaskInWBS(task.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 w-fit mt-0.5"
                          >
                            <Layers className="w-3 h-3" />
                            {t.master.breakdownBtn}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 pl-3 pr-4 align-top text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditTask(task)}
                            title={t.master.editTitle}
                            aria-label={t.master.editAria(task.name)}
                            className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setTaskToDelete(task)}
                            title={t.master.deleteTitle}
                            aria-label={t.master.deleteAria(task.name)}
                            className="p-1.5 text-zinc-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-zinc-50/70">
                        <td colSpan={7} className="px-4 py-3 pl-12 border-t border-zinc-100">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                              {t.master.chronologicalDeadlinesTitle(deadlines.length)}
                            </div>
                            <button
                              type="button"
                              onClick={() => onEditTask(task)}
                              className="text-[11px] font-medium text-zinc-700 hover:text-zinc-950 underline underline-offset-2"
                            >
                              {t.master.editMilestones}
                            </button>
                          </div>
                          <ol className="space-y-1.5">
                            {deadlines.map((dl, idx) => {
                              const dlInfo = formatRelativeDeadline(
                                dl.date,
                                todayStr,
                                task.status,
                                language
                              );
                              return (
                                <li
                                  key={dl.id}
                                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5 bg-white border border-zinc-200/90 rounded text-xs tabular-nums"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="font-mono text-[11px] text-zinc-400 w-4 shrink-0">
                                      {idx + 1}.
                                    </span>
                                    <span className="font-mono font-medium text-zinc-900 shrink-0">
                                      {formatShortDate(dl.date, language)}
                                    </span>
                                    <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                                      {t.stats.weekShortPrefix}{getISOWeekNumber(dl.date)}
                                    </span>
                                    <span className="text-zinc-700 truncate">
                                      {dl.label?.trim() || t.master.defaultMilestoneLabel}
                                    </span>
                                  </div>
                                  <span
                                    className={`text-[11px] font-medium shrink-0 ${
                                      dlInfo.isOverdue
                                        ? 'text-red-700 font-semibold'
                                        : dlInfo.isDueSoon
                                        ? 'text-amber-700'
                                        : 'text-zinc-500'
                                    }`}
                                  >
                                    {dlInfo.label}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(taskToDelete)}
        title={t.master.deleteModalTitle}
        message={
          taskToDelete
            ? t.master.deleteModalMessage(taskToDelete.name, deleteStepCount, deleteBlockCount)
            : ''
        }
        confirmLabel={t.master.deleteModalConfirm}
        destructive
        onCancel={() => setTaskToDelete(null)}
        onConfirm={() => {
          if (taskToDelete) {
            deleteTaskCascade(taskToDelete.id);
            setTaskToDelete(null);
          }
        }}
      />
    </div>
  );
};
