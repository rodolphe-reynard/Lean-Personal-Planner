import React, { useEffect, useRef, useState } from 'react';
import {
  Cloud,
  CloudOff,
  Download,
  GitMerge,
  Loader2,
  LogIn,
  LogOut,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { PersistedWorkspace, validateImportPayload } from '../storage/db';
import { ConfirmModal } from './ConfirmModal';
import { useLanguage } from '../i18n/LanguageContext';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({ isOpen, onClose }) => {
  const {
    tasks,
    steps,
    scheduledBlocks,
    todayStr,
    user,
    syncStatus,
    syncError,
    signInWithGoogle,
    signOutUser,
    triggerManualReconcile,
    exportWorkspaceJson,
    replaceWorkspace,
    loadSampleData,
    clearAllData,
  } = useAppState();
  const { t } = useLanguage();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    data: PersistedWorkspace;
  } | null>(null);
  const [confirmAction, setConfirmAction] = useState<'clear' | 'sample' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setImportError(null);
    setImportSuccess(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pendingImport && !confirmAction) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, pendingImport, confirmAction, onClose]);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setImportError(null);
    setAuthBusy(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t.backupModal.errSignIn);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignOut = async () => {
    setImportError(null);
    setAuthBusy(true);
    try {
      await signOutUser();
      setImportSuccess(t.backupModal.msgSignedOut);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t.backupModal.errSignOut);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleDownloadJson = () => {
    const json = exportWorkspaceJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `takt-lean-plan-${todayStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setImportError(null);
    setImportSuccess(t.backupModal.msgExported);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validation = validateImportPayload(parsed);
      if (!validation.ok) {
        setImportError(validation.error);
        return;
      }
      setPendingImport({ fileName: file.name, data: validation.data });
    } catch {
      setImportError(t.backupModal.msgInvalidFile);
    }
  };

  const syncLabel = t.backupModal.syncLabels[syncStatus];

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-modal-title"
        onClick={onClose}
      >
        <div
          className="w-full max-w-lg bg-white border border-zinc-200 rounded-lg p-6 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-zinc-200">
            <div>
              <h2 id="backup-modal-title" className="text-base font-semibold text-zinc-900">
                {t.backupModal.title}
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                {t.backupModal.statsSummary(tasks.length, steps.length, scheduledBlocks.length)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md transition-colors"
              aria-label={t.common.closeModal}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {(importError || syncError) && (
              <div className="px-3 py-2.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
                {importError || syncError}
              </div>
            )}
            {importSuccess && (
              <div className="px-3 py-2.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
                {importSuccess}
              </div>
            )}

            {/* Google Sign-In & Cloud Firestore Sync Card */}
            <div className="border border-zinc-200 rounded-md p-4 bg-zinc-50/60 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  {user ? (
                    syncStatus === 'offline' || syncStatus === 'error' ? (
                      <CloudOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    ) : (
                      <Cloud className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    )
                  ) : (
                    <Cloud className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900">
                      {user
                        ? user.displayName || user.email || t.backupModal.signedInFallback
                        : t.backupModal.cloudSyncTitle}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      {user
                        ? `${user.email ?? ''} · ${syncLabel}`
                        : t.backupModal.signInPrompt}
                    </div>
                  </div>
                </div>

                {user && user.photoURL && (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || t.nav.accountFallback}
                    className="w-8 h-8 rounded-full border border-zinc-300 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>

              {user ? (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-200/80">
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={async () => {
                      await triggerManualReconcile();
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 rounded-md hover:bg-zinc-100 disabled:opacity-60"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    {t.backupModal.reconcileBtn}
                  </button>

                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={handleGoogleSignOut}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-100 disabled:opacity-60"
                  >
                    {authBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogOut className="w-3.5 h-3.5" />
                    )}
                    {t.backupModal.signOutBtn}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleGoogleSignIn}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-60"
                >
                  {authBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogIn className="w-3.5 h-3.5" />
                  )}
                  {t.backupModal.signInBtn}
                </button>
              )}
            </div>

            {/* Export JSON */}
            <div className="border border-zinc-200 rounded-md p-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-900">{t.backupModal.exportTitle}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {t.backupModal.exportDesc}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadJson}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                {t.backupModal.exportBtn}
              </button>
            </div>

            {/* Restore JSON */}
            <div className="border border-zinc-200 rounded-md p-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-900">{t.backupModal.restoreTitle}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {t.backupModal.restoreDesc}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFileSelected}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                {t.backupModal.importBtn}
              </button>
            </div>

            <div className="pt-3 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction('sample')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t.backupModal.resetSampleBtn}
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction('clear')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t.backupModal.clearWorkspaceBtn}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingImport)}
        title={t.backupModal.overwriteTitle}
        message={
          pendingImport
            ? t.backupModal.overwriteMsg(
                pendingImport.fileName,
                pendingImport.data.tasks.length,
                pendingImport.data.steps.length,
                pendingImport.data.scheduledBlocks.length
              )
            : ''
        }
        confirmLabel={t.backupModal.overwriteBtn}
        destructive
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport) {
            replaceWorkspace(pendingImport.data);
            setImportSuccess(
              t.backupModal.msgRestored(pendingImport.data.tasks.length, pendingImport.fileName)
            );
            setPendingImport(null);
          }
        }}
      />

      <ConfirmModal
        isOpen={confirmAction === 'clear'}
        title={t.backupModal.clearTitle}
        message={t.backupModal.clearMsg}
        confirmLabel={t.backupModal.clearBtn}
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          clearAllData();
          setConfirmAction(null);
          setImportSuccess(t.backupModal.msgCleared);
        }}
      />

      <ConfirmModal
        isOpen={confirmAction === 'sample'}
        title={t.backupModal.sampleTitle}
        message={t.backupModal.sampleMsg}
        confirmLabel={t.backupModal.sampleBtn}
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          loadSampleData();
          setConfirmAction(null);
          setImportSuccess(t.backupModal.msgSampleLoaded);
        }}
      />
    </>
  );
};
