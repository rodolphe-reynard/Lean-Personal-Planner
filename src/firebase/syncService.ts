import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  DailyCFDSnapshot,
  FixedActivity,
  ScheduledBlock,
  ScheduleVersion,
  Task,
  WBSStep,
  WeeklyPPCRecord,
  WorkCapacitySettings,
} from '../types';
import { normalizePPCRecord, normalizeStep, normalizeTask, PersistedWorkspace } from '../storage/db';
import { getPrimaryDeadline } from '../utils/dateUtils';
import { DEFAULT_WORK_CAPACITY } from '../utils/schedulingUtils';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';

export interface CloudWorkspaceSnapshot {
  hasUserProfile: boolean;
  workspace: PersistedWorkspace;
  lockedCfdDates: Set<string>;
  lockedPpcWeeks: Set<string>;
  existingVersionIds: Set<string>;
}

const VALID_ID_RE = /^[a-zA-Z0-9_\-]+$/;

function safeId(raw: string, fallbackPrefix: string): string {
  if (raw && VALID_ID_RE.test(raw) && raw.length <= 128) return raw;
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  return cleaned || `${fallbackPrefix}-${Date.now()}`;
}

function clampStr(val: string | undefined, maxLen: number): string {
  return (val ?? '').slice(0, maxLen);
}

export async function ensureUserRoot(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    const now = Date.now();
    const displayName = clampStr(user.displayName || user.email || 'Takt User', 120);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        displayName,
        createdAt: now,
        updatedAt: now,
        syncedAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data();
      const createdAt = typeof existing.createdAt === 'number' ? existing.createdAt : now;
      await setDoc(
        ref,
        {
          uid: user.uid,
          displayName,
          createdAt,
          updatedAt: Math.max(createdAt, now),
          syncedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function serializeTaskDoc(uid: string, task: Task) {
  const normalized = normalizeTask(task);
  const deadlines = normalized.deadlines.slice(0, 25).map((d) => ({
    id: clampStr(d.id, 64),
    date: d.date,
    ...(d.label ? { label: clampStr(d.label, 48) } : {}),
  }));
  return {
    id: safeId(normalized.id, 'task'),
    userId: uid,
    name: clampStr(normalized.name || 'Untitled Objective', 200),
    description: clampStr(normalized.description, 2000),
    deadline: getPrimaryDeadline(deadlines, normalized.deadline),
    deadlines,
    status: normalized.status,
    colorId: clampStr(normalized.colorId, 32),
    responsibility: normalized.responsibility,
    valueCategory: normalized.valueCategory,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    syncedAt: serverTimestamp(),
  };
}

function serializeStepDoc(uid: string, step: WBSStep) {
  const payload: Record<string, unknown> = {
    id: safeId(step.id, 'step'),
    userId: uid,
    taskId: safeId(step.taskId, 'task'),
    title: clampStr(step.title || 'Untitled Step', 240),
    notes: clampStr(step.notes, 1000),
    order: Math.max(0, Math.min(10000, step.order)),
    estimatedMinutes: Math.max(30, Math.min(1440, Math.round(step.estimatedMinutes / 30) * 30)),
    completed: Boolean(step.completed),
    executionState: step.executionState,
    flowStatus: step.flowStatus,
    varianceReason: clampStr(step.varianceReason, 1000),
    responsibility: step.responsibility,
    dependsOnStepIds: (step.dependsOnStepIds ?? []).slice(0, 50),
    valueCategory: step.valueCategory,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt ?? Date.now(),
    syncedAt: serverTimestamp(),
  };
  if (typeof step.completedAt === 'number') {
    payload.completedAt = step.completedAt;
  }
  return payload;
}

function serializeBlockDoc(uid: string, block: ScheduledBlock) {
  return {
    id: safeId(block.id, 'block'),
    userId: uid,
    stepId: safeId(block.stepId, 'step'),
    taskId: safeId(block.taskId, 'task'),
    date: block.date,
    startMinutes: Math.max(0, Math.min(1410, block.startMinutes)),
    durationMinutes: Math.max(30, Math.min(960, block.durationMinutes)),
    updatedAt: block.updatedAt ?? Date.now(),
    syncedAt: serverTimestamp(),
  };
}

function serializeFixedDoc(uid: string, fa: FixedActivity) {
  const startMinutes = Math.max(0, Math.min(1410, fa.startMinutes));
  const endMinutes = Math.max(startMinutes + 30, Math.min(1440, fa.endMinutes));
  const payload: Record<string, unknown> = {
    id: safeId(fa.id, 'fixed'),
    userId: uid,
    title: clampStr(fa.title || 'Fixed Block', 200),
    kind: fa.kind,
    date: fa.date,
    startMinutes,
    endMinutes,
    countsAsWorkingTime: Boolean(fa.countsAsWorkingTime),
    valueCategory: fa.valueCategory,
    linkedStepIds: (fa.linkedStepIds ?? []).slice(0, 50),
    createdAt: fa.createdAt ?? Date.now(),
    updatedAt: fa.updatedAt ?? Date.now(),
    syncedAt: serverTimestamp(),
  };
  if (fa.seriesId && fa.seriesId.trim()) {
    payload.seriesId = clampStr(fa.seriesId, 128);
  }
  return payload;
}

function serializePPCDoc(uid: string, record: WeeklyPPCRecord) {
  const payload: Record<string, unknown> = {
    weekStart: record.weekStart,
    userId: uid,
    reasonsForVariance: clampStr(record.reasonsForVariance, 4000),
    stepVariances: (record.stepVariances ?? []).slice(0, 100).map((sv) => ({
      stepId: clampStr(sv.stepId, 128),
      stepTitle: clampStr(sv.stepTitle, 240),
      taskName: clampStr(sv.taskName, 200),
      reason: clampStr(sv.reason, 1000),
    })),
    updatedAt: record.updatedAt ?? Date.now(),
    syncedAt: serverTimestamp(),
  };
  if (record.snapshot) {
    payload.snapshot = {
      plannedCount: record.snapshot.plannedCount,
      completedCount: record.snapshot.completedCount,
      ppcPercent: record.snapshot.ppcPercent,
      completedItems: (record.snapshot.completedItems ?? []).slice(0, 150).map((item) => ({
        stepId: item.stepId,
        taskId: item.taskId,
        stepTitle: clampStr(item.stepTitle, 240),
        taskName: clampStr(item.taskName, 200),
        executionState: item.executionState,
        ...(item.varianceReason ? { varianceReason: clampStr(item.varianceReason, 1000) } : {}),
      })),
      incompleteItems: (record.snapshot.incompleteItems ?? []).slice(0, 150).map((item) => ({
        stepId: item.stepId,
        taskId: item.taskId,
        stepTitle: clampStr(item.stepTitle, 240),
        taskName: clampStr(item.taskName, 200),
        executionState: item.executionState,
        ...(item.varianceReason ? { varianceReason: clampStr(item.varianceReason, 1000) } : {}),
      })),
      locked: Boolean(record.snapshot.locked),
      updatedAt: record.snapshot.updatedAt,
    };
  }
  return payload;
}

function serializeCFDDoc(uid: string, snap: DailyCFDSnapshot) {
  return {
    date: snap.date,
    userId: uid,
    notStarted: Math.max(0, Math.min(10000, snap.notStarted)),
    inProgress: Math.max(0, Math.min(10000, snap.inProgress)),
    completed: Math.max(0, Math.min(10000, snap.completed)),
    total: Math.max(0, Math.min(10000, snap.total)),
    locked: Boolean(snap.locked),
    updatedAt: snap.updatedAt ?? Date.now(),
    syncedAt: serverTimestamp(),
  };
}

function serializeScheduleVersionDoc(uid: string, ver: ScheduleVersion) {
  return {
    id: safeId(ver.id, 'ver'),
    userId: uid,
    createdAt: ver.createdAt,
    label: clampStr(ver.label || 'Schedule Snapshot', 240),
    weekStart: ver.weekStart,
    blocks: (ver.blocks ?? []).slice(0, 250).map((b) => ({
      id: b.id,
      stepId: b.stepId,
      taskId: b.taskId,
      date: b.date,
      startMinutes: b.startMinutes,
      durationMinutes: b.durationMinutes,
    })),
    syncedAt: serverTimestamp(),
  };
}

function serializeSettingsDoc(uid: string, settings: WorkCapacitySettings) {
  return {
    id: 'workCapacity',
    userId: uid,
    workdays: (settings.workdays ?? DEFAULT_WORK_CAPACITY.workdays).slice(0, 7),
    workdayStartMinutes: Math.max(0, Math.min(1410, settings.workdayStartMinutes)),
    workdayEndMinutes: Math.max(
      settings.workdayStartMinutes + 30,
      Math.min(1440, settings.workdayEndMinutes)
    ),
    dailyTargetHours: Math.max(1, Math.min(16, settings.dailyTargetHours)),
    updatedAt: settings.updatedAt ?? Date.now(),
    syncedAt: serverTimestamp(),
  };
}

export async function fetchCloudWorkspaceSnapshot(uid: string): Promise<CloudWorkspaceSnapshot> {
  const userPath = `users/${uid}`;
  let hasUserProfile = false;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    hasUserProfile = userSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!hasUserProfile) {
    return {
      hasUserProfile: false,
      workspace: {
        tasks: [],
        steps: [],
        scheduledBlocks: [],
        fixedActivities: [],
        ppcRecords: [],
        cfdSnapshots: [],
        scheduleVersions: [],
        workCapacity: DEFAULT_WORK_CAPACITY,
      },
      lockedCfdDates: new Set(),
      lockedPpcWeeks: new Set(),
      existingVersionIds: new Set(),
    };
  }

  const readCol = async (sub: string) => {
    const p = `users/${uid}/${sub}`;
    try {
      return await getDocs(collection(db, 'users', uid, sub));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, p);
    }
  };

  const [
    taskSnaps,
    stepSnaps,
    blockSnaps,
    fixedSnaps,
    ppcSnaps,
    cfdSnaps,
    verSnaps,
    settingsSnaps,
  ] = await Promise.all([
    readCol('tasks'),
    readCol('steps'),
    readCol('scheduledBlocks'),
    readCol('fixedActivities'),
    readCol('ppcRecords'),
    readCol('cfdSnapshots'),
    readCol('scheduleVersions'),
    readCol('settings'),
  ]);

  const scheduledBlocks: ScheduledBlock[] = blockSnaps.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      stepId: String(data.stepId ?? ''),
      taskId: String(data.taskId ?? ''),
      date: String(data.date ?? ''),
      startMinutes: Number(data.startMinutes ?? 540),
      durationMinutes: Number(data.durationMinutes ?? 60),
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
    };
  });

  const scheduledStepIds = new Set(scheduledBlocks.map((b) => b.stepId));
  const tasks: Task[] = taskSnaps.docs.map((d) =>
    normalizeTask({ ...(d.data() as Partial<Task>), id: d.id, name: String(d.data().name ?? '') })
  );
  const steps: WBSStep[] = stepSnaps.docs.map((d) =>
    normalizeStep(
      {
        ...(d.data() as Partial<WBSStep>),
        id: d.id,
        taskId: String(d.data().taskId ?? ''),
        title: String(d.data().title ?? ''),
      },
      scheduledStepIds
    )
  );
  const fixedActivities: FixedActivity[] = fixedSnaps.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: String(data.title ?? ''),
      kind: data.kind,
      date: String(data.date ?? ''),
      startMinutes: Number(data.startMinutes ?? 540),
      endMinutes: Number(data.endMinutes ?? 600),
      countsAsWorkingTime: Boolean(data.countsAsWorkingTime),
      valueCategory: data.valueCategory ?? 'NNVA',
      linkedStepIds: Array.isArray(data.linkedStepIds) ? data.linkedStepIds : [],
      seriesId: typeof data.seriesId === 'string' ? data.seriesId : undefined,
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
    };
  });

  const lockedPpcWeeks = new Set<string>();
  const ppcRecords: WeeklyPPCRecord[] = ppcSnaps.docs.map((d) => {
    const rec = normalizePPCRecord({
      ...(d.data() as Partial<WeeklyPPCRecord>),
      weekStart: d.id,
    });
    if (rec.snapshot?.locked) lockedPpcWeeks.add(rec.weekStart);
    return rec;
  });

  const lockedCfdDates = new Set<string>();
  const cfdSnapshots: DailyCFDSnapshot[] = cfdSnaps.docs
    .map((d) => {
      const data = d.data();
      const locked = Boolean(data.locked);
      if (locked) lockedCfdDates.add(d.id);
      return {
        date: d.id,
        notStarted: Number(data.notStarted ?? 0),
        inProgress: Number(data.inProgress ?? 0),
        completed: Number(data.completed ?? 0),
        total: Number(data.total ?? 0),
        locked,
        updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const existingVersionIds = new Set<string>();
  const scheduleVersions: ScheduleVersion[] = verSnaps.docs
    .map((d) => {
      existingVersionIds.add(d.id);
      const data = d.data();
      return {
        id: d.id,
        createdAt: Number(data.createdAt ?? Date.now()),
        label: String(data.label ?? ''),
        weekStart: String(data.weekStart ?? ''),
        blocks: Array.isArray(data.blocks) ? data.blocks : [],
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const capDoc = settingsSnaps.docs.find((d) => d.id === 'workCapacity');
  const workCapacity: WorkCapacitySettings = capDoc
    ? {
        workdays: Array.isArray(capDoc.data().workdays)
          ? capDoc.data().workdays
          : DEFAULT_WORK_CAPACITY.workdays,
        workdayStartMinutes: Number(
          capDoc.data().workdayStartMinutes ?? DEFAULT_WORK_CAPACITY.workdayStartMinutes
        ),
        workdayEndMinutes: Number(
          capDoc.data().workdayEndMinutes ?? DEFAULT_WORK_CAPACITY.workdayEndMinutes
        ),
        dailyTargetHours: Number(
          capDoc.data().dailyTargetHours ?? DEFAULT_WORK_CAPACITY.dailyTargetHours
        ),
        updatedAt:
          typeof capDoc.data().updatedAt === 'number' ? capDoc.data().updatedAt : Date.now(),
      }
    : DEFAULT_WORK_CAPACITY;

  return {
    hasUserProfile: true,
    workspace: {
      tasks,
      steps,
      scheduledBlocks,
      fixedActivities,
      ppcRecords,
      cfdSnapshots,
      scheduleVersions,
      workCapacity,
    },
    lockedCfdDates,
    lockedPpcWeeks,
    existingVersionIds,
  };
}

async function commitOperationsInChunks(
  ops: Array<{ type: 'set' | 'delete'; ref: ReturnType<typeof doc>; data?: Record<string, unknown> }>,
  pathLabel: string
): Promise<void> {
  const CHUNK_SIZE = 350;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.type === 'delete') {
        batch.delete(op.ref);
      } else if (op.data) {
        batch.set(op.ref, op.data);
      }
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, pathLabel);
    }
  }
}

export async function pushWorkspaceToCloud(
  user: User,
  workspace: PersistedWorkspace,
  options: {
    mode: 'replace' | 'upsert';
    cloudBaseline?: CloudWorkspaceSnapshot;
  }
): Promise<void> {
  const uid = user.uid;
  await ensureUserRoot(user);

  const baseline = options.cloudBaseline ?? (await fetchCloudWorkspaceSnapshot(uid));

  // If replacing cloud, first delete obsolete child docs in dependency-safe order (blocks -> steps -> tasks -> fixed -> versions)
  if (options.mode === 'replace') {
    const nextTaskIds = new Set(workspace.tasks.map((t) => safeId(t.id, 'task')));
    const nextStepIds = new Set(workspace.steps.map((s) => safeId(s.id, 'step')));
    const nextBlockIds = new Set(workspace.scheduledBlocks.map((b) => safeId(b.id, 'block')));
    const nextFixedIds = new Set(workspace.fixedActivities.map((f) => safeId(f.id, 'fixed')));
    const nextPpcWeeks = new Set(workspace.ppcRecords.map((p) => p.weekStart));
    const nextVerIds = new Set(workspace.scheduleVersions.map((v) => safeId(v.id, 'ver')));

    const deleteChildOps: Array<{ type: 'delete'; ref: ReturnType<typeof doc> }> = [];
    for (const b of baseline.workspace.scheduledBlocks) {
      if (!nextBlockIds.has(b.id)) {
        deleteChildOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'scheduledBlocks', b.id) });
      }
    }
    for (const s of baseline.workspace.steps) {
      if (!nextStepIds.has(s.id)) {
        deleteChildOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'steps', s.id) });
      }
    }
    for (const t of baseline.workspace.tasks) {
      if (!nextTaskIds.has(t.id)) {
        deleteChildOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'tasks', t.id) });
      }
    }
    for (const f of baseline.workspace.fixedActivities) {
      if (!nextFixedIds.has(f.id)) {
        deleteChildOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'fixedActivities', f.id) });
      }
    }
    for (const p of baseline.workspace.ppcRecords) {
      if (!nextPpcWeeks.has(p.weekStart)) {
        deleteChildOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'ppcRecords', p.weekStart) });
      }
    }
    for (const v of baseline.workspace.scheduleVersions) {
      if (!nextVerIds.has(v.id)) {
        deleteChildOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'scheduleVersions', v.id) });
      }
    }
    if (deleteChildOps.length > 0) {
      await commitOperationsInChunks(deleteChildOps, `users/${uid}/* (cleanup)`);
    }
  }

  // Phase 1: Independent root collections (tasks, fixedActivities, ppcRecords, cfdSnapshots, scheduleVersions, settings)
  const phase1Ops: Array<{ type: 'set'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];

  const validTaskIds = new Set<string>();
  for (const task of workspace.tasks) {
    const id = safeId(task.id, 'task');
    validTaskIds.add(id);
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'tasks', id),
      data: serializeTaskDoc(uid, task),
    });
  }

  for (const fa of workspace.fixedActivities) {
    const id = safeId(fa.id, 'fixed');
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'fixedActivities', id),
      data: serializeFixedDoc(uid, fa),
    });
  }

  for (const ppc of workspace.ppcRecords) {
    if (baseline.lockedPpcWeeks.has(ppc.weekStart)) {
      // Locked historical PPC doc: only update variance text/entries so snapshot stays immutable per security rules
      const ppcPath = `users/${uid}/ppcRecords/${ppc.weekStart}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'ppcRecords', ppc.weekStart), {
          reasonsForVariance: clampStr(ppc.reasonsForVariance, 4000),
          stepVariances: (ppc.stepVariances ?? []).slice(0, 100),
          updatedAt: ppc.updatedAt ?? Date.now(),
          syncedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, ppcPath);
      }
    } else {
      phase1Ops.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'ppcRecords', ppc.weekStart),
        data: serializePPCDoc(uid, ppc),
      });
    }
  }

  for (const cfd of workspace.cfdSnapshots) {
    // Immutable rule: never overwrite an already-locked remote CFD doc
    if (baseline.lockedCfdDates.has(cfd.date)) continue;
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'cfdSnapshots', cfd.date),
      data: serializeCFDDoc(uid, cfd),
    });
  }

  for (const ver of workspace.scheduleVersions) {
    const id = safeId(ver.id, 'ver');
    // scheduleVersions forbid update in rules -> only create missing versions
    if (baseline.existingVersionIds.has(id)) continue;
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'scheduleVersions', id),
      data: serializeScheduleVersionDoc(uid, ver),
    });
  }

  phase1Ops.push({
    type: 'set',
    ref: doc(db, 'users', uid, 'settings', 'workCapacity'),
    data: serializeSettingsDoc(uid, workspace.workCapacity),
  });

  if (phase1Ops.length > 0) {
    await commitOperationsInChunks(phase1Ops, `users/${uid}/phase1`);
  }

  // Phase 2: Steps (depends on taskExistsForUser)
  const stepOps = workspace.steps
    .filter((s) => validTaskIds.has(safeId(s.taskId, 'task')))
    .map((s) => ({
      type: 'set' as const,
      ref: doc(db, 'users', uid, 'steps', safeId(s.id, 'step')),
      data: serializeStepDoc(uid, s),
    }));
  if (stepOps.length > 0) {
    await commitOperationsInChunks(stepOps, `users/${uid}/steps`);
  }

  // Phase 3: ScheduledBlocks (depends on taskExistsForUser)
  const blockOps = workspace.scheduledBlocks
    .filter((b) => validTaskIds.has(safeId(b.taskId, 'task')))
    .map((b) => ({
      type: 'set' as const,
      ref: doc(db, 'users', uid, 'scheduledBlocks', safeId(b.id, 'block')),
      data: serializeBlockDoc(uid, b),
    }));
  if (blockOps.length > 0) {
    await commitOperationsInChunks(blockOps, `users/${uid}/scheduledBlocks`);
  }
}

export async function syncDiffToCloud(
  user: User,
  prev: PersistedWorkspace,
  next: PersistedWorkspace,
  remoteLockedCfdDates: Set<string>,
  remoteLockedPpcWeeks: Set<string>,
  remoteVersionIds: Set<string>
): Promise<void> {
  const uid = user.uid;

  // Detect deletions
  const nextTaskIds = new Set(next.tasks.map((t) => t.id));
  const nextStepIds = new Set(next.steps.map((s) => s.id));
  const nextBlockIds = new Set(next.scheduledBlocks.map((b) => b.id));
  const nextFixedIds = new Set(next.fixedActivities.map((f) => f.id));
  const nextPpcWeeks = new Set(next.ppcRecords.map((p) => p.weekStart));
  const nextVerIds = new Set(next.scheduleVersions.map((v) => v.id));

  const deleteOps: Array<{ type: 'delete'; ref: ReturnType<typeof doc> }> = [];
  for (const b of prev.scheduledBlocks) {
    if (!nextBlockIds.has(b.id)) {
      deleteOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'scheduledBlocks', b.id) });
    }
  }
  for (const s of prev.steps) {
    if (!nextStepIds.has(s.id)) {
      deleteOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'steps', s.id) });
    }
  }
  for (const t of prev.tasks) {
    if (!nextTaskIds.has(t.id)) {
      deleteOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'tasks', t.id) });
    }
  }
  for (const f of prev.fixedActivities) {
    if (!nextFixedIds.has(f.id)) {
      deleteOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'fixedActivities', f.id) });
    }
  }
  for (const p of prev.ppcRecords) {
    if (!nextPpcWeeks.has(p.weekStart)) {
      deleteOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'ppcRecords', p.weekStart) });
    }
  }
  for (const v of prev.scheduleVersions) {
    if (!nextVerIds.has(v.id)) {
      deleteOps.push({ type: 'delete', ref: doc(db, 'users', uid, 'scheduleVersions', v.id) });
    }
  }
  if (deleteOps.length > 0) {
    await commitOperationsInChunks(deleteOps, `users/${uid}/deletes`);
  }

  // Upsert changed items in dependency order: tasks/other -> steps -> blocks
  const prevTasks = new Map(prev.tasks.map((t) => [t.id, JSON.stringify(t)]));
  const changedTasks = next.tasks.filter((t) => prevTasks.get(t.id) !== JSON.stringify(t));

  const prevFixed = new Map(prev.fixedActivities.map((f) => [f.id, JSON.stringify(f)]));
  const changedFixed = next.fixedActivities.filter(
    (f) => prevFixed.get(f.id) !== JSON.stringify(f)
  );

  const prevPpc = new Map(prev.ppcRecords.map((p) => [p.weekStart, JSON.stringify(p)]));
  const changedPpc = next.ppcRecords.filter((p) => prevPpc.get(p.weekStart) !== JSON.stringify(p));

  const prevCfd = new Map(prev.cfdSnapshots.map((c) => [c.date, JSON.stringify(c)]));
  const changedCfd = next.cfdSnapshots.filter(
    (c) => !remoteLockedCfdDates.has(c.date) && prevCfd.get(c.date) !== JSON.stringify(c)
  );

  const newVersions = next.scheduleVersions.filter((v) => !remoteVersionIds.has(v.id));
  const settingsChanged = JSON.stringify(prev.workCapacity) !== JSON.stringify(next.workCapacity);

  const phase1Ops: Array<{ type: 'set'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
  for (const t of changedTasks) {
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'tasks', safeId(t.id, 'task')),
      data: serializeTaskDoc(uid, t),
    });
  }
  for (const f of changedFixed) {
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'fixedActivities', safeId(f.id, 'fixed')),
      data: serializeFixedDoc(uid, f),
    });
  }
  for (const p of changedPpc) {
    if (remoteLockedPpcWeeks.has(p.weekStart)) {
      const ppcPath = `users/${uid}/ppcRecords/${p.weekStart}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'ppcRecords', p.weekStart), {
          reasonsForVariance: clampStr(p.reasonsForVariance, 4000),
          stepVariances: (p.stepVariances ?? []).slice(0, 100),
          updatedAt: p.updatedAt ?? Date.now(),
          syncedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, ppcPath);
      }
    } else {
      phase1Ops.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'ppcRecords', p.weekStart),
        data: serializePPCDoc(uid, p),
      });
    }
  }
  for (const c of changedCfd) {
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'cfdSnapshots', c.date),
      data: serializeCFDDoc(uid, c),
    });
    if (c.locked) remoteLockedCfdDates.add(c.date);
  }
  for (const v of newVersions) {
    const id = safeId(v.id, 'ver');
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'scheduleVersions', id),
      data: serializeScheduleVersionDoc(uid, v),
    });
    remoteVersionIds.add(id);
  }
  if (settingsChanged) {
    phase1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'settings', 'workCapacity'),
      data: serializeSettingsDoc(uid, next.workCapacity),
    });
  }
  if (phase1Ops.length > 0) {
    await commitOperationsInChunks(phase1Ops, `users/${uid}/phase1-diff`);
  }

  const prevSteps = new Map(prev.steps.map((s) => [s.id, JSON.stringify(s)]));
  const changedSteps = next.steps.filter((s) => prevSteps.get(s.id) !== JSON.stringify(s));
  if (changedSteps.length > 0) {
    const stepOps = changedSteps.map((s) => ({
      type: 'set' as const,
      ref: doc(db, 'users', uid, 'steps', safeId(s.id, 'step')),
      data: serializeStepDoc(uid, s),
    }));
    await commitOperationsInChunks(stepOps, `users/${uid}/steps-diff`);
  }

  const prevBlocks = new Map(prev.scheduledBlocks.map((b) => [b.id, JSON.stringify(b)]));
  const changedBlocks = next.scheduledBlocks.filter(
    (b) => prevBlocks.get(b.id) !== JSON.stringify(b)
  );
  if (changedBlocks.length > 0) {
    const blockOps = changedBlocks.map((b) => ({
      type: 'set' as const,
      ref: doc(db, 'users', uid, 'scheduledBlocks', safeId(b.id, 'block')),
      data: serializeBlockDoc(uid, b),
    }));
    await commitOperationsInChunks(blockOps, `users/${uid}/scheduledBlocks-diff`);
  }
}

export async function deleteSingleCloudDoc(
  uid: string,
  subcollection: string,
  docId: string
): Promise<void> {
  const path = `users/${uid}/${subcollection}/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, subcollection, docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface WorkspaceSubscriptionCallbacks {
  onTasks: (tasks: Task[], fromRemoteServer: boolean) => void;
  onSteps: (steps: WBSStep[], fromRemoteServer: boolean) => void;
  onBlocks: (blocks: ScheduledBlock[], fromRemoteServer: boolean) => void;
  onFixedActivities: (fixed: FixedActivity[], fromRemoteServer: boolean) => void;
  onPpcRecords: (records: WeeklyPPCRecord[], fromRemoteServer: boolean) => void;
  onCfdSnapshots: (snapshots: DailyCFDSnapshot[], fromRemoteServer: boolean) => void;
  onScheduleVersions: (versions: ScheduleVersion[], fromRemoteServer: boolean) => void;
  onWorkCapacity: (settings: WorkCapacitySettings, fromRemoteServer: boolean) => void;
}

export function subscribeToUserWorkspace(
  uid: string,
  callbacks: WorkspaceSubscriptionCallbacks
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      collection(db, 'users', uid, 'tasks'),
      (snap) => {
        const list = snap.docs.map((d) =>
          normalizeTask({ ...(d.data() as Partial<Task>), id: d.id, name: String(d.data().name ?? '') })
        );
        callbacks.onTasks(list, !snap.metadata.hasPendingWrites);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/tasks`)
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'users', uid, 'steps'),
      (snap) => {
        const list = snap.docs.map((d) =>
          normalizeStep({
            ...(d.data() as Partial<WBSStep>),
            id: d.id,
            taskId: String(d.data().taskId ?? ''),
            title: String(d.data().title ?? ''),
          })
        );
        callbacks.onSteps(list, !snap.metadata.hasPendingWrites);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/steps`)
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'users', uid, 'scheduledBlocks'),
      (snap) => {
        const list: ScheduledBlock[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            stepId: String(data.stepId ?? ''),
            taskId: String(data.taskId ?? ''),
            date: String(data.date ?? ''),
            startMinutes: Number(data.startMinutes ?? 540),
            durationMinutes: Number(data.durationMinutes ?? 60),
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
          };
        });
        callbacks.onBlocks(list, !snap.metadata.hasPendingWrites);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/scheduledBlocks`)
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'users', uid, 'fixedActivities'),
      (snap) => {
        const list: FixedActivity[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: String(data.title ?? ''),
            kind: data.kind,
            date: String(data.date ?? ''),
            startMinutes: Number(data.startMinutes ?? 540),
            endMinutes: Number(data.endMinutes ?? 600),
            countsAsWorkingTime: Boolean(data.countsAsWorkingTime),
            valueCategory: data.valueCategory ?? 'NNVA',
            linkedStepIds: Array.isArray(data.linkedStepIds) ? data.linkedStepIds : [],
            seriesId: typeof data.seriesId === 'string' ? data.seriesId : undefined,
            createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
          };
        });
        callbacks.onFixedActivities(list, !snap.metadata.hasPendingWrites);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/fixedActivities`)
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'users', uid, 'ppcRecords'),
      (snap) => {
        const list = snap.docs.map((d) =>
          normalizePPCRecord({ ...(d.data() as Partial<WeeklyPPCRecord>), weekStart: d.id })
        );
        callbacks.onPpcRecords(list, !snap.metadata.hasPendingWrites);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/ppcRecords`)
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'users', uid, 'cfdSnapshots'),
      (snap) => {
        const list: DailyCFDSnapshot[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              date: d.id,
              notStarted: Number(data.notStarted ?? 0),
              inProgress: Number(data.inProgress ?? 0),
              completed: Number(data.completed ?? 0),
              total: Number(data.total ?? 0),
              locked: Boolean(data.locked),
              updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
            };
          })
          .sort((a, b) => a.date.localeCompare(b.date));
        callbacks.onCfdSnapshots(list, !snap.metadata.hasPendingWrites);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/cfdSnapshots`)
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'users', uid, 'scheduleVersions'),
      (snap) => {
        const list: ScheduleVersion[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              createdAt: Number(data.createdAt ?? Date.now()),
              label: String(data.label ?? ''),
              weekStart: String(data.weekStart ?? ''),
              blocks: Array.isArray(data.blocks) ? data.blocks : [],
            };
          })
          .sort((a, b) => b.createdAt - a.createdAt);
        callbacks.onScheduleVersions(list, !snap.metadata.hasPendingWrites);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/scheduleVersions`)
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'users', uid, 'settings'),
      (snap) => {
        const capDoc = snap.docs.find((d) => d.id === 'workCapacity');
        if (!capDoc) return;
        const data = capDoc.data();
        callbacks.onWorkCapacity(
          {
            workdays: Array.isArray(data.workdays) ? data.workdays : DEFAULT_WORK_CAPACITY.workdays,
            workdayStartMinutes: Number(
              data.workdayStartMinutes ?? DEFAULT_WORK_CAPACITY.workdayStartMinutes
            ),
            workdayEndMinutes: Number(
              data.workdayEndMinutes ?? DEFAULT_WORK_CAPACITY.workdayEndMinutes
            ),
            dailyTargetHours: Number(
              data.dailyTargetHours ?? DEFAULT_WORK_CAPACITY.dailyTargetHours
            ),
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
          },
          !snap.metadata.hasPendingWrites
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/settings`)
    )
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
