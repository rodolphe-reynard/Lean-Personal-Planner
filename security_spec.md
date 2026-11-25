# Firestore Security Specification — Takt Lean Personal Planner

## 1. Data Invariants
1. **Strict Multi-Tenant Isolation**: Every document lives under `/users/{userId}/...`, where `userId == request.auth.uid` and `request.auth.token.email_verified == true`.
2. **Master Gate Relational Sync**: Every subcollection write (`create`, `update`, `delete`) and single-doc `get` verifies that the parent `/users/{userId}` document exists and belongs to `request.auth.uid`.
3. **Immutable Ownership & Identifiers**: `id`, `userId`, and `createdAt` cannot be modified after creation.
4. **Strict Schema & Bounds**: Unknown shadow fields are rejected via `hasAll` / `hasOnly` and action-scoped `affectedKeys().hasOnly(...)`. Every string and array enforces explicit `.size()` bounds.
5. **Immutable Historical CFD Snapshots**: Once a `DailyCFDSnapshot` document is finalized (`existing().locked == true`), client writes cannot mutate historical flow counts.
6. **Parent Integrity on Creation**: Creating a `WBSStep` or `ScheduledBlock` verifies that the referenced parent `Task` exists inside the same user's namespace.
7. **Secure List Queries**: Every `allow list` validates `isVerifiedOwner(userId) && existing().userId == request.auth.uid` without issuing `get()`/`exists()` inside list rules.

## 2. Dirty Dozen Adversarial Payloads
1. Unauthenticated read/write to `/users/{uid}/tasks/{taskId}` -> `PERMISSION_DENIED`.
2. Authenticated user A reading or listing user B's `/users/{userB}/tasks` -> `PERMISSION_DENIED`.
3. Unverified email token (`email_verified: false`) writing `/users/{uid}/tasks/{taskId}` -> `PERMISSION_DENIED`.
4. Shadow field injection (`isAdmin: true`, `extraField: "x"`) on task creation -> `PERMISSION_DENIED`.
5. Identity spoofing (`userId: "other-uid"`) on step or fixed activity create -> `PERMISSION_DENIED`.
6. Document ID poisoning (`1500`-char string or invalid chars `$foo`) in path parameter -> `PERMISSION_DENIED`.
7. Resource exhaustion (`name` > 200 chars or `deadlines` list > 25 items) -> `PERMISSION_DENIED`.
8. Client timestamp forgery (`syncedAt` != `request.time`) -> `PERMISSION_DENIED`.
9. Update attempting to mutate immutable `userId` or `createdAt` -> `PERMISSION_DENIED`.
10. Orphaned `WBSStep` referencing a non-existent `taskId` -> `PERMISSION_DENIED`.
11. Mutating a locked historical `DailyCFDSnapshot` (`existing().locked == true`) -> `PERMISSION_DENIED`.
12. Accessing an unlisted collection path (`/admin/flags` or `/public/tasks`) -> `PERMISSION_DENIED` via default-deny catch-all.
