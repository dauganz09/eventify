"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestants, criteria, events, judges, roundGroups, rounds } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/context";
import { parseRoundScoreMode, parseTieBreak } from "@/lib/scoring/ranking";
import { upsertCriterion, deleteCriterion, copyCriteriaToRound } from "@/lib/events/criterion-service";
import {
  archiveContestant,
  deleteContestant,
  upsertContestant,
} from "@/lib/events/contestant-service";
import { updateEvent, updateEventStatus } from "@/lib/events/event-service";
import {
  assignJudge,
  deleteJudge,
  upsertJudge,
} from "@/lib/events/judge-service";
import { getEventReadiness } from "@/lib/events/readiness";
import {
  deleteRoundGroup,
  listRoundGroups,
  upsertRoundGroup,
} from "@/lib/events/round-group-service";
import { deleteRound, setRoundLocked, upsertRound } from "@/lib/events/round-service";
import {
  deleteScoringRule,
  upsertScoringRule,
} from "@/lib/events/scoring-rule-service";
import { resetEventScores } from "@/lib/scoring/score-reset-service";

/** Persist the event's tie-break method into events.config (merge, not replace). */
export async function setTieBreakAction(formData: FormData) {
  const context = await requirePermission("event.manage");
  const eventId = String(formData.get("eventId") ?? "");
  const tieBreak = parseTieBreak(formData.get("tieBreak"));
  if (!eventId) throw new Error("Missing event.");

  const [row] = await db
    .select({ config: events.config })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, context.organization.id)))
    .limit(1);
  if (!row) throw new Error("Event not found.");

  const nextConfig = { ...(row.config as Record<string, unknown>), tieBreak };
  await db
    .update(events)
    .set({ config: nextConfig, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), eq(events.organizationId, context.organization.id)));

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "event.tiebreak_updated",
    entityType: "event",
    entityId: eventId,
    metadata: { tieBreak },
  });

  revalidatePath(`/events/${eventId}/builder/scoring-rules`);
}

/**
 * Persist how a round's total is derived from its set totals into
 * events.config (merge, not replace): "average" (default) or "sum" —
 * points-based events where set points add up (e.g. 10 + 10 + 10 = 30).
 */
export async function setRoundScoreModeAction(formData: FormData) {
  const context = await requirePermission("event.manage");
  const eventId = String(formData.get("eventId") ?? "");
  const roundScoreMode = parseRoundScoreMode(formData.get("roundScoreMode"));
  if (!eventId) throw new Error("Missing event.");

  const [row] = await db
    .select({ config: events.config })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, context.organization.id)))
    .limit(1);
  if (!row) throw new Error("Event not found.");

  const nextConfig = { ...(row.config as Record<string, unknown>), roundScoreMode };
  await db
    .update(events)
    .set({ config: nextConfig, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), eq(events.organizationId, context.organization.id)));

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "event.round_score_mode_updated",
    entityType: "event",
    entityId: eventId,
    metadata: { roundScoreMode },
  });

  revalidatePath(`/events/${eventId}/builder/scoring-rules`);
}

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  if (value == null || typeof value !== "string") return undefined;
  return value.trim() === "" ? undefined : value;
}

function formString(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value : fallback;
}

function revalidateBuilder(eventId: string) {
  revalidatePath(`/events/${eventId}/builder/details`);
  revalidatePath(`/events/${eventId}/builder/rounds`);
  revalidatePath(`/events/${eventId}/builder/contestants`);
  revalidatePath(`/events/${eventId}/builder/judges`);
  revalidatePath(`/events/${eventId}/builder/criteria`);
  revalidatePath(`/events/${eventId}/builder/scoring-rules`);
  revalidatePath(`/events/${eventId}/builder/readiness`);
  revalidatePath("/events");
}

async function audit(
  context: Awaited<ReturnType<typeof requirePermission>>,
  action: string,
  eventId: string,
  metadata?: Record<string, unknown>,
  entity?: { type: string; id?: string },
) {
  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action,
    entityType: entity?.type ?? "event",
    entityId: entity?.id ?? eventId,
    metadata: metadata ?? {},
  });
}

export async function updateEventDetailsAction(eventId: string, formData: FormData) {
  const context = await requirePermission("event.manage");

  await updateEvent({
    database: db,
    organizationId: context.organization.id,
    input: {
      eventId,
      name: formString(formData, "name"),
      description: formValue(formData, "description"),
      logoUrl: formValue(formData, "logoUrl") ?? null,
      venue: formValue(formData, "venue"),
      timezone: formString(formData, "timezone", "UTC"),
      contestantDisplayMode: formString(formData, "contestantDisplayMode", "one-at-a-time"),
      startsAt: formValue(formData, "startsAt") ?? null,
      endsAt: formValue(formData, "endsAt") ?? null,
    },
  });

  await audit(context, "event.updated", eventId);
  revalidateBuilder(eventId);
}

export async function saveRoundGroupAction(eventId: string, formData: FormData) {
  const context = await requirePermission("event.manage");

  const thisId = formValue(formData, "roundGroupId");
  const thisCarryOver = formData.get("carryOverScores") === "on";
  const thisWeight = Number(formData.get("carryOverWeight") ?? 100);

  // In "average" mode each round's weight is a share of the final score, so
  // carry-over weights can't OVER-allocate past 100% (reaching exactly 100% is
  // enforced later by the readiness check). In "sum" (points-based) mode every
  // round carries its full points at 100% weight, so no cap applies.
  if (thisCarryOver) {
    const [eventRow] = await db
      .select({ config: events.config })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.organizationId, context.organization.id)))
      .limit(1);
    const roundScoreMode = parseRoundScoreMode(
      (eventRow?.config as Record<string, unknown> | null)?.roundScoreMode,
    );
    if (roundScoreMode !== "sum") {
      const existing = await listRoundGroups({
        database: db,
        eventId,
        organizationId: context.organization.id,
      });
      const otherSum = existing
        .filter((g) => g.carryOverScores && g.id !== thisId)
        .reduce((s, g) => s + g.carryOverWeight, 0);
      if (otherSum + thisWeight > 100) {
        throw new Error(
          `Carry-over weights can't exceed 100%. Other rounds already use ${otherSum}%, so this round can be at most ${100 - otherSum}%.`,
        );
      }
    }
  }

  const group = await upsertRoundGroup({
    database: db,
    organizationId: context.organization.id,
    input: {
      eventId,
      roundGroupId: thisId,
      name: formString(formData, "name"),
      description: formValue(formData, "description"),
      position: formValue(formData, "position") ?? 0,
      carryOverScores: thisCarryOver,
      carryOverWeight: thisWeight,
      advanceCount: formValue(formData, "advanceCount"),
      advanceDisplayOrder: formValue(formData, "advanceDisplayOrder") ?? "number",
      scoringMethod: formValue(formData, "scoringMethod") ?? "points",
    },
  });

  await audit(
    context,
    thisId ? "round_group.updated" : "round_group.created",
    eventId,
    group
      ? {
          name: group.name,
          carryOverScores: group.carryOverScores,
          carryOverWeight: group.carryOverWeight,
          advanceCount: group.advanceCount,
          scoringMethod: group.scoringMethod,
        }
      : {},
    { type: "round_group", id: group?.id ?? thisId },
  );
  revalidateBuilder(eventId);
}

export async function deleteRoundGroupAction(eventId: string, roundGroupId: string) {
  const context = await requirePermission("event.manage");
  const [snapshot] = await db
    .select({ name: roundGroups.name, position: roundGroups.position })
    .from(roundGroups)
    .where(and(eq(roundGroups.id, roundGroupId), eq(roundGroups.eventId, eventId)))
    .limit(1);
  await deleteRoundGroup({ database: db, organizationId: context.organization.id, eventId, roundGroupId });
  await audit(context, "round_group.deleted", eventId, { deleted: snapshot ?? null }, {
    type: "round_group",
    id: roundGroupId,
  });
  revalidateBuilder(eventId);
}

export async function saveRoundAction(eventId: string, formData: FormData) {
  const context = await requirePermission("event.manage");

  const thisId = formValue(formData, "roundId");
  const round = await upsertRound({
    database: db,
    organizationId: context.organization.id,
    input: {
      eventId,
      roundId: thisId,
      roundGroupId: formValue(formData, "roundGroupId"),
      name: formString(formData, "name"),
      description: formValue(formData, "description"),
      position: formValue(formData, "position") ?? 0,
      isManualEntry: formData.get("isManualEntry") === "on",
    },
  });

  await audit(
    context,
    thisId ? "set.updated" : "set.created",
    eventId,
    round
      ? { name: round.name, roundGroupId: round.roundGroupId, isManualEntry: round.isManualEntry }
      : {},
    { type: "round", id: round?.id ?? thisId },
  );
  revalidateBuilder(eventId);
}

export async function deleteRoundAction(eventId: string, roundId: string) {
  const context = await requirePermission("event.manage");
  const [snapshot] = await db
    .select({ name: rounds.name, roundGroupId: rounds.roundGroupId })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.eventId, eventId)))
    .limit(1);
  await deleteRound({ database: db, organizationId: context.organization.id, eventId, roundId });
  await audit(context, "set.deleted", eventId, { deleted: snapshot ?? null }, {
    type: "round",
    id: roundId,
  });
  revalidateBuilder(eventId);
}

export async function toggleRoundLockAction(eventId: string, roundId: string, isLocked: boolean) {
  const context = await requirePermission("event.manage");
  await setRoundLocked({ database: db, organizationId: context.organization.id, eventId, roundId, isLocked });
  await audit(context, isLocked ? "set.locked" : "set.unlocked", eventId, { source: "builder" }, {
    type: "round",
    id: roundId,
  });
  revalidateBuilder(eventId);
}

export async function saveContestantAction(eventId: string, formData: FormData) {
  const context = await requirePermission("event.manage");

  const thisContestantId = formValue(formData, "contestantId");
  await upsertContestant({
    database: db,
    organizationId: context.organization.id,
    input: {
      eventId,
      contestantId: thisContestantId,
      displayNumber: formValue(formData, "displayNumber"),
      displayName: formString(formData, "displayName"),
      category: formValue(formData, "category"),
      division: formValue(formData, "division"),
      photoUrl: formValue(formData, "photoUrl"),
      position: formValue(formData, "position") ?? 0,
    },
  });

  await audit(
    context,
    thisContestantId ? "contestant.updated" : "contestant.created",
    eventId,
    {
      displayNumber: formValue(formData, "displayNumber") ?? null,
      displayName: formString(formData, "displayName"),
    },
    { type: "contestant", id: thisContestantId },
  );
  revalidateBuilder(eventId);
}

export async function archiveContestantAction(eventId: string, contestantId: string) {
  const context = await requirePermission("event.manage");
  await archiveContestant({ database: db, organizationId: context.organization.id, eventId, contestantId });
  await audit(context, "contestant.archived", eventId, {}, {
    type: "contestant",
    id: contestantId,
  });
  revalidateBuilder(eventId);
}

export async function deleteContestantAction(eventId: string, contestantId: string) {
  const context = await requirePermission("event.manage");
  const [snapshot] = await db
    .select({
      displayNumber: contestants.displayNumber,
      displayName: contestants.displayName,
    })
    .from(contestants)
    .where(and(eq(contestants.id, contestantId), eq(contestants.eventId, eventId)))
    .limit(1);
  await deleteContestant({ database: db, organizationId: context.organization.id, eventId, contestantId });
  await audit(context, "contestant.deleted", eventId, { deleted: snapshot ?? null }, {
    type: "contestant",
    id: contestantId,
  });
  revalidateBuilder(eventId);
}

export async function saveJudgeAction(eventId: string, formData: FormData) {
  const context = await requirePermission("event.manage");

  const judge = await upsertJudge({
    database: db,
    organizationId: context.organization.id,
    input: {
      eventId,
      judgeId: formValue(formData, "judgeId"),
      displayName: formString(formData, "displayName"),
      username: formValue(formData, "username"),
      password: formValue(formData, "password"),
      email: formValue(formData, "email"),
      isActive: formData.get("isActive") === "on",
    },
  });

  // A judge can be assigned to one or more rounds; the form submits a
  // "roundGroupId" value per selected round. No values = event-wide.
  const roundGroupIds = formData
    .getAll("roundGroupId")
    .map((v) => String(v))
    .filter((v) => v.length > 0);

  if (judge) {
    await assignJudge({
      database: db,
      organizationId: context.organization.id,
      input: {
        eventId,
        judgeId: judge.id,
        roundGroupIds,
      },
    });
  }

  await audit(
    context,
    formValue(formData, "judgeId") ? "judge.updated" : "judge.created",
    eventId,
    judge
      ? {
          displayName: judge.displayName,
          isActive: judge.isActive,
          credentialsChanged: Boolean(formValue(formData, "password")),
        }
      : {},
    { type: "judge", id: judge?.id },
  );
  revalidateBuilder(eventId);
}

export async function deleteJudgeAction(eventId: string, judgeId: string) {
  const context = await requirePermission("event.manage");
  const [snapshot] = await db
    .select({ displayName: judges.displayName, isActive: judges.isActive })
    .from(judges)
    .where(and(eq(judges.id, judgeId), eq(judges.eventId, eventId)))
    .limit(1);
  await deleteJudge({ database: db, organizationId: context.organization.id, eventId, judgeId });
  await audit(context, "judge.deleted", eventId, { deleted: snapshot ?? null }, {
    type: "judge",
    id: judgeId,
  });
  revalidateBuilder(eventId);
}

export async function saveCriterionAction(eventId: string, formData: FormData) {
  const context = await requirePermission("event.manage");

  const thisCriterionId = formValue(formData, "criterionId");
  const criterion = await upsertCriterion({
    database: db,
    organizationId: context.organization.id,
    input: {
      eventId,
      criterionId: thisCriterionId,
      roundId: formValue(formData, "roundId"),
      name: formString(formData, "name"),
      description: formValue(formData, "description"),
      inputType: formString(formData, "inputType", "decimal"),
      minValue: formValue(formData, "minValue"),
      maxValue: formValue(formData, "maxValue"),
      stepValue: formValue(formData, "stepValue"),
      weight: formValue(formData, "weight") ?? 100,
      position: formValue(formData, "position") ?? 0,
      isRequired: formData.get("isRequired") === "on",
    },
  });

  await audit(
    context,
    thisCriterionId ? "criterion.updated" : "criterion.created",
    eventId,
    criterion
      ? {
          name: criterion.name,
          roundId: criterion.roundId,
          minValue: criterion.minValue,
          maxValue: criterion.maxValue,
          weight: criterion.weight,
        }
      : {},
    { type: "criterion", id: criterion?.id ?? thisCriterionId },
  );
  revalidateBuilder(eventId);
}

export async function copyCriteriaAction(eventId: string, formData: FormData) {
  const context = await requirePermission("event.manage");

  const sourceRoundId = formValue(formData, "sourceRoundId") ?? null;
  const targetRoundId = formValue(formData, "targetRoundId") ?? null;

  if (sourceRoundId === targetRoundId) {
    throw new Error("Source and target round must be different.");
  }

  const copies = await copyCriteriaToRound({
    database: db,
    organizationId: context.organization.id,
    eventId,
    sourceRoundId,
    targetRoundId,
  });

  await audit(context, "criterion.copied", eventId, {
    sourceRoundId,
    targetRoundId,
    copied: copies.length,
  });
  revalidateBuilder(eventId);
}

export async function deleteCriterionAction(eventId: string, criterionId: string) {
  const context = await requirePermission("event.manage");
  const [snapshot] = await db
    .select({
      name: criteria.name,
      roundId: criteria.roundId,
      minValue: criteria.minValue,
      maxValue: criteria.maxValue,
      weight: criteria.weight,
    })
    .from(criteria)
    .where(and(eq(criteria.id, criterionId), eq(criteria.eventId, eventId)))
    .limit(1);
  await deleteCriterion({ database: db, organizationId: context.organization.id, eventId, criterionId });
  await audit(context, "criterion.deleted", eventId, { deleted: snapshot ?? null }, {
    type: "criterion",
    id: criterionId,
  });
  revalidateBuilder(eventId);
}

export async function saveScoringRuleAction(eventId: string, formData: FormData) {
  const context = await requirePermission("event.manage");

  const thisRuleId = formValue(formData, "ruleId");
  await upsertScoringRule({
    database: db,
    organizationId: context.organization.id,
    input: {
      eventId,
      ruleId: thisRuleId,
      roundId: formValue(formData, "roundId"),
      name: formString(formData, "name"),
      aggregation: formString(formData, "aggregation", "weighted_sum"),
    },
  });

  await audit(
    context,
    thisRuleId ? "scoring_rule.updated" : "scoring_rule.created",
    eventId,
    {
      name: formString(formData, "name"),
      aggregation: formString(formData, "aggregation", "weighted_sum"),
      roundId: formValue(formData, "roundId") ?? null,
    },
    { type: "scoring_rule", id: thisRuleId },
  );
  revalidateBuilder(eventId);
}

export async function deleteScoringRuleAction(eventId: string, ruleId: string) {
  const context = await requirePermission("event.manage");
  await deleteScoringRule({ database: db, organizationId: context.organization.id, eventId, ruleId });
  await audit(context, "scoring_rule.deleted", eventId, {}, {
    type: "scoring_rule",
    id: ruleId,
  });
  revalidateBuilder(eventId);
}

/**
 * Initializes the event for a clean start by clearing all scores, score
 * history, aggregates, judge submissions, and unlock requests, and resetting
 * the run-of-show lifecycle. Destructive — guarded by event.manage and audited.
 */
export async function resetEventScoresAction(eventId: string) {
  const context = await requirePermission("event.manage");

  const result = await resetEventScores({
    database: db,
    organizationId: context.organization.id,
    eventId,
  });

  await audit(context, "event.scores_reset", eventId, {
    clearedScoreRecords: result.scoreRecords,
    clearedJudgeSubmissions: result.judgeSubmissions,
  });

  revalidateBuilder(eventId);
  revalidatePath(`/tabulator/${eventId}`);

  return result;
}

export async function activateEventFromBuilderAction(eventId: string) {
  const context = await requirePermission("event.manage");
  const readiness = await getEventReadiness({
    database: db,
    eventId,
    organizationId: context.organization.id,
  });

  if (!readiness.isReady) {
    throw new Error("Event is not ready for activation.");
  }

  await updateEventStatus({
    database: db,
    organizationId: context.organization.id,
    input: { eventId, status: "active" },
  });

  await audit(context, "event.activated", eventId);
  revalidateBuilder(eventId);
}
