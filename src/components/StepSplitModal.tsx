import React, { useEffect, useState } from 'react';
import { Scissors, X } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { useLanguage } from '../i18n/LanguageContext';
import { WBSStep } from '../types';
import { formatDuration } from '../utils/dateUtils';

interface StepSplitModalProps {
  step: WBSStep | null;
  taskName?: string;
  onClose: () => void;
}

const DURATION_OPTIONS = [
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 90, label: '1h 30m' },
  { value: 120, label: '2h' },
  { value: 180, label: '3h' },
  { value: 240, label: '4h' },
];

export const StepSplitModal: React.FC<StepSplitModalProps> = ({
  step,
  taskName,
  onClose,
}) => {
  const { splitStepIntoTwo } = useAppState();
  const { t } = useLanguage();

  const [part1Title, setPart1Title] = useState('');
  const [part1Minutes, setPart1Minutes] = useState(30);
  const [part2Title, setPart2Title] = useState('');
  const [part2Minutes, setPart2Minutes] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!step) return;
    const total = Math.max(60, step.estimatedMinutes);
    const half1 = Math.max(30, Math.floor(total / 60) * 30);
    const half2 = Math.max(30, total - half1);
    setPart1Title(t.splitModal.defaultPart1(step.title));
    setPart2Title(t.splitModal.defaultPart2(step.title));
    setPart1Minutes(half1);
    setPart2Minutes(half2);
    setError(null);
  }, [step, t]);

  useEffect(() => {
    if (!step) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step, onClose]);

  if (!step) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!part1Title.trim() || !part2Title.trim()) {
      setError(t.splitModal.errMissingTitles);
      return;
    }
    splitStepIntoTwo({
      stepId: step.id,
      part1Title: part1Title.trim(),
      part1Minutes,
      part2Title: part2Title.trim(),
      part2Minutes,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-step-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white border border-zinc-200 rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-200">
          <div>
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-zinc-700" />
              <h2 id="split-step-title" className="text-base font-semibold text-zinc-900">
                {t.splitModal.title}
              </h2>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {taskName ? `${taskName} · ` : ''}
              {t.splitModal.subtitlePrefix}{' '}
              <span className="font-mono tabular-nums text-zinc-700">
                {formatDuration(step.estimatedMinutes)}
              </span>
              . {t.splitModal.subtitleSuffix}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md"
            aria-label={t.common.closeModal}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-3 items-end">
            <div>
              <label htmlFor="split-p1-title" className="block text-xs font-medium text-zinc-700 mb-1">
                {t.splitModal.part1Label}
              </label>
              <input
                id="split-p1-title"
                type="text"
                value={part1Title}
                onChange={(e) => setPart1Title(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 text-sm text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
              />
            </div>
            <div>
              <label htmlFor="split-p1-dur" className="block text-xs font-medium text-zinc-700 mb-1">
                {t.splitModal.durationLabel}
              </label>
              <select
                id="split-p1-dur"
                value={part1Minutes}
                onChange={(e) => setPart1Minutes(Number(e.target.value))}
                className="w-full px-2.5 py-2 text-sm font-mono text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-3 items-end">
            <div>
              <label htmlFor="split-p2-title" className="block text-xs font-medium text-zinc-700 mb-1">
                {t.splitModal.part2Label}
              </label>
              <input
                id="split-p2-title"
                type="text"
                value={part2Title}
                onChange={(e) => setPart2Title(e.target.value)}
                className="w-full px-3 py-2 text-sm text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
              />
            </div>
            <div>
              <label htmlFor="split-p2-dur" className="block text-xs font-medium text-zinc-700 mb-1">
                {t.splitModal.durationLabel}
              </label>
              <select
                id="split-p2-dur"
                value={part2Minutes}
                onChange={(e) => setPart2Minutes(Number(e.target.value))}
                className="w-full px-2.5 py-2 text-sm font-mono text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 whitespace-nowrap shrink-0"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              {t.splitModal.submitBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
