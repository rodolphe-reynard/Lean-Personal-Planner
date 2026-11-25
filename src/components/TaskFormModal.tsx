import React, { useEffect, useState } from 'react';
import { Calendar, Plus, Trash2, X } from 'lucide-react';
import { Responsibility, Task, TaskDeadline, TaskStatus, ValueCategory } from '../types';
import { PASTEL_PALETTE, getSwatchLabel, pickNextAvailableColorId } from '../utils/colors';
import { useAppState } from '../context/AppStateContext';
import { getPrimaryDeadline, getTaskDeadlines, isValidDateString } from '../utils/dateUtils';
import { useLanguage } from '../i18n/LanguageContext';

interface TaskFormModalProps {
  isOpen: boolean;
  editingTask: Task | null;
  defaultStatus?: TaskStatus;
  onClose: () => void;
}

export const TaskFormModal: React.FC<TaskFormModalProps> = ({
  isOpen,
  editingTask,
  defaultStatus = 'todo',
  onClose,
}) => {
  const { tasks, todayStr, createTask, updateTask } = useAppState();
  const { t, language } = useLanguage();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deadlines, setDeadlines] = useState<TaskDeadline[]>([]);
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [responsibility, setResponsibility] = useState<Responsibility>('Me');
  const [valueCategory, setValueCategory] = useState<ValueCategory>('VA');
  const [colorId, setColorId] = useState(PASTEL_PALETTE[0].id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description);
      const list = getTaskDeadlines(editingTask);
      setDeadlines(
        list.length > 0
          ? list.map((d) => ({ ...d }))
          : [
              {
                id: `dl-${Date.now()}`,
                date: editingTask.deadline || todayStr,
                label: t.taskModal.defaultTargetLabel,
              },
            ]
      );
      setStatus(editingTask.status);
      setResponsibility(editingTask.responsibility);
      setValueCategory(editingTask.valueCategory);
      setColorId(editingTask.colorId);
    } else {
      setName('');
      setDescription('');
      setDeadlines([
        { id: `dl-${Date.now()}`, date: todayStr, label: t.taskModal.defaultTargetLabel },
      ]);
      setStatus(defaultStatus);
      setResponsibility('Me');
      setValueCategory('VA');
      setColorId(pickNextAvailableColorId(tasks.map((t) => t.colorId)));
    }
    setError(null);
  }, [isOpen, editingTask, defaultStatus, todayStr, tasks, t.taskModal.defaultTargetLabel]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAddDeadline = () => {
    if (deadlines.length >= 25) return;
    const lastDate = deadlines[deadlines.length - 1]?.date || todayStr;
    setDeadlines((prev) => [
      ...prev,
      {
        id: `dl-${Date.now()}-${prev.length + 1}`,
        date: lastDate,
        label: t.taskModal.defaultMilestoneLabel(prev.length + 1),
      },
    ]);
  };

  const handleUpdateDeadline = (id: string, patch: Partial<TaskDeadline>) => {
    setDeadlines((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const handleRemoveDeadline = (id: string) => {
    if (deadlines.length <= 1) return;
    setDeadlines((prev) => prev.filter((d) => d.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t.taskModal.errNoName);
      return;
    }
    if (deadlines.length === 0 || deadlines.some((d) => !isValidDateString(d.date))) {
      setError(t.taskModal.errInvalidDate);
      return;
    }

    const cleanedDeadlines = deadlines
      .map((d) => ({
        id: d.id,
        date: d.date,
        label: d.label?.trim() || undefined,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const primaryDeadline = getPrimaryDeadline(cleanedDeadlines, todayStr);

    if (editingTask) {
      updateTask(editingTask.id, {
        name: trimmed,
        description,
        deadline: primaryDeadline,
        deadlines: cleanedDeadlines,
        status,
        responsibility,
        valueCategory,
        colorId,
      });
    } else {
      createTask({
        name: trimmed,
        description,
        deadline: primaryDeadline,
        deadlines: cleanedDeadlines,
        status,
        responsibility,
        valueCategory,
        colorId,
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-form-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col bg-white border border-zinc-200 rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 flex items-center justify-between gap-4 border-b border-zinc-200 shrink-0">
          <h2 id="task-form-title" className="text-base font-semibold text-zinc-900">
            {editingTask ? t.taskModal.editTitle : t.taskModal.newTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-zinc-900"
            aria-label={t.common.closeModal}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="task-name" className="block text-xs font-medium text-zinc-700 mb-1.5">
              {t.taskModal.nameLabel}
            </label>
            <input
              id="task-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.taskModal.namePlaceholder}
              autoFocus
              className="w-full px-3 py-2 text-sm text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
            />
          </div>

          <div>
            <label htmlFor="task-description" className="block text-xs font-medium text-zinc-700 mb-1.5">
              {t.taskModal.descLabel}
            </label>
            <textarea
              id="task-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.taskModal.descPlaceholder}
              className="w-full px-3 py-2 text-sm text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900 resize-none"
            />
          </div>

          {/* Multiple Deadlines Editor */}
          <div className="border border-zinc-200 rounded-md p-3 bg-zinc-50/70 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-800 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                {t.taskModal.deadlinesHeading(deadlines.length)}
              </span>
              <button
                type="button"
                onClick={handleAddDeadline}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-800 hover:text-zinc-950 bg-white border border-zinc-300 px-2 py-1 rounded"
              >
                <Plus className="w-3 h-3" />
                {t.taskModal.addDeadline}
              </button>
            </div>

            <div className="space-y-2 max-h-40 overflow-y-auto pr-0.5">
              {deadlines.map((dl, idx) => (
                <div key={dl.id} className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dl.date}
                    aria-label={t.taskModal.milestoneDateAria(idx + 1)}
                    onChange={(e) => handleUpdateDeadline(dl.id, { date: e.target.value })}
                    className="w-36 px-2.5 py-1.5 text-xs font-mono tabular-nums text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                  />
                  <input
                    type="text"
                    value={dl.label ?? ''}
                    maxLength={48}
                    placeholder={
                      idx === 0
                        ? t.taskModal.milestoneFirstPlaceholder
                        : t.taskModal.milestonePlaceholder
                    }
                    aria-label={t.taskModal.milestoneLabelAria(idx + 1)}
                    onChange={(e) => handleUpdateDeadline(dl.id, { label: e.target.value })}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
                  />
                  {deadlines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDeadline(dl.id)}
                      title={t.taskModal.removeMilestoneTitle}
                      aria-label={t.taskModal.removeMilestoneAria(idx + 1)}
                      className="p-1.5 text-zinc-400 hover:text-red-600 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">
              {t.taskModal.deadlinesHint}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="task-status" className="block text-xs font-medium text-zinc-700 mb-1.5">
                {t.taskModal.statusLabel}
              </label>
              <select
                id="task-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full px-3 py-2 text-sm text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
              >
                <option value="todo">{t.common.status.todo}</option>
                <option value="in_progress">{t.common.status.in_progress}</option>
                <option value="completed">{t.common.status.completed}</option>
              </select>
            </div>

            <div>
              <label htmlFor="task-value-category" className="block text-xs font-medium text-zinc-700 mb-1.5">
                {t.taskModal.leanLabel}
              </label>
              <select
                id="task-value-category"
                value={valueCategory}
                onChange={(e) => setValueCategory(e.target.value as ValueCategory)}
                className="w-full px-3 py-2 text-sm text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
              >
                <option value="VA">{t.taskModal.vaOption}</option>
                <option value="NNVA">{t.taskModal.nnvaOption}</option>
                <option value="NVA">{t.taskModal.nvaOption}</option>
              </select>
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-zinc-700 mb-1.5">
              {t.taskModal.respLabel}
            </span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-100 rounded-md border border-zinc-200 max-w-xs">
              {(['Me', 'Others'] as Responsibility[]).map((owner) => (
                <button
                  key={owner}
                  type="button"
                  onClick={() => setResponsibility(owner)}
                  className={`py-1.5 text-xs font-medium rounded transition-colors ${
                    responsibility === owner
                      ? 'bg-white text-zinc-900 shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {t.common.responsibility[owner]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-zinc-700 mb-2">
              {t.taskModal.colorLabel}
            </span>
            <div className="flex flex-wrap gap-2">
              {PASTEL_PALETTE.map((swatch) => {
                const selected = swatch.id === colorId;
                const swatchLabel = getSwatchLabel(swatch, language);
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    onClick={() => setColorId(swatch.id)}
                    title={swatchLabel}
                    aria-label={t.taskModal.colorAria(swatchLabel)}
                    aria-pressed={selected}
                    className={`w-7 h-7 rounded-md border transition-transform flex items-center justify-center focus-visible:outline-2 focus-visible:outline-zinc-900 ${
                      selected ? 'ring-2 ring-zinc-900 ring-offset-1 scale-105' : 'hover:scale-105'
                    }`}
                    style={{
                      backgroundColor: swatch.bg,
                      borderColor: swatch.border,
                    }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: swatch.swatch }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors whitespace-nowrap shrink-0"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              {editingTask ? t.taskModal.saveChanges : t.taskModal.createObjective}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
