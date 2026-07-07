"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteOperation,
  discardLockedConflicts,
  enqueueScoreOperation,
  listConflictOperations,
  listPendingOperations,
  updateOperation,
} from "@/lib/sync/client-store";
import type { OutboxOperation } from "@/lib/sync/types";
import type { ScoreOperationInput } from "@/lib/validation/domain";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { randomUUID } from "@/lib/utils";

export function useOfflineOutbox() {
  const { isOnline } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    const [pending, conflicts] = await Promise.all([
      listPendingOperations(),
      listConflictOperations(),
    ]);
    setPendingCount(pending.length);
    setConflictCount(conflicts.length);
  }, []);

  // Keep refreshPendingCount as an alias so callers don't break.
  const refreshPendingCount = refreshCounts;

  const syncPending = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    if (!navigator.onLine) return;

    const pendingOperations = await listPendingOperations();
    if (pendingOperations.length === 0) return;

    setIsSyncing(true);
    let hadError = false;

    try {
    for (const operation of pendingOperations) {
      const syncingOperation: OutboxOperation = {
        ...operation,
        status: "syncing",
        updatedAt: new Date().toISOString(),
      };
      await updateOperation(syncingOperation);

      try {
        const response = await fetch("/api/sync/score-operation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(operation.payload),
        });
        const result = await response.json();

        // A set that is locked (409 "Round is locked.") or already finalized by
        // this judge (423 status:"locked") can't accept the write — but the
        // persisted score stands, so this is not data loss. Discard the op
        // instead of flagging a permanent "score not saved — contact tabulator".
        const message = String(result?.message ?? result?.error ?? "");
        const lockRejected =
          response.status === 423 ||
          result?.status === "locked" ||
          (response.status === 409 && /lock/i.test(message));
        if (lockRejected) {
          await deleteOperation(operation.localId);
          continue;
        }

        const isConflict = !response.ok || result.status === "conflict";
        // Prefer result.message, then result.error, then a generic status string.
        const serverMessage: string | undefined = !response.ok
          ? (result.message ?? result.error ?? `Server rejected score (${response.status})`)
          : undefined;

        await updateOperation({
          ...operation,
          status: isConflict ? "conflict" : "synced",
          lastError: serverMessage,
          updatedAt: new Date().toISOString(),
        });

        if (isConflict) {
          hadError = true;
          setLastSyncError(serverMessage ?? "Score was rejected by the server.");
        }
      } catch (error) {
        await updateOperation({
          ...operation,
          status: "pending",
          retryCount: operation.retryCount + 1,
          lastError: error instanceof Error ? error.message : "Sync failed.",
          updatedAt: new Date().toISOString(),
        });
        hadError = true;
        setLastSyncError(error instanceof Error ? error.message : "Sync failed.");
      }
    }
    } finally {
      setIsSyncing(false);
    }

    await refreshCounts();

    // A fully clean pass means everything reached the server — clear any prior
    // error and stamp the last successful sync time for the status badge.
    if (!hadError) {
      setLastSyncError(null);
      setLastSyncedAt(new Date().toISOString());
    }
  }, [refreshCounts]);

  const enqueue = useCallback(
    async (payload: ScoreOperationInput, options?: { sync?: boolean }) => {
      const now = new Date().toISOString();
      const operation: OutboxOperation = {
        localId: randomUUID(),
        idempotencyKey: payload.idempotencyKey,
        operationType: payload.operation,
        payload,
        status: "pending",
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      // The write is durable (in IndexedDB) the moment it's enqueued, so callers
      // can defer the network sync (e.g. debounce rapid slider edits) while the
      // value is still safely captured and reflected in `pendingCount`.
      await enqueueScoreOperation(operation);
      await refreshCounts();

      if ((options?.sync ?? true) && isOnline) await syncPending();
    },
    [isOnline, refreshCounts, syncPending],
  );

  useEffect(() => {
    if (!isOnline) return;
    const timeoutId = window.setTimeout(() => {
      void syncPending();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isOnline, syncPending]);

  // On mount, clear any conflicts left stuck from lock/finalize rejections
  // (e.g. a late write after "Submit & lock"), then refresh counts so the badge
  // is accurate from first render.
  useEffect(() => {
    void discardLockedConflicts().then(() => refreshCounts());
  }, [refreshCounts]);

  return {
    enqueue,
    isOnline,
    isSyncing,
    lastSyncError,
    lastSyncedAt,
    pendingCount,
    conflictCount,
    syncPending,
  };
}
