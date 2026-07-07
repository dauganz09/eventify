"use client";

import { openDB, type DBSchema } from "idb";
import type { CachedEventConfig, OutboxOperation } from "@/lib/sync/types";

interface TabulateDb extends DBSchema {
  scoreDrafts: {
    key: string;
    value: OutboxOperation;
    indexes: { "by-event": string };
  };
  outbox: {
    key: string;
    value: OutboxOperation;
    indexes: { "by-status": string };
  };
  cachedEventConfig: {
    key: string;
    value: CachedEventConfig;
  };
}

const databaseName = "tabulate-pro";
const databaseVersion = 1;

export async function getClientDatabase() {
  return openDB<TabulateDb>(databaseName, databaseVersion, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("scoreDrafts")) {
        const store = database.createObjectStore("scoreDrafts", {
          keyPath: "localId",
        });
        store.createIndex("by-event", "payload.eventId");
      }

      if (!database.objectStoreNames.contains("outbox")) {
        const store = database.createObjectStore("outbox", {
          keyPath: "localId",
        });
        store.createIndex("by-status", "status");
      }

      if (!database.objectStoreNames.contains("cachedEventConfig")) {
        database.createObjectStore("cachedEventConfig", {
          keyPath: "eventId",
        });
      }
    },
  });
}

export async function enqueueScoreOperation(operation: OutboxOperation) {
  const database = await getClientDatabase();
  await database.put("outbox", operation);
}

export async function listPendingOperations() {
  const database = await getClientDatabase();
  const all = await database.getAllFromIndex("outbox", "by-status", "pending");
  // Sort by createdAt (ISO string) so multiple edits to the same cell always
  // arrive at the server in the order the judge made them.
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listConflictOperations() {
  const database = await getClientDatabase();
  return database.getAllFromIndex("outbox", "by-status", "conflict");
}

export async function updateOperation(operation: OutboxOperation) {
  const database = await getClientDatabase();
  await database.put("outbox", operation);
}

export async function deleteOperation(localId: string) {
  const database = await getClientDatabase();
  await database.delete("outbox", localId);
}

/**
 * Clears already-stuck "conflict" operations that were rejected because the set
 * was locked/finalized. These aren't data loss — the persisted score stands —
 * and they can never succeed, so they'd otherwise nag "score not saved" forever.
 * Returns how many were removed.
 */
export async function discardLockedConflicts() {
  const database = await getClientDatabase();
  const conflicts = await database.getAllFromIndex("outbox", "by-status", "conflict");
  const locked = conflicts.filter((op) =>
    /lock|finalized this set/i.test(op.lastError ?? ""),
  );
  await Promise.all(locked.map((op) => database.delete("outbox", op.localId)));
  return locked.length;
}
