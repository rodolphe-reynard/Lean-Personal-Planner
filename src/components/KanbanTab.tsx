import React, { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, Layers, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { Task, TaskStatus } from '../types';
import { getTaskSwatch } from '../utils/colors';
import {
  formatRelativeDeadline,
  formatShortDate,
  getNextRelevantDeadline,
  getTaskDeadlines,
} from '../utils/dateUtils';
import { ConfirmModal } from './ConfirmModal';
import { StepExecutionControl } from './StepExecutionControl';

interface KanbanTabProps {
  onNewTask: (defaultStatus?: TaskStatus) => void;
  onEditTask: (task: Task) => void;
}

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in_progress', title: 'In Progress' },
  { status: 'completed', title: 'Completed' },
];

export const KanbanTab: React.FC<KanbanTabProps> = ({ onNewTask, onEditTask }) => {
  const {
    tasks,
    steps,
    scheduledBlocks,
    todayStr,
    updateTask,
    setStepExecutionState,
    deleteTaskCascade,
    openTaskInWBS,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? tasks.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q)
        )
      : tasks;
    return [...list].sort((a, b) => a.deadline.localeCompare(b.deadline));
  }, [tasks, searchQuery]);

  const stepsByTask = useMemo(() => {
    const map = new Map<string, typeof steps>();
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

  const scheduledCountByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of scheduledBlocks) {
      map.set(b.taskId, (map.get(b.taskId) ?? 0) + 1);
    }
    return map;
  }, [scheduledBlocks]);

  const toggleExpand = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleDropOnColumn = (targetStatus: TaskStatus) => {
    if (draggedTaskId) {
      const task = tasks.find((t) => t.id === draggedTaskId);
      if (task && task.status !== targetStatus) {
        updateTask(task.id, { status: targetStatus });
      }
    }
    setDraggedTaskId(null);
    setDragOverStatus(null);
  };

  const deleteStepCount = taskToDelete ? (stepsByTask.get(taskToDelete.id)?.length ?? 0) : 0;
  const deleteBlockCount = taskToDelete ? (scheduledCountByTask.get(taskToDelete.id) ?? 0) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Kanban Board</h1>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
            Overview across {tasks.length} objectives · {steps.filter((s) => s.completed).length} of {steps.length} steps completed
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter objectives..."
              aria-label="Filter objectives"
              className="w-52 pl-8 pr-3 py-1.5 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
            />
          </div>
          <button
            type="button"
            onClick={() => onNewTask('todo')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Objective
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-8 bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <h2 className="text-base font-semibold text-zinc-900">No objectives yet</h2>
          <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
            Create your first objective to track it on the Kanban board, decompose it into WBS steps, and pull work into your weekly plan.
          </p>
          <button
            type="button"
            onClick={() => onNewTask('todo')}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create First Objective
          </button>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 min-h-0 items-start">
          {COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.status);
            const isOver = dragOverStatus === col.status;

            return (
              <section
                key={col.status}
                aria-label={col.title}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverStatus !== col.status) setDragOverStatus(col.status);
                }}
                onDragLeave={() => {
                  if (dragOverStatus === col.status) setDragOverStatus(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDropOnColumn(col.status);
                }}
                className={`flex flex-col rounded-lg border transition-colors p-3 min-h-[380px] ${
                  isOver ? 'bg-zinc-100 border-zinc-500' : 'bg-zinc-100/70 border-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between px-1 pb-3 mb-2 border-b border-zinc-200/80">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-semibold tracking-wide text-zinc-800">
                      {col.title}
                    </h2>
                    <span className="text-xs font-mono tabular-nums text-zinc-500">
                      {colTasks.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNewTask(col.status)}
                    title={`Add objective to ${col.title}`}
                    aria-label={`Add objective to ${col.title}`}
                    className="p-1 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/70 rounded transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-2.5 flex-1">
                  {colTasks.length === 0 ? (
                    <div className="py-10 px-4 text-center border border-dashed border-zinc-300 rounded-md text-xs text-zinc-400">
                      {searchQuery.trim() ? 'No matching objectives' : 'Drop an objective here'}
                    </div>
                  ) : (
                    colTasks.map((task) => {
                      const swatch = getTaskSwatch(task.colorId);
                      const taskSteps = stepsByTask.get(task.id) ?? [];
                      const completedCount = taskSteps.filter((s) => s.completed).length;
                      const scheduledCount = scheduledCountByTask.get(task.id) ?? 0;
                      const progressPct =
                        taskSteps.length > 0
                          ? Math.round((completedCount / taskSteps.length) * 100)
                          : 0;
                      const deadlines = getTaskDeadlines(task);
                      const nextDl = getNextRelevantDeadline(task, todayStr);
                      const deadlineInfo = formatRelativeDeadline(nextDl.date, todayStr, task.status);
                      const isExpanded = expandedTaskIds.has(task.id);
                      const isDragging = draggedTaskId === task.id;

                      return (
                        <article
                          key={task.id}
                          draggable
                          onDragStart={(e) => {
                            setDraggedTaskId(task.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', task.id);
                          }}
                          onDragEnd={() => {
                            setDraggedTaskId(null);
                            setDragOverStatus(null);
                          }}
                          className={`group bg-white border border-zinc-200 rounded-md p-3.5 transition-opacity cursor-grab active:cursor-grabbing ${
                            isDragging ? 'opacity-40' : 'opacity-100 hover:border-zinc-300'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <span
                                className="w-3 h-3 rounded-sm border shrink-0 mt-1"
                                style={{
                                  backgroundColor: swatch.bg,
                                  borderColor: swatch.swatch,
                                }}
                                title={`Task color: ${swatch.label}`}
                              />
                              <h3
                                className={`text-sm font-medium leading-snug ${
                                  task.status === 'completed'
                                    ? 'line-through text-zinc-500'
                                    : 'text-zinc-900'
                                }`}
                              >
                                {task.name}
                              </h3>
                            </div>

                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                              <button
                                type="button"
                                onClick={() => onEditTask(task)}
                                title="Edit objective"
                                aria-label={`Edit ${task.name}`}
                                className="p-1 text-zinc-400 hover:text-zinc-800 rounded"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setTaskToDelete(task)}
                                title="Delete objective"
                                aria-label={`Delete ${task.name}`}
                                className="p-1 text-zinc-400 hover:text-red-600 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {task.description && (
                            <p className="mt-1.5 pl-5 text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                              {task.description}
                            </p>
                          )}

                          <div className="mt-3 pl-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums">
                            <span
                              className={
                                deadlineInfo.isOverdue
                                  ? 'font-medium text-red-700'
                                  : deadlineInfo.isDueSoon
                                  ? 'font-medium text-amber-700'
                                  : 'text-zinc-500'
                              }
                            >
                              {formatShortDate(nextDl.date)} · {deadlineInfo.label}
                              {deadlines.length > 1 ? ` (+${deadlines.length - 1})` : ''}
                            </span>
                            <span className="text-zinc-300" aria-hidden="true">/</span>
                            <span
                              className={
                                task.responsibility === 'Others'
                                  ? 'text-amber-700 font-medium'
                                  : 'text-zinc-600'
                              }
                            >
                              {task.responsibility}
                            </span>
                            <span className="text-zinc-300" aria-hidden="true">/</span>
                            <span className="font-mono text-zinc-500">{task.valueCategory}</span>
                            {taskSteps.length > 0 && (
                              <>
                                <span className="text-zinc-300" aria-hidden="true">/</span>
                                <span className="text-zinc-600 font-mono">
                                  {completedCount}/{taskSteps.length} steps
                                </span>
                              </>
                            )}
                            {scheduledCount > 0 && (
                              <>
                                <span className="text-zinc-300" aria-hidden="true">/</span>
                                <span className="text-zinc-500 font-mono">
                                  {scheduledCount} scheduled
                                </span>
                              </>
                            )}
                          </div>

                          {taskSteps.length > 0 && (
                            <div className="mt-2.5 pl-5">
                              <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full transition-all duration-150"
                                  style={{
                                    width: `${progressPct}%`,
                                    backgroundColor: swatch.swatch,
                                  }}
                                />
                              </div>
                            </div>
                          )}

                          {isExpanded && taskSteps.length > 0 && (
                            <div className="mt-3 pl-5 pt-2.5 border-t border-zinc-100 space-y-1.5">
                              {taskSteps.map((step, idx) => (
                                <div key={step.id} className="flex items-start gap-2 text-xs py-0.5">
                                  <div className="mt-0.5">
                                    <StepExecutionControl
                                      executionState={step.executionState}
                                      stepTitle={step.title}
                                      varianceReason={step.varianceReason}
                                      onChangeState={(nextState, reason) =>
                                        setStepExecutionState(step.id, nextState, reason)
                                      }
                                    />
                                  </div>
                                  <span
                                    className={`font-mono text-[11px] tabular-nums shrink-0 ${
                                      step.completed ? 'text-zinc-400' : 'text-zinc-500'
                                    }`}
                                  >
                                    {String(idx + 1).padStart(2, '0')}
                                  </span>
                                  <span
                                    className={`flex-1 min-w-0 ${
                                      step.completed ? 'line-through text-zinc-400' : 'text-zinc-700'
                                    }`}
                                  >
                                    {step.title}
                                  </span>
                                  <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                                    {step.responsibility} · {step.valueCategory}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="mt-3 pl-5 pt-2 border-t border-zinc-100 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {taskSteps.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(task.id)}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3 h-3" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3" />
                                  )}
                                  Steps
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openTaskInWBS(task.id)}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
                              >
                                <Layers className="w-3 h-3" />
                                WBS
                              </button>
                            </div>

                            <div className="flex items-center gap-1">
                              <label className="sr-only" htmlFor={`kanban-status-${task.id}`}>
                                Move {task.name} status
                              </label>
                              <ArrowRight className="w-3 h-3 text-zinc-300" aria-hidden="true" />
                              <select
                                id={`kanban-status-${task.id}`}
                                value={task.status}
                                onChange={(e) =>
                                  updateTask(task.id, { status: e.target.value as TaskStatus })
                                }
                                className="text-[11px] font-medium text-zinc-600 bg-transparent hover:text-zinc-900 focus:outline-none cursor-pointer"
                              >
                                <option value="todo">To Do</option>
                                <option value="in_progress">In Progress</option>
                                <option value="completed">Completed</option>
                              </select>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(taskToDelete)}
        title="Delete Objective?"
        message={
          taskToDelete
            ? `Delete "${taskToDelete.name}"? This will also permanently remove ${deleteStepCount} WBS step${
                deleteStepCount === 1 ? '' : 's'
              } and ${deleteBlockCount} scheduled calendar block${deleteBlockCount === 1 ? '' : 's'}.`
            : ''
        }
        confirmLabel="Delete Objective"
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
