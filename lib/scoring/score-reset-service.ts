import { and, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
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

export interface RoundScoreSummary {
  groupId: string;
  groupName: string;
  eventId: string;
  setIds: string[];
  scoreRecords: number;
  judgeSubmissions: number;
  pendingUnlockRequests: number;
  hasData: boolean;
}

async function assertRoundGroupInOrg(params: {
  database: typeof db;
  organizationId: string;
  groupId: string;
}) {
  const { database, organizationId, groupId } = params;

  const [group] = await database
    .select({
      id: roundGroups.id,
      name: roundGroups.name,
      eventId: roundGroups.eventId,
    })
    .from(roundGroups)
    .innerJoin(events, eq(events.id, roundGroups.eventId))
    .where(
      and(
        eq(roundGroups.id, groupId),
        eq(events.organizationId, organizationId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);

  if (!group) throw new Error("Round not found.");
  return group;
}

/**
 * Counts scoring artifacts scoped to one round group (all of its sets) so the
 * tabulator can confirm what will be removed.
 */
export async function getRoundGroupScoreSummary(params: {
  database: typeof db;
  organizationId: string;
  groupId: string;
}): Promise<RoundScoreSummary> {
  const { database, organizationId, groupId } = params;
  const group = await assertRoundGroupInOrg({ database, organizationId, groupId });

  const setRows = await database
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.roundGroupId, groupId));
  const setIds = setRows.map((row) => row.id);

  if (setIds.length === 0) {
    return {
      groupId: group.id,
      groupName: group.name,
      eventId: group.eventId,
      setIds,
      scoreRecords: 0,
      judgeSubmissions: 0,
      pendingUnlockRequests: 0,
      hasData: false,
    };
  }

  const [[records], [submissions], [unlocks]] = await Promise.all([
    database
      .select({ value: count() })
      .from(scoreRecords)
      .where(
        and(
          eq(scoreRecords.eventId, group.eventId),
          inArray(scoreRecords.roundId, setIds),
        ),
      ),
    database
      .select({ value: count() })
      .from(judgeSetSubmissions)
      .where(
        and(
          eq(judgeSetSubmissions.eventId, group.eventId),
          inArray(judgeSetSubmissions.roundId, setIds),
        ),
      ),
    database
      .select({ value: count() })
      .from(unlockRequests)
      .where(
        and(
          eq(unlockRequests.eventId, group.eventId),
          inArray(unlockRequests.roundId, setIds),
          eq(unlockRequests.status, "pending"),
        ),
      ),
  ]);

  const scoreRecordCount = records?.value ?? 0;
  const submissionCount = submissions?.value ?? 0;
  const unlockCount = unlocks?.value ?? 0;

  return {
    groupId: group.id,
    groupName: group.name,
    eventId: group.eventId,
    setIds,
    scoreRecords: scoreRecordCount,
    judgeSubmissions: submissionCount,
    pendingUnlockRequests: unlockCount,
    hasData: scoreRecordCount > 0 || submissionCount > 0 || unlockCount > 0,
  };
}

/**
 * Clears every score artifact scoped to one round group, resets that round and
 * its sets back to idle, and drops any qualifier snapshot taken for it.
 */
export async function resetRoundGroupScores(params: {
  database: typeof db;
  organizationId: string;
  groupId: string;
}): Promise<ScoreResetResult> {
  const { database, organizationId, groupId } = params;
  const summary = await getRoundGroupScoreSummary({
    database,
    organizationId,
    groupId,
  });

  if (summary.setIds.length === 0) {
    return {
      scoreRecords: 0,
      scoreEvents: 0,
      judgeSubmissions: 0,
    };
  }

  const { eventId, setIds } = summary;
  const setFilter = inArray(scoreRecords.roundId, setIds);

  let deletedScoreEvents = 0;
  const [scoreEventCount] = await database
    .select({ value: count() })
    .from(scoreEvents)
    .where(and(eq(scoreEvents.eventId, eventId), inArray(scoreEvents.roundId, setIds)));
  deletedScoreEvents = scoreEventCount?.value ?? 0;

  await database.transaction(async (tx) => {
    await tx
      .delete(scoreEvents)
      .where(and(eq(scoreEvents.eventId, eventId), inArray(scoreEvents.roundId, setIds)));
    await tx
      .delete(scoreRecords)
      .where(and(eq(scoreRecords.eventId, eventId), setFilter));
    await tx
      .delete(aggregateResults)
      .where(and(eq(aggregateResults.eventId, eventId), inArray(aggregateResults.roundId, setIds)));
    await tx
      .delete(judgeSetSubmissions)
      .where(
        and(
          eq(judgeSetSubmissions.eventId, eventId),
          inArray(judgeSetSubmissions.roundId, setIds),
        ),
      );
    await tx
      .delete(unlockRequests)
      .where(
        and(eq(unlockRequests.eventId, eventId), inArray(unlockRequests.roundId, setIds)),
      );

    if (setIds.length > 0) {
      await tx.delete(syncOperations).where(
        and(
          eq(syncOperations.eventId, eventId),
          or(...setIds.map((setId) => sql`${syncOperations.payload}->>'roundId' = ${setId}`)),
        ),
      );
    }

    await tx
      .update(roundGroups)
      .set({ status: "idle", qualifiedContestantIds: null, updatedAt: new Date() })
      .where(eq(roundGroups.id, groupId));
    await tx
      .update(rounds)
      .set({ status: "idle", isLocked: false, updatedAt: new Date() })
      .where(eq(rounds.roundGroupId, groupId));
  });

  return {
    scoreRecords: summary.scoreRecords,
    scoreEvents: deletedScoreEvents,
    judgeSubmissions: summary.judgeSubmissions,
  };
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
