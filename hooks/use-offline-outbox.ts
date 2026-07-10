"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

interface BatchItemResult {
  idempotencyKey: string;
  status?: "synced" | "conflict" | "locked";
  message?: string;
  error?: string;
}

function lockRejected(response: Response, result: BatchItemResult | Record<string, unknown>) {
  const message = String(result?.message ?? result?.error ?? "");
  return (
    response.status === 423 ||
    result?.status === "locked" ||
    (response.status === 409 && /lock/i.test(message))
  );
}

async function applySyncResult(
  operation: OutboxOperation,
  response: Response,
  result: BatchItemResult | Record<string, unknown>,
): Promise<{ hadError: boolean; errorMessage: string | null }> {
  if (lockRejected(response, result)) {
    await deleteOperation(operation.localId);
    return { hadError: false, errorMessage: null };
  }

  const isConflict = !response.ok || result.status === "conflict";
  const serverMessage: string | undefined = !response.ok
    ? String(result.message ?? result.error ?? `Server rejected score (${response.status})`)
    : undefined;

  await updateOperation({
    ...operation,
    status: isConflict ? "conflict" : "synced",
    lastError: serverMessage,
    updatedAt: new Date().toISOString(),
  });

  if (isConflict) {
    return {
      hadError: true,
      errorMessage: serverMessage ?? "Score was rejected by the server.",
    };
  }

  return { hadError: false, errorMessage: null };
}

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

  const refreshPendingCount = refreshCounts;

  // Guards against overlapping syncPending() calls (e.g. the debounced
  // per-card sync and the periodic retry firing close together on a slow
  // connection). A ref rather than isSyncing state because state would be
  // stale inside this callback's own closure.
  const syncInFlightRef = useRef(false);

  const syncPending = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    if (!navigator.onLine) return;
    if (syncInFlightRef.current) return;

    const pendingOperations = await listPendingOperations();
    if (pendingOperations.length === 0) return;

    syncInFlightRef.current = true;
    setIsSyncing(true);
    let hadError = false;
    let lastError: string | null = null;

    const syncingOperations = pendingOperations.map((operation) => ({
      ...operation,
      status: "syncing" as const,
      updatedAt: new Date().toISOString(),
    }));

    try {
      for (const operation of syncingOperations) {
        await updateOperation(operation);
      }

      try {
        const response = await fetch("/api/sync/score-batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operations: pendingOperations.map((operation) => operation.payload),
          }),
        });
        const payload = (await response.json()) as {
          results?: BatchItemResult[];
          blockedIdempotencyKeys?: string[];
          message?: string;
          error?: string;
          status?: string;
        };

        if (lockRejected(response, payload)) {
          const blockedKeys = new Set(payload.blockedIdempotencyKeys ?? []);
          for (const operation of pendingOperations) {
            if (
              blockedKeys.size === 0 ||
              blockedKeys.has(operation.idempotencyKey)
            ) {
              await deleteOperation(operation.localId);
              continue;
            }

            await updateOperation({
              ...operation,
              status: "pending",
              updatedAt: new Date().toISOString(),
            });
          }
        } else if (!response.ok || !Array.isArray(payload.results)) {
          hadError = true;
          lastError = payload.message ?? payload.error ?? "Sync failed.";
          for (const operation of pendingOperations) {
            await updateOperation({
              ...operation,
              status: "pending",
              retryCount: operation.retryCount + 1,
              lastError: lastError,
              updatedAt: new Date().toISOString(),
            });
          }
        } else {
          const resultsByKey = new Map(
            payload.results.map((result) => [result.idempotencyKey, result]),
          );

          for (const operation of pendingOperations) {
            const result = resultsByKey.get(operation.idempotencyKey);
            if (!result) {
              await updateOperation({
                ...operation,
                status: "pending",
                retryCount: operation.retryCount + 1,
                lastError: "Server did not return a result for this score.",
                updatedAt: new Date().toISOString(),
              });
              hadError = true;
              lastError = "Server did not return a result for this score.";
              continue;
            }

            const syntheticResponse = {
              ok: result.status === "synced",
              status: result.status === "conflict" ? 409 : 200,
            } as Response;

            const outcome = await applySyncResult(operation, syntheticResponse, result);
            if (outcome.hadError) {
              hadError = true;
              lastError = outcome.errorMessage;
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed.";
        hadError = true;
        lastError = message;

        for (const operation of pendingOperations) {
          await updateOperation({
            ...operation,
            status: "pending",
            retryCount: operation.retryCount + 1,
            lastError: message,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } finally {
      setIsSyncing(false);
      syncInFlightRef.current = false;
    }

    await refreshCounts();

    if (!hadError) {
      setLastSyncError(null);
      setLastSyncedAt(new Date().toISOString());
    } else if (lastError) {
      setLastSyncError(lastError);
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

  // Fallback retry loop: `navigator.onLine` only reflects "has a network
  // interface," not "can actually reach the server" — flaky venue wifi often
  // reports online while requests time out. Without this, a sync that fails
  // on the last score of a round sits in the outbox until the judge enters
  // another score (which re-triggers the debounce) or the browser fires a
  // genuine offline->online transition. Scoped to only exist while there's a
  // backlog, so it's a no-op the rest of the time — no interval is even
  // created once everything's synced.
  useEffect(() => {
    if (pendingCount === 0) return;
    const intervalId = window.setInterval(() => {
      void syncPending();
    }, 12000);
    return () => window.clearInterval(intervalId);
  }, [pendingCount, syncPending]);

  useEffect(() => {
    void discardLockedConflicts().then(() => refreshCounts());
  }, [refreshCounts]);

  // Ask the browser not to evict this origin's IndexedDB under storage
  // pressure or (on Safari/iOS) after a period of the app being unopened.
  // Best-effort: unsynced scores already survive in the outbox regardless,
  // this just reduces the chance a tablet sitting idle between events loses
  // them to eviction before the judge reopens the app.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
    void navigator.storage.persist();
  }, []);

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
