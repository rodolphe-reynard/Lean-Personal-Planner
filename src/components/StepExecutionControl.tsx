import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Circle } from 'lucide-react';
import { StepExecutionState } from '../types';

interface VarianceModalProps {
  isOpen: boolean;
  stepTitle: string;
  initialReason: string;
  onCancel: () => void;
  onSave: (reason: string) => void;
}

export const VarianceReasonModal: React.FC<VarianceModalProps> = ({
  isOpen,
  stepTitle,
  initialReason,
  onCancel,
  onSave,
}) => {
  const [reason, setReason] = useState(initialReason);

  useEffect(() => {
    if (isOpen) setReason(initialReason);
  }, [isOpen, initialReason]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="variance-modal-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-white border border-zinc-200 rounded-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h2 id="variance-modal-title" className="text-sm font-semibold text-zinc-900">
              Done — Not As Expected
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Record the Reason for Variance for <span className="font-medium text-zinc-800">{stepTitle}</span>.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(reason.trim());
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="step-variance-input" className="block text-xs font-medium text-zinc-700 mb-1">
              Reason for Variance
            </label>
            <textarea
              id="step-variance-input"
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Missing input from contractor, underestimated scope, blocked by prerequisite..."
              className="w-full px-3 py-2 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700"
            >
              Save Completion & Variance
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface StepExecutionControlProps {
  executionState: StepExecutionState;
  stepTitle: string;
  varianceReason?: string;
  compact?: boolean;
  onChangeState: (nextState: StepExecutionState, varianceReason?: string) => void;
}

export const StepExecutionControl: React.FC<StepExecutionControlProps> = ({
  executionState,
  stepTitle,
  varianceReason = '',
  compact = false,
  onChangeState,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [varianceModalOpen, setVarianceModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const titleTooltip =
    executionState === 'done_expected'
      ? 'Done — As Expected (click to change state)'
      : executionState === 'done_variance'
      ? `Done — Not As Expected${varianceReason ? `: ${varianceReason}` : ''} (click to change state)`
      : 'Not Done (click to mark complete)';

  const boxSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const iconSize = compact ? 'w-2 h-2' : 'w-2.5 h-2.5';

  return (
    <>
      <div
        ref={containerRef}
        data-block-action="true"
        data-step-checkbox="true"
        className="relative inline-flex items-center shrink-0"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          title={titleTooltip}
          aria-label={`Execution state for ${stepTitle}: ${executionState}`}
          aria-expanded={menuOpen}
          className={`${boxSize} rounded-sm border flex items-center justify-center transition-colors ${
            executionState === 'done_expected'
              ? 'bg-zinc-900 border-zinc-900 text-white'
              : executionState === 'done_variance'
              ? 'bg-amber-600 border-amber-700 text-white'
              : 'bg-white/90 border-zinc-400 hover:border-zinc-900'
          }`}
        >
          {executionState === 'done_expected' && <Check className={iconSize} />}
          {executionState === 'done_variance' && <AlertTriangle className={iconSize} />}
        </button>

        {menuOpen && (
          <div className="absolute left-0 top-full mt-1 z-50 w-48 bg-white border border-zinc-300 rounded-md shadow-lg py-1 text-left">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onChangeState('not_done');
              }}
              className={`w-full px-2.5 py-1.5 text-[11px] flex items-center gap-2 hover:bg-zinc-100 ${
                executionState === 'not_done' ? 'font-semibold text-zinc-900 bg-zinc-50' : 'text-zinc-700'
              }`}
            >
              <Circle className="w-3 h-3 text-zinc-400 shrink-0" />
              <span>Not Done</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onChangeState('done_expected', '');
              }}
              className={`w-full px-2.5 py-1.5 text-[11px] flex items-center gap-2 hover:bg-zinc-100 ${
                executionState === 'done_expected'
                  ? 'font-semibold text-zinc-900 bg-zinc-50'
                  : 'text-zinc-700'
              }`}
            >
              <Check className="w-3 h-3 text-emerald-700 shrink-0" />
              <span>Done — As Expected</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setVarianceModalOpen(true);
              }}
              className={`w-full px-2.5 py-1.5 text-[11px] flex items-center gap-2 hover:bg-amber-50 ${
                executionState === 'done_variance'
                  ? 'font-semibold text-amber-800 bg-amber-50/70'
                  : 'text-zinc-700'
              }`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
              <span>Done — Not As Expected</span>
            </button>
          </div>
        )}
      </div>

      <VarianceReasonModal
        isOpen={varianceModalOpen}
        stepTitle={stepTitle}
        initialReason={varianceReason}
        onCancel={() => setVarianceModalOpen(false)}
        onSave={(reason) => {
          setVarianceModalOpen(false);
          onChangeState('done_variance', reason);
        }}
      />
    </>
  );
};
