import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  GripVertical,
  Link2,
  Pencil,
  Play,
  Plus,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { Responsibility, Task, ValueCategory, WBSStep } from '../types';
import { getTaskSwatch } from '../utils/colors';
import {
  formatCompactDate,
  formatDuration,
  formatMinutesToTime,
  formatRelativeDeadline,
  formatShortDate,
  getTaskDeadlines,
} from '../utils/dateUtils';
import { hasDependencyCycle } from '../utils/schedulingUtils';
import { ConfirmModal } from './ConfirmModal';
import { StepExecutionControl } from './StepExecutionControl';
import { StepSplitModal } from './StepSplitModal';

interface WBSTabProps {
  onNewTask: () => void;
  onEditTask: (task: Task) => void;
}

const DURATION_OPTIONS = [
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 90, label: '1h 30m' },
  { value: 120, label: '2h' },
  { value: 180, label: '3h' },
  { value: 240, label: '4h' },
];

export const WBSTab: React.FC<WBSTabProps> = ({ onNewTask, onEditTask }) => {
  const {
    tasks,
    steps,
    scheduledBlocks,
    todayStr,
    selectedWbsTaskId,
    setSelectedWbsTaskId,
    createStep,
    updateStep,
    setStepExecutionState,
    toggleStepInProgress,
    deleteStepCascade,
    reorderTaskSteps,
    updateTask,
  } = useAppState();

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [tasks]
  );

  useEffect(() => {
    if (sortedTasks.length === 0) {
      if (selectedWbsTaskId !== null) setSelectedWbsTaskId(null);
      return;
    }
    if (!selectedWbsTaskId || !sortedTasks.some((t) => t.id === selectedWbsTaskId)) {
      setSelectedWbsTaskId(sortedTasks[0].id);
    }
  }, [sortedTasks, selectedWbsTaskId, setSelectedWbsTaskId]);

  const selectedTask = useMemo(
    () => sortedTasks.find((t) => t.id === selectedWbsTaskId) ?? null,
    [sortedTasks, selectedWbsTaskId]
  );

  const stepCountsByTask = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const s of steps) {
      const cur = map.get(s.taskId) ?? { total: 0, done: 0 };
      cur.total += 1;
      if (s.completed) cur.done += 1;
      map.set(s.taskId, cur);
    }
    return map;
  }, [steps]);

  const taskSteps = useMemo(() => {
    if (!selectedTask) return [];
    return steps
      .filter((s) => s.taskId === selectedTask.id)
      .sort((a, b) => a.order - b.order);
  }, [steps, selectedTask]);

  const stepIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    taskSteps.forEach((s, idx) => map.set(s.id, idx));
    return map;
  }, [taskSteps]);

  const stepMap = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);

  const blocksByStep = useMemo(() => {
    const map = new Map<string, typeof scheduledBlocks>();
    for (const b of scheduledBlocks) {
      const arr = map.get(b.stepId) ?? [];
      arr.push(b);
      map.set(b.stepId, arr);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);
    }
    return map;
  }, [scheduledBlocks]);

  const [newStepTitle, setNewStepTitle] = useState('');
  const [newStepMinutes, setNewStepMinutes] = useState(60);
  const [newStepResponsibility, setNewStepResponsibility] = useState<Responsibility>('Me');
  const [newStepValueCat, setNewStepValueCat] = useState<ValueCategory>('VA');
  const [stepInputError, setStepInputError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTask) return;
    setNewStepResponsibility(selectedTask.responsibility);
    setNewStepValueCat(selectedTask.valueCategory);
    setSequenceError(null);
  }, [selectedTask?.id, selectedTask?.responsibility, selectedTask?.valueCategory]);

  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [depPickerStepId, setDepPickerStepId] = useState<string | null>(null);
  const [sequenceError, setSequenceError] = useState<string | null>(null);
  const [splitTargetStep, setSplitTargetStep] = useState<WBSStep | null>(null);

  const [dragStepId, setDragStepId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ stepId: string; position: 'before' | 'after' } | null>(
    null
  );
  const [stepToDelete, setStepToDelete] = useState<WBSStep | null>(null);

  const validateProposedOrder = (orderedIds: string[]): string | null => {
    const pos = new Map<string, number>();
    orderedIds.forEach((id, i) => pos.set(id, i));
    for (const id of orderedIds) {
      const s = stepMap.get(id);
      if (!s) continue;
      for (const predId of s.dependsOnStepIds) {
        const predPos = pos.get(predId);
        const curPos = pos.get(id)!;
        if (predPos !== undefined && predPos > curPos) {
          const pred = stepMap.get(predId);
          return `Order locked: "${s.title}" depends on "${pred?.title ?? 'predecessor'}" and must remain after it in sequence.`;
        }
      }
    }
    return null;
  };

  const handleAddStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    const trimmed = newStepTitle.trim();
    if (!trimmed) {
      setStepInputError('Enter a step title before adding.');
      return;
    }
    createStep({
      taskId: selectedTask.id,
      title: trimmed,
      estimatedMinutes: newStepMinutes,
      responsibility: newStepResponsibility,
      valueCategory: newStepValueCat,
    });
    setNewStepTitle('');
    setStepInputError(null);
  };

  const startEditingStep = (step: WBSStep) => {
    setEditingStepId(step.id);
    setEditTitle(step.title);
    setEditNotes(step.notes);
  };

  const saveEditingStep = (stepId: string) => {
    const trimmed = editTitle.trim();
    if (!trimmed) return;
    updateStep(stepId, { title: trimmed, notes: editNotes });
    setEditingStepId(null);
  };

  const moveStepByOffset = (stepId: string, delta: -1 | 1) => {
    if (!selectedTask) return;
    const ids = taskSteps.map((s) => s.id);
    const idx = ids.indexOf(stepId);
    const targetIdx = idx + delta;
    if (idx === -1 || targetIdx < 0 || targetIdx >= ids.length) return;
    const next = [...ids];
    const [removed] = next.splice(idx, 1);
    next.splice(targetIdx, 0, removed);
    const err = validateProposedOrder(next);
    if (err) {
      setSequenceError(err);
      return;
    }
    setSequenceError(null);
    reorderTaskSteps(selectedTask.id, next);
  };

  const handleStepDrop = (targetStepId: string, position: 'before' | 'after') => {
    if (!selectedTask || !dragStepId || dragStepId === targetStepId) {
      setDragStepId(null);
      setDropTarget(null);
      return;
    }
    const ids = taskSteps.map((s) => s.id).filter((id) => id !== dragStepId);
    const targetIdx = ids.indexOf(targetStepId);
    if (targetIdx === -1) return;
    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
    ids.splice(insertIdx, 0, dragStepId);

    const err = validateProposedOrder(ids);
    if (err) {
      setSequenceError(err);
      setDragStepId(null);
      setDropTarget(null);
      return;
    }
    setSequenceError(null);
    reorderTaskSteps(selectedTask.id, ids);
    setDragStepId(null);
    setDropTarget(null);
  };

  const handleToggleDependency = (step: WBSStep, predStepId: string) => {
    if (!selectedTask) return;
    const exists = step.dependsOnStepIds.includes(predStepId);
    if (exists) {
      updateStep(step.id, {
        dependsOnStepIds: step.dependsOnStepIds.filter((d) => d !== predStepId),
      });
      setSequenceError(null);
      return;
    }

    if (hasDependencyCycle(steps, step.id, predStepId)) {
      setSequenceError('Cannot add dependency: circular dependency detected.');
      return;
    }

    const nextDeps = [...step.dependsOnStepIds, predStepId];
    updateStep(step.id, { dependsOnStepIds: nextDeps });

    const stepPos = stepIndexMap.get(step.id) ?? 0;
    const predPos = stepIndexMap.get(predStepId) ?? 0;
    if (predPos > stepPos) {
      const ids = taskSteps.map((s) => s.id).filter((id) => id !== step.id);
      const newPredIdx = ids.indexOf(predStepId);
      ids.splice(newPredIdx + 1, 0, step.id);
      reorderTaskSteps(selectedTask.id, ids);
    }
    setSequenceError(null);
  };

  const handleRequestDeleteStep = (step: WBSStep) => {
    const linkedBlocks = blocksByStep.get(step.id) ?? [];
    if (linkedBlocks.length > 0) {
      setStepToDelete(step);
    } else {
      deleteStepCascade(step.id);
    }
  };

  const totalPlannedMinutes = taskSteps.reduce((acc, s) => acc + s.estimatedMinutes, 0);
  const completedStepsCount = taskSteps.filter((s) => s.completed).length;
  const allStepsDone = taskSteps.length > 0 && completedStepsCount === taskSteps.length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Work Breakdown Structure &amp; Phase Sequencing
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Enforce step order, link predecessor dependencies, toggle In Progress flow status, and assign Me / Others responsibilities per step.
          </p>
        </div>
        <button
          type="button"
          onClick={onNewTask}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          New Objective
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-8 bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <h2 className="text-base font-semibold text-zinc-900">No objectives available</h2>
          <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
            Create an objective in the Master Schedule (or right here) to break it down into sequential WBS steps.
          </p>
          <button
            type="button"
            onClick={onNewTask}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create First Objective
          </button>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-6 flex-1 min-h-0 items-start">
          <aside className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50/80 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-700">Master Schedule Objectives</h2>
              <span className="text-xs font-mono tabular-nums text-zinc-500">
                {sortedTasks.length}
              </span>
            </div>
            <div className="divide-y divide-zinc-200/80 max-h-[640px] overflow-y-auto">
              {sortedTasks.map((task) => {
                const swatch = getTaskSwatch(task.colorId);
                const isSelected = task.id === selectedTask?.id;
                const counts = stepCountsByTask.get(task.id) ?? { total: 0, done: 0 };
                const deadlineInfo = formatRelativeDeadline(task.deadline, todayStr, task.status);

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => {
                      setSelectedWbsTaskId(task.id);
                      setEditingStepId(null);
                      setDepPickerStepId(null);
                      setStepInputError(null);
                      setSequenceError(null);
                    }}
                    className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-2.5 ${
                      isSelected ? 'bg-zinc-100' : 'hover:bg-zinc-50'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-sm border shrink-0 mt-1"
                      style={{
                        backgroundColor: swatch.bg,
                        borderColor: swatch.swatch,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm font-medium leading-snug truncate ${
                          task.status === 'completed' ? 'line-through text-zinc-500' : 'text-zinc-900'
                        }`}
                      >
                        {task.name}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums">
                        <span
                          className={
                            deadlineInfo.isOverdue
                              ? 'text-red-700 font-medium'
                              : 'text-zinc-500'
                          }
                        >
                          {formatShortDate(task.deadline)}
                        </span>
                        <span className="text-zinc-300" aria-hidden="true">·</span>
                        <span className="font-mono text-zinc-600">
                          {counts.done}/{counts.total} steps
                        </span>
                        <span className="text-zinc-300" aria-hidden="true">·</span>
                        <span
                          className={
                            task.responsibility === 'Others' ? 'text-amber-700' : 'text-zinc-500'
                          }
                        >
                          {task.responsibility}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {selectedTask && (
            <section className="bg-white border border-zinc-200 rounded-lg p-6">
              {(() => {
                const swatch = getTaskSwatch(selectedTask.colorId);
                const deadlines = getTaskDeadlines(selectedTask);
                const deadlineInfo = formatRelativeDeadline(
                  selectedTask.deadline,
                  todayStr,
                  selectedTask.status
                );
                return (
                  <div className="pb-5 border-b border-zinc-200">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className="w-4 h-4 rounded border shrink-0 mt-1"
                          style={{
                            backgroundColor: swatch.bg,
                            borderColor: swatch.swatch,
                          }}
                        />
                        <div className="min-w-0">
                          <h2 className="text-lg font-semibold text-zinc-900 leading-snug">
                            {selectedTask.name}
                          </h2>
                          {selectedTask.description && (
                            <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-2xl">
                              {selectedTask.description}
                            </p>
                          )}
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs tabular-nums text-zinc-500">
                            <span
                              className={
                                deadlineInfo.isOverdue ? 'font-medium text-red-700' : ''
                              }
                            >
                              {deadlines.length > 1
                                ? `Deadlines: ${deadlines
                                    .map((d) =>
                                      `${d.label ? `${d.label} ` : ''}${formatCompactDate(d.date)}`
                                    )
                                    .join(', ')}`
                                : `Deadline: ${formatShortDate(selectedTask.deadline)} (${deadlineInfo.label})`}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              Default owner:{' '}
                              <strong className="font-medium text-zinc-800">
                                {selectedTask.responsibility}
                              </strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-zinc-700">
                              {completedStepsCount}/{taskSteps.length} completed
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-zinc-700">
                              {formatDuration(totalPlannedMinutes)} estimated
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {allStepsDone && selectedTask.status !== 'completed' && (
                          <button
                            type="button"
                            onClick={() => updateTask(selectedTask.id, { status: 'completed' })}
                            className="px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                          >
                            Mark Objective Completed
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onEditTask(selectedTask)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit Objective
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Inline Add Step Form */}
              <form onSubmit={handleAddStep} className="mt-5">
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    type="text"
                    value={newStepTitle}
                    onChange={(e) => {
                      setNewStepTitle(e.target.value);
                      if (stepInputError) setStepInputError(null);
                    }}
                    placeholder="Add next actionable step in sequence..."
                    aria-label="New WBS step title"
                    className="flex-1 min-w-[200px] px-3 py-2 text-sm text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                  />
                  <select
                    value={newStepMinutes}
                    onChange={(e) => setNewStepMinutes(Number(e.target.value))}
                    aria-label="Estimated step duration"
                    className="px-2.5 py-2 text-xs font-mono text-zinc-800 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                  >
                    {DURATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newStepResponsibility}
                    onChange={(e) => setNewStepResponsibility(e.target.value as Responsibility)}
                    aria-label="Step responsibility"
                    className="px-2.5 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                  >
                    <option value="Me">Me</option>
                    <option value="Others">Others</option>
                  </select>
                  <select
                    value={newStepValueCat}
                    onChange={(e) => setNewStepValueCat(e.target.value as ValueCategory)}
                    aria-label="Step Lean value classification"
                    className="px-2.5 py-2 text-xs font-mono text-zinc-800 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                  >
                    <option value="VA">VA</option>
                    <option value="NNVA">NNVA</option>
                    <option value="NVA">NVA</option>
                  </select>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Step
                  </button>
                </div>
                {stepInputError && (
                  <p className="mt-1.5 text-xs text-red-700">{stepInputError}</p>
                )}
              </form>

              {sequenceError && (
                <div className="mt-4 px-3.5 py-2.5 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-md flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                    {sequenceError}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSequenceError(null)}
                    className="p-0.5 text-amber-700 hover:text-amber-950"
                    aria-label="Dismiss warning"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="mt-6">
                {taskSteps.length === 0 ? (
                  <div className="py-10 px-6 border border-dashed border-zinc-300 rounded-md text-center">
                    <p className="text-sm font-medium text-zinc-700">No steps defined yet</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Add your first actionable step above to build the execution sequence for this objective.
                    </p>
                  </div>
                ) : (
                  <div className="relative">
                    {taskSteps.length > 1 && (
                      <div
                        aria-hidden="true"
                        className="absolute left-[29px] top-6 bottom-6 w-px bg-zinc-200 pointer-events-none"
                      />
                    )}

                    <ol className="space-y-2.5">
                      {taskSteps.map((step, index) => {
                        const swatch = getTaskSwatch(selectedTask.colorId);
                        const linkedBlocks = blocksByStep.get(step.id) ?? [];
                        const isDragging = dragStepId === step.id;
                        const isDropBefore =
                          dropTarget?.stepId === step.id && dropTarget.position === 'before';
                        const isDropAfter =
                          dropTarget?.stepId === step.id && dropTarget.position === 'after';
                        const isEditing = editingStepId === step.id;
                        const isDepPickerOpen = depPickerStepId === step.id;

                        const resolvedDeps = step.dependsOnStepIds
                          .map((id) => ({
                            id,
                            step: stepMap.get(id),
                            seqIdx: stepIndexMap.get(id),
                          }))
                          .filter((d) => Boolean(d.step));

                        const incompletePredCount = resolvedDeps.filter(
                          (d) => d.step && !d.step.completed
                        ).length;

                        return (
                          <li
                            key={step.id}
                            draggable={!isEditing}
                            onDragStart={(e) => {
                              if (isEditing) return;
                              setDragStepId(step.id);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', step.id);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (!dragStepId || dragStepId === step.id) return;
                              const rect = e.currentTarget.getBoundingClientRect();
                              const pos =
                                e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                              if (
                                dropTarget?.stepId !== step.id ||
                                dropTarget?.position !== pos
                              ) {
                                setDropTarget({ stepId: step.id, position: pos });
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const pos =
                                e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                              handleStepDrop(step.id, pos);
                            }}
                            onDragEnd={() => {
                              setDragStepId(null);
                              setDropTarget(null);
                            }}
                            className={`relative p-3 rounded-md border transition-colors ${
                              isDragging
                                ? 'opacity-40 bg-zinc-50 border-zinc-300'
                                : 'bg-white border-zinc-200 hover:border-zinc-300'
                            } ${isDropBefore ? 'border-t-2 border-t-zinc-900' : ''} ${
                              isDropAfter ? 'border-b-2 border-b-zinc-900' : ''
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className="relative z-10 w-8 h-8 rounded-md border flex items-center justify-center font-mono text-xs font-semibold tabular-nums shrink-0 mt-0.5"
                                style={{
                                  backgroundColor: step.completed ? '#f4f4f5' : swatch.bg,
                                  borderColor: step.completed ? '#d4d4d8' : swatch.border,
                                  color: step.completed ? '#71717a' : swatch.text,
                                }}
                                title={`Phase Step ${index + 1}`}
                              >
                                {String(index + 1).padStart(2, '0')}
                              </div>

                              <div
                                className="mt-2 text-zinc-300 hover:text-zinc-600 cursor-grab active:cursor-grabbing shrink-0"
                                title="Drag to reorder step"
                              >
                                <GripVertical className="w-4 h-4" />
                              </div>

                              {/* 3-State Execution Control */}
                              <div className="mt-2">
                                <StepExecutionControl
                                  executionState={step.executionState}
                                  stepTitle={step.title}
                                  varianceReason={step.varianceReason}
                                  onChangeState={(nextState, reason) =>
                                    setStepExecutionState(step.id, nextState, reason)
                                  }
                                />
                              </div>

                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <input
                                      type="text"
                                      value={editTitle}
                                      onChange={(e) => setEditTitle(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveEditingStep(step.id);
                                        if (e.key === 'Escape') setEditingStepId(null);
                                      }}
                                      autoFocus
                                      className="w-full px-2.5 py-1.5 text-sm text-zinc-900 bg-white border border-zinc-400 rounded focus:outline-none focus:border-zinc-900"
                                    />
                                    <input
                                      type="text"
                                      value={editNotes}
                                      onChange={(e) => setEditNotes(e.target.value)}
                                      placeholder="Optional step notes..."
                                      className="w-full px-2.5 py-1 text-xs text-zinc-700 bg-white border border-zinc-300 rounded focus:outline-none focus:border-zinc-900"
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => saveEditingStep(step.id)}
                                        className="px-2.5 py-1 text-xs font-medium text-white bg-zinc-900 rounded hover:bg-zinc-800"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingStepId(null)}
                                        className="px-2.5 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-900"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div
                                      className={`text-sm font-medium leading-snug ${
                                        step.completed ? 'line-through text-zinc-400' : 'text-zinc-900'
                                      }`}
                                    >
                                      {step.title}
                                    </div>
                                    {step.notes && (
                                      <p className="text-xs text-zinc-500 mt-0.5">{step.notes}</p>
                                    )}
                                    {step.executionState === 'done_variance' && step.varianceReason && (
                                      <p className="text-[11px] text-amber-800 mt-0.5">
                                        Variance: {step.varianceReason}
                                      </p>
                                    )}
                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] tabular-nums">
                                      <span className="font-mono text-zinc-500">
                                        Est. {formatDuration(step.estimatedMinutes)}
                                      </span>
                                      <span className="text-zinc-300" aria-hidden="true">·</span>
                                      {linkedBlocks.length === 0 ? (
                                        <span className="text-zinc-400">Unscheduled</span>
                                      ) : linkedBlocks.length === 1 ? (
                                        <span className="font-medium text-zinc-700 font-mono">
                                          Scheduled · {formatShortDate(linkedBlocks[0].date)}{' '}
                                          {formatMinutesToTime(linkedBlocks[0].startMinutes)}
                                        </span>
                                      ) : (
                                        <span className="font-medium text-zinc-700 font-mono">
                                          Scheduled · {linkedBlocks.length} sessions
                                        </span>
                                      )}
                                      {resolvedDeps.length > 0 && (
                                        <>
                                          <span className="text-zinc-300" aria-hidden="true">·</span>
                                          <span
                                            className={
                                              incompletePredCount > 0
                                                ? 'text-amber-700 font-medium'
                                                : 'text-zinc-500'
                                            }
                                          >
                                            After:{' '}
                                            {resolvedDeps
                                              .map((d) =>
                                                d.seqIdx !== undefined
                                                  ? `#${String(d.seqIdx + 1).padStart(2, '0')} (${d.step!.title})`
                                                  : d.step!.title
                                              )
                                              .join(', ')}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>

                              {!isEditing && (
                                <div className="flex flex-wrap items-center justify-end gap-1 shrink-0 mt-0.5">
                                  {/* Manual Flow Status Toggle (Not Started <-> In Progress) for CFD */}
                                  {!step.completed && (
                                    <button
                                      type="button"
                                      onClick={() => toggleStepInProgress(step.id)}
                                      title={
                                        step.flowStatus === 'in_progress'
                                          ? 'In Progress (click to revert to Not Started)'
                                          : 'Not Started (click to mark In Progress for CFD)'
                                      }
                                      className={`inline-flex items-center gap-1 px-1.5 py-1 text-[10px] font-mono border rounded transition-colors ${
                                        step.flowStatus === 'in_progress'
                                          ? 'bg-sky-50 border-sky-300 text-sky-800 font-semibold'
                                          : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-400'
                                      }`}
                                    >
                                      <Play className="w-2.5 h-2.5" />
                                      {step.flowStatus === 'in_progress' ? 'WIP' : 'Start'}
                                    </button>
                                  )}

                                  <select
                                    value={step.responsibility}
                                    aria-label={`Owner for ${step.title}`}
                                    onChange={(e) =>
                                      updateStep(step.id, {
                                        responsibility: e.target.value as Responsibility,
                                      })
                                    }
                                    className={`px-1.5 py-1 text-[11px] font-medium border rounded focus:outline-none cursor-pointer ${
                                      step.responsibility === 'Others'
                                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                                        : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:border-zinc-400'
                                    }`}
                                  >
                                    <option value="Me">Me</option>
                                    <option value="Others">Others</option>
                                  </select>

                                  <select
                                    value={step.valueCategory}
                                    aria-label={`Lean value category for ${step.title}`}
                                    onChange={(e) =>
                                      updateStep(step.id, {
                                        valueCategory: e.target.value as ValueCategory,
                                      })
                                    }
                                    className="px-1.5 py-1 text-[11px] font-mono text-zinc-600 bg-zinc-50 border border-zinc-200 rounded hover:border-zinc-400 focus:outline-none cursor-pointer"
                                  >
                                    <option value="VA">VA</option>
                                    <option value="NNVA">NNVA</option>
                                    <option value="NVA">NVA</option>
                                  </select>

                                  <select
                                    value={step.estimatedMinutes}
                                    aria-label={`Duration for ${step.title}`}
                                    onChange={(e) =>
                                      updateStep(step.id, {
                                        estimatedMinutes: Number(e.target.value),
                                      })
                                    }
                                    className="px-1.5 py-1 text-[11px] font-mono text-zinc-600 bg-zinc-50 border border-zinc-200 rounded hover:border-zinc-400 focus:outline-none cursor-pointer"
                                  >
                                    {DURATION_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDepPickerStepId((prev) =>
                                        prev === step.id ? null : step.id
                                      )
                                    }
                                    title="Manage predecessor dependencies"
                                    aria-label={`Dependencies for ${step.title}`}
                                    className={`p-1 rounded transition-colors ${
                                      isDepPickerOpen || step.dependsOnStepIds.length > 0
                                        ? 'text-zinc-900 bg-zinc-100'
                                        : 'text-zinc-400 hover:text-zinc-900'
                                    }`}
                                  >
                                    <Link2 className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setSplitTargetStep(step)}
                                    title="Split into 2 smaller steps"
                                    aria-label={`Split ${step.title}`}
                                    className="p-1 text-zinc-400 hover:text-zinc-900 rounded"
                                  >
                                    <Scissors className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => moveStepByOffset(step.id, -1)}
                                    disabled={index === 0}
                                    title="Move step up"
                                    aria-label="Move step up"
                                    className="p-1 text-zinc-400 hover:text-zinc-900 disabled:opacity-25 disabled:pointer-events-none rounded"
                                  >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveStepByOffset(step.id, 1)}
                                    disabled={index === taskSteps.length - 1}
                                    title="Move step down"
                                    aria-label="Move step down"
                                    className="p-1 text-zinc-400 hover:text-zinc-900 disabled:opacity-25 disabled:pointer-events-none rounded"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEditingStep(step)}
                                    title="Edit step"
                                    aria-label={`Edit ${step.title}`}
                                    className="p-1 text-zinc-400 hover:text-zinc-900 rounded"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRequestDeleteStep(step)}
                                    title="Delete step"
                                    aria-label={`Delete ${step.title}`}
                                    className="p-1 text-zinc-400 hover:text-red-700 rounded"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {isDepPickerOpen && (
                              <div className="mt-3 ml-11 pt-2.5 border-t border-zinc-100">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[11px] font-semibold text-zinc-700">
                                    Predecessor Steps (must finish before this step can be scheduled):
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setDepPickerStepId(null)}
                                    className="text-[11px] text-zinc-500 hover:text-zinc-900"
                                  >
                                    Done
                                  </button>
                                </div>
                                {taskSteps.length <= 1 ? (
                                  <p className="text-[11px] text-zinc-400">
                                    Add more steps to define dependencies between them.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {taskSteps
                                      .filter((cand) => cand.id !== step.id)
                                      .map((cand) => {
                                        const isSelected = step.dependsOnStepIds.includes(cand.id);
                                        const wouldCycle =
                                          !isSelected && hasDependencyCycle(steps, step.id, cand.id);
                                        const candIdx = stepIndexMap.get(cand.id) ?? 0;
                                        return (
                                          <button
                                            key={cand.id}
                                            type="button"
                                            disabled={wouldCycle}
                                            onClick={() => handleToggleDependency(step, cand.id)}
                                            title={
                                              wouldCycle
                                                ? 'Would create a circular dependency'
                                                : `Toggle dependency on ${cand.title}`
                                            }
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded border transition-colors ${
                                              isSelected
                                                ? 'bg-zinc-900 text-white border-zinc-900'
                                                : wouldCycle
                                                ? 'bg-zinc-50 text-zinc-300 border-zinc-200 cursor-not-allowed'
                                                : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500'
                                            }`}
                                          >
                                            <span className="font-mono opacity-75">
                                              #{String(candIdx + 1).padStart(2, '0')}
                                            </span>
                                            <span className="truncate max-w-[180px]">
                                              {cand.title}
                                            </span>
                                          </button>
                                        );
                                      })}
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <StepSplitModal
        step={splitTargetStep}
        taskName={selectedTask?.name}
        onClose={() => setSplitTargetStep(null)}
      />

      <ConfirmModal
        isOpen={Boolean(stepToDelete)}
        title="Delete Scheduled Step?"
        message={
          stepToDelete
            ? `Delete "${stepToDelete.title}"? This step is currently scheduled ${(blocksByStep.get(stepToDelete.id) ?? []).length} time(s) on your Weekly Work Plan, which will also be removed.`
            : ''
        }
        confirmLabel="Delete Step"
        destructive
        onCancel={() => setStepToDelete(null)}
        onConfirm={() => {
          if (stepToDelete) {
            deleteStepCascade(stepToDelete.id);
            setStepToDelete(null);
          }
        }}
      />
    </div>
  );
};
