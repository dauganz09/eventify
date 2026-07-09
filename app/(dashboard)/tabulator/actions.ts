"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { events, judges, judgeSetSubmissions, roundGroups, rounds, unlockRequests } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/context";
import { deleteAllJudgeSessions } from "@/lib/auth/judge-session";
import { publishEvent, publishResultsUpdated } from "@/lib/realtime/bus";
import { saveManualScores } from "@/lib/scoring/manual-entry-service";
import {
  resetRoundGroupScores,
} from "@/lib/scoring/score-reset-service";
import {
  recalculateAggregateResults,
  snapshotAdvancementQualifiers,
} from "@/lib/scoring/tabulator-service";

type Lifecycle = "idle" | "active" | "finished";

function parseStatus(value: unknown): Lifecycle {
  const status = String(value ?? "");
  if (status === "idle" || status === "active" || status === "finished") return status;
  throw new Error("Invalid status.");
}

/**
 * Broadcast a presentation reveal step so every open "Present" screen (e.g. the
 * projector and the operator's laptop) stays in sync. `revealed` is the number
 * of placements unveiled so far, counting up from last place.
 */
export async function setPresentationRevealAction(input: {
  eventId: string;
  revealed: number;
}) {
  const context = await requirePermission("score.review");
  await assertEventInOrg(input.eventId, context.organization.id);
  publishEvent(input.eventId, {
    type: "present.reveal",
    revealed: Math.max(0, Math.floor(input.revealed)),
  });
}

/** Confirms an event belongs to the caller's org; returns its id. */
async function assertEventInOrg(eventId: string, organizationId: string) {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.organizationId, organizationId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);

  if (!row) throw new Error("Event not found.");
  return row.id;
}

/**
 * Set a single set's (round's) lifecycle status.
 *
 * Invariant: at most ONE set and ONE round group may be "active" per event.
 * Activating requires no other active set / round group — the tabulator must
 * deactivate or finish the current one first. `isLocked` mirrors the status so
 * the score pipeline's lock guard keeps working (locked unless active).
 */
export async function setSetStatusAction(formData: FormData) {
  const context = await requirePermission("score.adjust");

  const setId = String(formData.get("setId") ?? "");
  const status = parseStatus(formData.get("status"));
  if (!setId) throw new Error("Missing set.");

  const eventId = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        eventId: rounds.eventId,
        groupId: rounds.roundGroupId,
        organizationId: events.organizationId,
      })
      .from(rounds)
      .innerJoin(events, eq(events.id, rounds.eventId))
      .where(and(eq(rounds.id, setId), eq(events.organizationId, context.organization.id)))
      .limit(1);

    if (!target) throw new Error("Set not found.");

    if (status === "active") {
      const [otherActiveSet] = await tx
        .select({ id: rounds.id })
        .from(rounds)
        .where(
          and(
            eq(rounds.eventId, target.eventId),
            eq(rounds.status, "active"),
            ne(rounds.id, setId),
          ),
        )
        .limit(1);
      if (otherActiveSet) {
        throw new Error("Another set is active. Deactivate or finish it first.");
      }

      const [otherActiveGroup] = await tx
        .select({ id: roundGroups.id })
        .from(roundGroups)
        .where(
          and(
            eq(roundGroups.eventId, target.eventId),
            eq(roundGroups.status, "active"),
            target.groupId ? ne(roundGroups.id, target.groupId) : undefined,
          ),
        )
        .limit(1);
      if (otherActiveGroup) {
        throw new Error("Another round is active. Deactivate or finish it first.");
      }

      // Activating a set implies its parent round is the active round.
      if (target.groupId) {
        const [parentGroup] = await tx
          .select({ status: roundGroups.status })
          .from(roundGroups)
          .where(eq(roundGroups.id, target.groupId))
          .limit(1);

        // Snapshot the top-N qualifiers when the round BECOMES active (not on
        // set switches within an already-active round).
        if (parentGroup && parentGroup.status !== "active") {
          const snapshot = await snapshotAdvancementQualifiers({
            database: tx as unknown as typeof db,
            eventId: target.eventId,
            groupId: target.groupId,
          });
          if (snapshot) {
            await writeAuditLog({
              database: tx as unknown as typeof db,
              organizationId: context.organization.id,
              eventId: target.eventId,
              actorUserId: context.userId,
              action: "round.advancement_snapshot",
              entityType: "round_group",
              entityId: target.groupId,
              metadata: {
                qualifiedContestantIds: snapshot.qualifiedIds,
                standings: snapshot.standings.map((row) => ({
                  contestantId: row.contestantId,
                  overall: row.overall,
                  rank: row.rank,
                })),
              },
            });
          }
        }

        await tx
          .update(roundGroups)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(roundGroups.id, target.groupId));
      }
    }

    await tx
      .update(rounds)
      .set({ status, isLocked: status !== "active", updatedAt: new Date() })
      .where(eq(rounds.id, setId));

    return target.eventId;
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: `set.${status}`,
    entityType: "round",
    entityId: setId,
    metadata: { source: "tabulator", status },
  });

  // Stage 2 will consume this on judge screens (standby / auto-switch).
  publishEvent(eventId, { type: "round.changed", scope: "set", id: setId, status });

  revalidatePath(`/tabulator/${eventId}`);
}

/** Set a round group's ("round"s) lifecycle status. */
export async function setRoundStatusAction(formData: FormData) {
  const context = await requirePermission("score.adjust");

  const groupId = String(formData.get("groupId") ?? "");
  const status = parseStatus(formData.get("status"));
  if (!groupId) throw new Error("Missing round.");

  const eventId = await db.transaction(async (tx) => {
    const [group] = await tx
      .select({ eventId: roundGroups.eventId, status: roundGroups.status })
      .from(roundGroups)
      .innerJoin(events, eq(events.id, roundGroups.eventId))
      .where(
        and(eq(roundGroups.id, groupId), eq(events.organizationId, context.organization.id)),
      )
      .limit(1);

    if (!group) throw new Error("Round not found.");

    if (status === "active") {
      const [otherActiveGroup] = await tx
        .select({ id: roundGroups.id })
        .from(roundGroups)
        .where(
          and(
            eq(roundGroups.eventId, group.eventId),
            eq(roundGroups.status, "active"),
            ne(roundGroups.id, groupId),
          ),
        )
        .limit(1);
      if (otherActiveGroup) {
        throw new Error("Another round is active. Deactivate or finish it first.");
      }

      // Advancement-restricted rounds snapshot their top-N qualifiers when
      // they become active. Re-activating recomputes the snapshot.
      if (group.status !== "active") {
        const snapshot = await snapshotAdvancementQualifiers({
          database: tx as unknown as typeof db,
          eventId: group.eventId,
          groupId,
        });
        if (snapshot) {
          await writeAuditLog({
            database: tx as unknown as typeof db,
            organizationId: context.organization.id,
            eventId: group.eventId,
            actorUserId: context.userId,
            action: "round.advancement_snapshot",
            entityType: "round_group",
            entityId: groupId,
            metadata: {
              qualifiedContestantIds: snapshot.qualifiedIds,
              standings: snapshot.standings.map((row) => ({
                contestantId: row.contestantId,
                overall: row.overall,
                rank: row.rank,
              })),
            },
          });
        }
      }
    }

    await tx
      .update(roundGroups)
      .set({ status, updatedAt: new Date() })
      .where(eq(roundGroups.id, groupId));

    // Deactivating / finishing a round closes all of its sets too.
    if (status !== "active") {
      await tx
        .update(rounds)
        .set({ status, isLocked: true, updatedAt: new Date() })
        .where(eq(rounds.roundGroupId, groupId));
    }

    return group.eventId;
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: `round.${status}`,
    entityType: "round_group",
    entityId: groupId,
    metadata: { source: "tabulator", status },
  });

  publishEvent(eventId, { type: "round.changed", scope: "group", id: groupId, status });

  revalidatePath(`/tabulator/${eventId}`);
}

/**
 * Finish a round group and, in the same transaction, record which of its sets
 * should carry their totals forward into subsequent active rounds. This is what
 * the Finish-round modal posts after the tabulator answers the two questions
 * (carry over? whole round or pick).
 *
 * `carryOverSetIds` is the authoritative list of sets to flag — anything not in
 * the list is set to carryOver=false. Pass an empty array for "don't carry".
 */
export async function finishRoundWithCarryOverAction(input: {
  groupId: string;
  carryOverSetIds: string[];
}) {
  const context = await requirePermission("score.adjust");

  if (!input.groupId) throw new Error("Missing round.");

  const carrySet = new Set(input.carryOverSetIds);

  const eventId = await db.transaction(async (tx) => {
    const [group] = await tx
      .select({ eventId: roundGroups.eventId })
      .from(roundGroups)
      .innerJoin(events, eq(events.id, roundGroups.eventId))
      .where(
        and(
          eq(roundGroups.id, input.groupId),
          eq(events.organizationId, context.organization.id),
        ),
      )
      .limit(1);

    if (!group) throw new Error("Round not found.");

    const setRows = await tx
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.roundGroupId, input.groupId));

    const validIds = new Set(setRows.map((s) => s.id));
    for (const id of carrySet) {
      if (!validIds.has(id)) {
        throw new Error("Selected set is not in this round.");
      }
    }

    // Finish the group itself.
    await tx
      .update(roundGroups)
      .set({ status: "finished", updatedAt: new Date() })
      .where(eq(roundGroups.id, input.groupId));

    // Finish every set in the group and stamp per-set carryOver flags.
    // Two updates is simpler than a CASE expression and only affects a handful
    // of rows (a single round's sets).
    if (carrySet.size > 0) {
      await tx
        .update(rounds)
        .set({
          status: "finished",
          isLocked: true,
          carryOverScores: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(rounds.roundGroupId, input.groupId),
            inArray(rounds.id, Array.from(carrySet)),
          ),
        );
    }
    const nonCarry = setRows.map((s) => s.id).filter((id) => !carrySet.has(id));
    if (nonCarry.length > 0) {
      await tx
        .update(rounds)
        .set({
          status: "finished",
          isLocked: true,
          carryOverScores: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(rounds.roundGroupId, input.groupId),
            inArray(rounds.id, nonCarry),
          ),
        );
    }

    return group.eventId;
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "round.finished",
    entityType: "round_group",
    entityId: input.groupId,
    metadata: {
      source: "tabulator",
      carryOverSetIds: input.carryOverSetIds,
      carryOverCount: input.carryOverSetIds.length,
    },
  });

  publishEvent(eventId, {
    type: "round.changed",
    scope: "group",
    id: input.groupId,
    status: "finished",
  });

  revalidatePath(`/tabulator/${eventId}`);
}

/**
 * Send a realtime reminder/message to a single judge (toast-only, not persisted).
 * Published over the event's SSE channel; the judge workspace filters by judgeId.
 */
export async function sendJudgeReminderAction(input: {
  eventId: string;
  judgeId: string;
  message: string;
}) {
  const context = await requirePermission("score.review");

  const message = input.message.trim();
  if (!message) throw new Error("Message is empty.");
  if (message.length > 500) throw new Error("Message is too long.");

  // Confirm the judge belongs to an event owned by the caller's org.
  const [judge] = await db
    .select({ id: judges.id, eventId: judges.eventId })
    .from(judges)
    .innerJoin(events, eq(events.id, judges.eventId))
    .where(
      and(
        eq(judges.id, input.judgeId),
        eq(judges.eventId, input.eventId),
        eq(events.organizationId, context.organization.id),
      ),
    )
    .limit(1);

  if (!judge) throw new Error("Judge not found.");

  publishEvent(input.eventId, {
    type: "judge.reminder",
    judgeId: input.judgeId,
    message,
    sentAt: new Date().toISOString(),
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId: input.eventId,
    actorUserId: context.userId,
    action: "judge.reminded",
    entityType: "judge",
    entityId: input.judgeId,
    metadata: { source: "tabulator", message },
  });
}

/**
 * Force-release a judge's session(s) — the admin override for the single-active-
 * session rule. Deletes every session row for the judge so they can sign in
 * fresh, and publishes a realtime revoke so any device currently signed in is
 * kicked to the login screen immediately. Audited.
 */
export async function releaseJudgeSessionAction(input: {
  eventId: string;
  judgeId: string;
}) {
  const context = await requirePermission("score.adjust");

  // Confirm the judge belongs to an event owned by the caller's org.
  const [judge] = await db
    .select({ id: judges.id })
    .from(judges)
    .innerJoin(events, eq(events.id, judges.eventId))
    .where(
      and(
        eq(judges.id, input.judgeId),
        eq(judges.eventId, input.eventId),
        eq(events.organizationId, context.organization.id),
      ),
    )
    .limit(1);

  if (!judge) throw new Error("Judge not found.");

  await deleteAllJudgeSessions(db, input.judgeId);

  publishEvent(input.eventId, {
    type: "judge.session.revoked",
    judgeId: input.judgeId,
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId: input.eventId,
    actorUserId: context.userId,
    action: "judge.session_released",
    entityType: "judge",
    entityId: input.judgeId,
    metadata: { source: "tabulator" },
  });

  revalidatePath(`/tabulator/${input.eventId}`);
}

/**
 * Release a judge's "submit & lock" on a set so they can edit again. Deletes
 * the judge_set_submissions row and notifies both the judge (to unlock their
 * UI) and the tabulator console.
 */
export async function releaseSetFinalizationAction(input: {
  eventId: string;
  judgeId: string;
  roundId: string;
}) {
  const context = await requirePermission("score.adjust");

  // Confirm the set belongs to an event in the caller's org.
  const [round] = await db
    .select({ id: rounds.id })
    .from(rounds)
    .innerJoin(events, eq(events.id, rounds.eventId))
    .where(
      and(
        eq(rounds.id, input.roundId),
        eq(rounds.eventId, input.eventId),
        eq(events.organizationId, context.organization.id),
      ),
    )
    .limit(1);
  if (!round) throw new Error("Set not found.");

  await db
    .delete(judgeSetSubmissions)
    .where(
      and(
        eq(judgeSetSubmissions.judgeId, input.judgeId),
        eq(judgeSetSubmissions.roundId, input.roundId),
      ),
    );

  publishEvent(input.eventId, {
    type: "judge.finalized",
    judgeId: input.judgeId,
    roundId: input.roundId,
    finalized: false,
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId: input.eventId,
    actorUserId: context.userId,
    action: "judge.set_lock_released",
    entityType: "round",
    entityId: input.roundId,
    metadata: { source: "tabulator", judgeId: input.judgeId },
  });

  revalidatePath(`/tabulator/${input.eventId}`);
}

/**
 * Send the same reminder to many judges at once (e.g. "Remind all active" or a
 * picked subset). Validates every judgeId belongs to an event in the caller's
 * org, then publishes one realtime event per judge over the SSE channel. Audit
 * logs one row per delivery.
 */
export async function sendJudgeBulkReminderAction(input: {
  eventId: string;
  judgeIds: string[];
  message: string;
}) {
  const context = await requirePermission("score.review");

  const message = input.message.trim();
  if (!message) throw new Error("Message is empty.");
  if (message.length > 500) throw new Error("Message is too long.");

  const judgeIds = Array.from(new Set(input.judgeIds)).filter(Boolean);
  if (judgeIds.length === 0) throw new Error("No judges selected.");
  if (judgeIds.length > 200) throw new Error("Too many judges in one batch.");

  // Confirm every judge belongs to the same event in the caller's org.
  const rows = await db
    .select({ id: judges.id })
    .from(judges)
    .innerJoin(events, eq(events.id, judges.eventId))
    .where(
      and(
        eq(judges.eventId, input.eventId),
        eq(events.organizationId, context.organization.id),
        inArray(judges.id, judgeIds),
      ),
    );

  if (rows.length !== judgeIds.length) {
    throw new Error("Some judges were not found.");
  }

  const sentAt = new Date().toISOString();
  for (const judgeId of judgeIds) {
    publishEvent(input.eventId, {
      type: "judge.reminder",
      judgeId,
      message,
      sentAt,
    });
    await writeAuditLog({
      database: db,
      organizationId: context.organization.id,
      eventId: input.eventId,
      actorUserId: context.userId,
      action: "judge.reminded",
      entityType: "judge",
      entityId: judgeId,
      metadata: { source: "tabulator", message, batchSize: judgeIds.length },
    });
  }

  return { delivered: judgeIds.length };
}

/**
 * Approve a judge's unlock request: deletes their judgeSetSubmissions row so
 * they can edit scores again, marks the request as approved, and notifies
 * both the judge and the tabulator console via realtime.
 */
export async function approveUnlockRequestAction(input: {
  eventId: string;
  judgeId: string;
  roundId: string;
  requestId: string;
}) {
  const context = await requirePermission("score.adjust");

  const [round] = await db
    .select({ id: rounds.id })
    .from(rounds)
    .innerJoin(events, eq(events.id, rounds.eventId))
    .where(
      and(
        eq(rounds.id, input.roundId),
        eq(rounds.eventId, input.eventId),
        eq(events.organizationId, context.organization.id),
      ),
    )
    .limit(1);
  if (!round) throw new Error("Set not found.");

  await db.transaction(async (tx) => {
    await tx
      .delete(judgeSetSubmissions)
      .where(
        and(
          eq(judgeSetSubmissions.judgeId, input.judgeId),
          eq(judgeSetSubmissions.roundId, input.roundId),
        ),
      );

    await tx
      .update(unlockRequests)
      .set({ status: "approved", resolvedAt: new Date(), resolvedBy: context.userId })
      .where(eq(unlockRequests.id, input.requestId));
  });

  publishEvent(input.eventId, {
    type: "judge.finalized",
    judgeId: input.judgeId,
    roundId: input.roundId,
    finalized: false,
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId: input.eventId,
    actorUserId: context.userId,
    action: "judge.unlock_approved",
    entityType: "round",
    entityId: input.roundId,
    metadata: { source: "tabulator", judgeId: input.judgeId, requestId: input.requestId },
  });

  revalidatePath(`/tabulator/${input.eventId}`);
}

/**
 * Reject a judge's unlock request without releasing the lock.
 */
export async function rejectUnlockRequestAction(input: {
  eventId: string;
  judgeId: string;
  roundId: string;
  requestId: string;
}) {
  const context = await requirePermission("score.adjust");

  await db
    .update(unlockRequests)
    .set({ status: "rejected", resolvedAt: new Date(), resolvedBy: context.userId })
    .where(eq(unlockRequests.id, input.requestId));

  publishEvent(input.eventId, {
    type: "judge.unlock_rejected",
    judgeId: input.judgeId,
    roundId: input.roundId,
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId: input.eventId,
    actorUserId: context.userId,
    action: "judge.unlock_rejected",
    entityType: "round",
    entityId: input.roundId,
    metadata: { source: "tabulator", judgeId: input.judgeId, requestId: input.requestId },
  });

  revalidatePath(`/tabulator/${input.eventId}`);
}

/**
 * Save tabulator-entered scores for a manual-entry (pre-event) category. Writes
 * each cell through the normal audited score pipeline attributed to the event's
 * system judge, then refreshes the tabulator and any live result views.
 */
export async function saveManualScoresAction(input: {
  eventId: string;
  setId: string;
  scores: { contestantId: string; criterionId: string; value: number }[];
}) {
  const context = await requirePermission("score.adjust");
  await assertEventInOrg(input.eventId, context.organization.id);

  if (!input.setId) throw new Error("Missing set.");
  if (input.scores.length === 0) return { saved: 0 };
  if (input.scores.length > 2_000) {
    throw new Error("Too many scores in one batch.");
  }

  const { saved } = await saveManualScores({
    database: db,
    organizationId: context.organization.id,
    actorUserId: context.userId,
    eventId: input.eventId,
    setId: input.setId,
    scores: input.scores,
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId: input.eventId,
    actorUserId: context.userId,
    action: "manual.scores_saved",
    entityType: "round",
    entityId: input.setId,
    metadata: { source: "tabulator", count: saved },
  });

  publishResultsUpdated(input.eventId);
  revalidatePath(`/tabulator/${input.eventId}`);

  return { saved };
}

export async function recalculateResultsAction(formData: FormData) {
  const context = await requirePermission("score.review");

  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId) throw new Error("Missing event.");

  await assertEventInOrg(eventId, context.organization.id);

  const written = await recalculateAggregateResults({ database: db, eventId });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "results.recalculated",
    entityType: "event",
    entityId: eventId,
    metadata: { source: "tabulator", rowsWritten: written },
  });

  revalidatePath(`/tabulator/${eventId}`);
}

/**
 * Clears every score, submission, and unlock request scoped to one round group,
 * resets that round and its sets to idle, and recalculates cached standings.
 */
export async function clearRoundScoresAction(groupId: string) {
  const context = await requirePermission("score.adjust");
  if (!groupId) throw new Error("Missing round.");

  const result = await resetRoundGroupScores({
    database: db,
    organizationId: context.organization.id,
    groupId,
  });

  const summary = await db
    .select({ eventId: roundGroups.eventId, name: roundGroups.name })
    .from(roundGroups)
    .innerJoin(events, eq(events.id, roundGroups.eventId))
    .where(
      and(
        eq(roundGroups.id, groupId),
        eq(events.organizationId, context.organization.id),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (!summary) throw new Error("Round not found.");

  await recalculateAggregateResults({
    database: db,
    eventId: summary.eventId,
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId: summary.eventId,
    actorUserId: context.userId,
    action: "round.scores_cleared",
    entityType: "round_group",
    entityId: groupId,
    metadata: {
      source: "tabulator",
      roundName: summary.name,
      clearedScoreRecords: result.scoreRecords,
      clearedJudgeSubmissions: result.judgeSubmissions,
    },
  });

  publishResultsUpdated(summary.eventId);
  publishEvent(summary.eventId, {
    type: "round.changed",
    scope: "group",
    id: groupId,
    status: "idle",
  });
  revalidatePath(`/tabulator/${summary.eventId}`);

  return result;
}
