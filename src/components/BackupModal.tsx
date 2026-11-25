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
      setImportError(
        err instanceof Error ? err.message : 'Unable to complete Google Sign-In.'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignOut = async () => {
    setImportError(null);
    setAuthBusy(true);
    try {
      await signOutUser();
      setImportSuccess('Signed out. Local IndexedDB workspace remains active on this device.');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unable to sign out.');
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
    setImportSuccess('Backup file exported successfully.');
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
      setImportError('Unable to parse file. Please select a valid JSON backup exported from this application.');
    }
  };

  const syncLabel =
    syncStatus === 'synced'
      ? 'Cloud Synced'
      : syncStatus === 'syncing'
      ? 'Syncing…'
      : syncStatus === 'offline'
      ? 'Offline Queue (IndexedDB Cache)'
      : syncStatus === 'error'
      ? 'Sync Error'
      : 'Local Only';

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
                Account, Cloud Sync &amp; Backup
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                {tasks.length} objectives · {steps.length} steps · {scheduledBlocks.length} scheduled blocks
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md transition-colors"
              aria-label="Close modal"
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
                      {user ? user.displayName || user.email || 'Signed-in Account' : 'Cloud Firestore Sync'}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      {user
                        ? `${user.email ?? ''} · ${syncLabel}`
                        : 'Sign in with Google to synchronise your Lean plan across devices.'}
                    </div>
                  </div>
                </div>

                {user && user.photoURL && (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Account'}
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
                    Reconcile Local &amp; Cloud
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
                    Sign Out
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
                  Sign in with Google
                </button>
              )}
            </div>

            {/* Export JSON */}
            <div className="border border-zinc-200 rounded-md p-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-900">Export JSON Backup</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Download objectives, WBS steps, milestones, fixed blocks, and archived history.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadJson}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Export JSON
              </button>
            </div>

            {/* Restore JSON */}
            <div className="border border-zinc-200 rounded-md p-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-900">Restore from JSON</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Validate a backup file and replace current workspace data.
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
                Import JSON
              </button>
            </div>

            <div className="pt-3 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction('sample')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to Sample Plan
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction('clear')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Workspace
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingImport)}
        title="Overwrite Existing Data?"
        message={
          pendingImport
            ? `Importing "${pendingImport.fileName}" (${pendingImport.data.tasks.length} objectives, ${pendingImport.data.steps.length} steps, ${pendingImport.data.scheduledBlocks.length} scheduled blocks) will replace all current workspace data. This cannot be undone.`
            : ''
        }
        confirmLabel="Replace Workspace"
        destructive
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport) {
            replaceWorkspace(pendingImport.data);
            setImportSuccess(`Restored ${pendingImport.data.tasks.length} objectives from "${pendingImport.fileName}".`);
            setPendingImport(null);
          }
        }}
      />

      <ConfirmModal
        isOpen={confirmAction === 'clear'}
        title="Clear Entire Workspace?"
        message="This will permanently delete all objectives, WBS steps, and scheduled blocks from browser storage (and cloud if signed in)."
        confirmLabel="Clear Everything"
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          clearAllData();
          setConfirmAction(null);
          setImportSuccess('Workspace cleared.');
        }}
      />

      <ConfirmModal
        isOpen={confirmAction === 'sample'}
        title="Reset to Sample Plan?"
        message="This will replace your current workspace with the default sample Lean plan anchored to the current week."
        confirmLabel="Load Sample Plan"
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          loadSampleData();
          setConfirmAction(null);
          setImportSuccess('Sample plan loaded for the current week.');
        }}
      />
    </>
  );
};
