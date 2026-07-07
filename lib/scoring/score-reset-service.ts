import { and, count, eq } from "drizzle-orm";
import type { db } from "@/db";
import {
  aggregateResults,
  events,
  judgeSetSubmissions,
  rounds,
  roundGroups,
  scoreConflicts,
  scoreEvents,
  scoreRecords,
  syncOperations,
  unlockRequests,
} from "@/db/schema";

export interface EventScoreSummary {
  scoreRecords: number;
  submittedScores: number;
  judgeSubmissions: number;
  pendingUnlockRequests: number;
  /** True when there is any scoring data or run-of-show progress to clear. */
  hasData: boolean;
}

/**
 * Counts the scoring artifacts that an initialization would wipe, so the UI can
 * show the operator exactly what exists before they confirm.
 */
export async function getEventScoreSummary(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}): Promise<EventScoreSummary> {
  const { database, organizationId, eventId } = params;

  const [event] = await database
    .select({ id: events.id })
    .from(events)
    .where(
      and(eq(events.id, eventId), eq(events.organizationId, organizationId)),
    )
    .limit(1);

  if (!event) throw new Error("Event not found.");

  const [[records], [submitted], [submissions], [unlocks]] = await Promise.all([
    database
      .select({ value: count() })
      .from(scoreRecords)
      .where(eq(scoreRecords.eventId, eventId)),
    database
      .select({ value: count() })
      .from(scoreRecords)
      .where(
        and(
          eq(scoreRecords.eventId, eventId),
          eq(scoreRecords.status, "submitted"),
        ),
      ),
    database
      .select({ value: count() })
      .from(judgeSetSubmissions)
      .where(eq(judgeSetSubmissions.eventId, eventId)),
    database
      .select({ value: count() })
      .from(unlockRequests)
      .where(eq(unlockRequests.eventId, eventId)),
  ]);

  const scoreRecordCount = records?.value ?? 0;
  const submissionCount = submissions?.value ?? 0;
  const unlockCount = unlocks?.value ?? 0;

  return {
    scoreRecords: scoreRecordCount,
    submittedScores: submitted?.value ?? 0,
    judgeSubmissions: submissionCount,
    pendingUnlockRequests: unlockCount,
    hasData: scoreRecordCount > 0 || submissionCount > 0 || unlockCount > 0,
  };
}

export interface ScoreResetResult {
  scoreRecords: number;
  scoreEvents: number;
  judgeSubmissions: number;
}

/**
 * Initializes an event for a clean start: removes every score, score-history
 * event, conflict, aggregate result, judge set-submission, unlock request, and
 * sync-dedup record scoped to the event, then resets the run-of-show lifecycle
 * (rounds and round groups back to idle, rounds unlocked). Runs in a single
 * transaction so the event is never left partially cleared.
 */
export async function resetEventScores(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}): Promise<ScoreResetResult> {
  const { database, organizationId, eventId } = params;

  const summary = await getEventScoreSummary({
    database,
    organizationId,
    eventId,
  });

  await database.transaction(async (tx) => {
    // Children first. score_conflicts → score_events (cascade) and
    // score_events → score_records (set null); deleting by event_id directly
    // keeps the intent explicit and also clears any orphaned rows.
    await tx.delete(scoreConflicts).where(eq(scoreConflicts.eventId, eventId));
    await tx.delete(scoreEvents).where(eq(scoreEvents.eventId, eventId));
    await tx.delete(scoreRecords).where(eq(scoreRecords.eventId, eventId));
    await tx
      .delete(aggregateResults)
      .where(eq(aggregateResults.eventId, eventId));
    await tx
      .delete(judgeSetSubmissions)
      .where(eq(judgeSetSubmissions.eventId, eventId));
    await tx.delete(unlockRequests).where(eq(unlockRequests.eventId, eventId));
    // Clear idempotency dedup so a fresh start can't be silently swallowed.
    await tx.delete(syncOperations).where(eq(syncOperations.eventId, eventId));

    // Reset the run-of-show so nothing is left mid-flight.
    await tx
      .update(rounds)
      .set({ status: "idle", isLocked: false, updatedAt: new Date() })
      .where(eq(rounds.eventId, eventId));
    await tx
      .update(roundGroups)
      .set({ status: "idle", updatedAt: new Date() })
      .where(eq(roundGroups.eventId, eventId));
  });

  return {
    scoreRecords: summary.scoreRecords,
    scoreEvents: 0,
    judgeSubmissions: summary.judgeSubmissions,
  };
}
