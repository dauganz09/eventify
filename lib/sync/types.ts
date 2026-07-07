import type { ScoreOperationInput } from "@/lib/validation/domain";

export type OutboxStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";

export interface OutboxOperation {
  localId: string;
  idempotencyKey: string;
  // Mirrors the validated score operation. The judge client only ever enqueues
  // "draft_saved" / "submitted"; "manual_adjustment" is server-side only, but
  // keeping this in sync with the schema type avoids drift.
  operationType: ScoreOperationInput["operation"];
  payload: ScoreOperationInput;
  status: OutboxStatus;
  retryCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CachedEventConfig {
  eventId: string;
  payload: Record<string, unknown>;
  updatedAt: string;
}
