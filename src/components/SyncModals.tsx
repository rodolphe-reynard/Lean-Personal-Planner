import React, { useState } from 'react';
import { AlertTriangle, Cloud, GitMerge, HardDrive, Loader2, Upload } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';

export const SyncModals: React.FC = () => {
  const { pendingMigration, syncConflicts, resolveMigration, resolveConflict } = useAppState();
  const [migratingStrategy, setMigratingStrategy] = useState<string | null>(null);

  const handleMigration = async (strategy: 'merge' | 'replace_cloud' | 'keep_cloud') => {
    setMigratingStrategy(strategy);
    try {
      await resolveMigration(strategy);
    } finally {
      setMigratingStrategy(null);
    }
  };

  return (
    <>
      {/* Sign-In Local vs Cloud Reconciliation Modal */}
      {pendingMigration && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="migration-preview-title"
        >
          <div className="w-full max-w-xl bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
            <div className="flex items-start gap-3 pb-4 border-b border-zinc-200">
              <Cloud className="w-5 h-5 text-zinc-800 shrink-0 mt-0.5" />
              <div>
                <h2 id="migration-preview-title" className="text-base font-semibold text-zinc-900">
                  Reconcile Local & Cloud Workspace
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Signed in as{' '}
                  <span className="font-medium text-zinc-800">
                    {pendingMigration.user.email || pendingMigration.user.displayName}
                  </span>
                  . Choose how to reconcile this browser&apos;s data with Cloud Firestore.
                </p>
              </div>
            </div>

            {/* Preview Table */}
            <div className="border border-zinc-200 rounded-md overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                    <th className="py-2 px-3 font-medium">Data Collection</th>
                    <th className="py-2 px-3 font-mono text-right">This Browser</th>
                    <th className="py-2 px-3 font-mono text-right">Cloud Account</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/80 tabular-nums">
                  {[
                    {
                      label: 'Master Schedule Objectives',
                      local: pendingMigration.localCounts.tasks,
                      cloud: pendingMigration.cloudCounts.tasks,
                    },
                    {
                      label: 'WBS Steps',
                      local: pendingMigration.localCounts.steps,
                      cloud: pendingMigration.cloudCounts.steps,
                    },
                    {
                      label: 'Weekly Scheduled Blocks',
                      local: pendingMigration.localCounts.scheduledBlocks,
                      cloud: pendingMigration.cloudCounts.scheduledBlocks,
                    },
                    {
                      label: 'Fixed Activities',
                      local: pendingMigration.localCounts.fixedActivities,
                      cloud: pendingMigration.cloudCounts.fixedActivities,
                    },
                    {
                      label: 'Historical PPC Weeks',
                      local: pendingMigration.localCounts.ppcRecords,
                      cloud: pendingMigration.cloudCounts.ppcRecords,
                    },
                    {
                      label: 'CFD History Days',
                      local: pendingMigration.localCounts.cfdSnapshots,
                      cloud: pendingMigration.cloudCounts.cfdSnapshots,
                    },
                  ].map((row) => (
                    <tr key={row.label} className="bg-white">
                      <td className="py-2 px-3 text-zinc-700">{row.label}</td>
                      <td className="py-2 px-3 font-mono text-right font-medium text-zinc-900">
                        {row.local}
                      </td>
                      <td className="py-2 px-3 font-mono text-right font-medium text-zinc-900">
                        {row.cloud}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                disabled={migratingStrategy !== null}
                onClick={() => handleMigration('merge')}
                className="w-full p-3 text-left border border-zinc-900 bg-zinc-900 text-white rounded-md hover:bg-zinc-800 transition-colors flex items-start gap-3 disabled:opacity-60"
              >
                {migratingStrategy === 'merge' ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
                ) : (
                  <GitMerge className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="text-xs font-semibold">
                    Merge Local & Cloud (Recommended)
                  </div>
                  <div className="text-[11px] text-zinc-300 mt-0.5">
                    Combines objectives, steps, schedules, and locked history from both sources, keeping the newest edits where IDs match.
                  </div>
                </div>
              </button>

              <button
                type="button"
                disabled={migratingStrategy !== null}
                onClick={() => handleMigration('replace_cloud')}
                className="w-full p-3 text-left border border-zinc-300 bg-white text-zinc-900 rounded-md hover:bg-zinc-50 transition-colors flex items-start gap-3 disabled:opacity-60"
              >
                {migratingStrategy === 'replace_cloud' ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
                ) : (
                  <Upload className="w-4 h-4 shrink-0 mt-0.5 text-zinc-600" />
                )}
                <div>
                  <div className="text-xs font-semibold">
                    Upload Local Workspace & Replace Cloud
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Pushes this browser&apos;s current plan as your cloud source of truth.
                  </div>
                </div>
              </button>

              <button
                type="button"
                disabled={migratingStrategy !== null}
                onClick={() => handleMigration('keep_cloud')}
                className="w-full p-3 text-left border border-zinc-300 bg-white text-zinc-900 rounded-md hover:bg-zinc-50 transition-colors flex items-start gap-3 disabled:opacity-60"
              >
                {migratingStrategy === 'keep_cloud' ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
                ) : (
                  <HardDrive className="w-4 h-4 shrink-0 mt-0.5 text-zinc-600" />
                )}
                <div>
                  <div className="text-xs font-semibold">
                    Keep Cloud Workspace (Discard Local Changes)
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Loads your synced cloud workspace onto this device cleanly.
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Device Simultaneous Edit Conflict Banner/Modal */}
      {syncConflicts.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-50 w-full max-w-md bg-white border border-amber-300 rounded-lg shadow-lg p-4 space-y-3"
          role="alertdialog"
          aria-labelledby="sync-conflict-title"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 id="sync-conflict-title" className="text-xs font-semibold text-zinc-900">
                Simultaneous Multi-Device Edit Detected ({syncConflicts.length})
              </h3>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Another signed-in device updated an item you just edited. Choose which version to keep.
              </p>
            </div>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto">
            {syncConflicts.map((c) => (
              <div key={c.id} className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-md space-y-2">
                <div className="text-xs font-medium text-zinc-900">{c.label}</div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 font-mono">
                  <span>Local: {new Date(c.localUpdatedAt).toLocaleTimeString()}</span>
                  <span>Cloud: {new Date(c.remoteUpdatedAt).toLocaleTimeString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => resolveConflict(c.id, 'local')}
                    className="flex-1 px-2.5 py-1 text-[11px] font-medium bg-zinc-900 text-white rounded hover:bg-zinc-800"
                  >
                    Keep Local
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveConflict(c.id, 'remote')}
                    className="flex-1 px-2.5 py-1 text-[11px] font-medium bg-white text-zinc-800 border border-zinc-300 rounded hover:bg-zinc-100"
                  >
                    Use Cloud
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
