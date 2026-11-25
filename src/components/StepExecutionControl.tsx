import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Circle } from 'lucide-react';
import { StepExecutionState } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

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
  const { t } = useLanguage();
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

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="variance-modal-title"
      data-step-execution-portal="true"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="w-full max-w-md bg-white border border-zinc-200 rounded-lg shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h2 id="variance-modal-title" className="text-sm font-semibold text-zinc-900">
              {t.execution.doneVariance}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {t.execution.varianceDescPrefix}{' '}
              <span className="font-medium text-zinc-800">{stepTitle}</span>.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSave(reason.trim());
          }}
          className="space-y-3"
        >
          <div>
            <label
              htmlFor="step-variance-input"
              className="block text-xs font-medium text-zinc-700 mb-1"
            >
              {t.execution.varianceReasonLabel}
            </label>
            <textarea
              id="step-variance-input"
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.execution.variancePlaceholder}
              className="w-full px-3 py-2 text-xs text-zinc-900 bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-900 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700"
            >
              {t.execution.saveCompletionVariance}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

interface StepExecutionControlProps {
  executionState: StepExecutionState;
  stepTitle: string;
  varianceReason?: string;
  compact?: boolean;
  onChangeState: (nextState: StepExecutionState, varianceReason?: string) => void;
  onOverlayOpenChange?: (isOpen: boolean) => void;
}

export const StepExecutionControl: React.FC<StepExecutionControlProps> = ({
  executionState,
  stepTitle,
  varianceReason = '',
  compact = false,
  onChangeState,
  onOverlayOpenChange,
}) => {
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [varianceModalOpen, setVarianceModalOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    openUpwards: boolean;
  }>({ top: 0, left: 0, openUpwards: false });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onOverlayOpenChangeRef = useRef(onOverlayOpenChange);
  onOverlayOpenChangeRef.current = onOverlayOpenChange;
  const wasOverlayOpenRef = useRef(false);

  const isOverlayOpen = menuOpen || varianceModalOpen;

  useEffect(() => {
    if (wasOverlayOpenRef.current !== isOverlayOpen) {
      wasOverlayOpenRef.current = isOverlayOpen;
      onOverlayOpenChangeRef.current?.(isOverlayOpen);
    }
  }, [isOverlayOpen]);

  useEffect(() => {
    return () => {
      if (wasOverlayOpenRef.current) {
        wasOverlayOpenRef.current = false;
        onOverlayOpenChangeRef.current?.(false);
      }
    };
  }, []);

  const updateMenuPosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn || typeof window === 'undefined') return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = 192; // w-48
    const estimatedMenuHeight = 116;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpwards = spaceBelow < estimatedMenuHeight && rect.top > estimatedMenuHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
    const top = openUpwards ? Math.max(8, rect.top - 4) : Math.min(window.innerHeight - 8, rect.bottom + 4);
    setMenuPosition({ top, left, openUpwards });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    updateMenuPosition();

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', updateMenuPosition, true);
    window.addEventListener('resize', updateMenuPosition);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [menuOpen, updateMenuPosition]);

  const titleTooltip =
    executionState === 'done_expected'
      ? t.execution.tooltipDoneExpected
      : executionState === 'done_variance'
      ? t.execution.tooltipDoneVariance(varianceReason)
      : t.execution.tooltipNotDone;

  const stateLabel =
    executionState === 'done_expected'
      ? t.execution.doneExpected
      : executionState === 'done_variance'
      ? t.execution.doneVariance
      : t.execution.notDone;

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
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!menuOpen) {
              updateMenuPosition();
            }
            setMenuOpen((v) => !v);
          }}
          title={titleTooltip}
          aria-label={t.execution.ariaExecutionState(stepTitle, stateLabel)}
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
      </div>

      {menuOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            data-step-execution-portal="true"
            style={{
              left: `${menuPosition.left}px`,
              top: `${menuPosition.top}px`,
              transform: menuPosition.openUpwards ? 'translateY(-100%)' : undefined,
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-[60] w-48 bg-white border border-zinc-300 rounded-md shadow-lg py-1 text-left"
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onChangeState('not_done');
              }}
              className={`w-full px-2.5 py-1.5 text-[11px] flex items-center gap-2 hover:bg-zinc-100 ${
                executionState === 'not_done'
                  ? 'font-semibold text-zinc-900 bg-zinc-50'
                  : 'text-zinc-700'
              }`}
            >
              <Circle className="w-3 h-3 text-zinc-400 shrink-0" />
              <span>{t.execution.notDone}</span>
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
              <span>{t.execution.doneExpected}</span>
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
              <span>{t.execution.doneVariance}</span>
            </button>
          </div>,
          document.body
        )}

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
