import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { contestants, criteria, events, judges, rounds } from "@/db/schema";
import { submitScoreOperation } from "@/lib/scoring/score-service";

const SYSTEM_JUDGE_NAME = "Manual entry";

/**
 * The per-event non-login "judge" that manually-entered scores are attributed
 * to. Lazily created the first time the tabulator saves a manual score. Marked
 * `isSystem` (excluded from all judge-facing UI) and `isActive: false` (kept
 * out of online counts and expected-score math for real sets).
 */
export async function getOrCreateSystemJudgeId(
  database: typeof db,
  eventId: string,
): Promise<string> {
  const [existing] = await database
    .select({ id: judges.id })
    .from(judges)
    .where(and(eq(judges.eventId, eventId), eq(judges.isSystem, true)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await database
    .insert(judges)
    .values({
      eventId,
      displayName: SYSTEM_JUDGE_NAME,
      isSystem: true,
      isActive: false,
    })
    .returning({ id: judges.id });
  return created.id;
}

export interface ManualScoreInput {
  contestantId: string;
  criterionId: string;
  value: number;
}

/**
 * Persist tabulator-entered scores for a manual-entry set. Each cell is written
 * through the normal score pipeline (`submitScoreOperation`) with the
 * `manual_adjustment` operation, so idempotency, score history and audit logs
 * all behave exactly like a judge submission — just attributed to the system
 * judge. Invalid contestant/criterion ids are skipped defensively.
 */
export async function saveManualScores(params: {
  database: typeof db;
  organizationId: string;
  actorUserId: string | null;
  eventId: string;
  setId: string;
  scores: ManualScoreInput[];
}): Promise<{ saved: number }> {
  const { database, organizationId, actorUserId, eventId, setId } = params;

  // The set must belong to this event/org AND be a manual-entry set.
  const [set] = await database
    .select({ id: rounds.id, isManualEntry: rounds.isManualEntry })
    .from(rounds)
    .innerJoin(events, eq(events.id, rounds.eventId))
    .where(
      and(
        eq(rounds.id, setId),
        eq(rounds.eventId, eventId),
        eq(events.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!set) throw new Error("Set not found.");
  if (!set.isManualEntry) {
    throw new Error("This set is not a manual-entry category.");
  }

  // Whitelist the criteria of this set and the contestants of this event so a
  // malformed payload can never write scores to unrelated rows.
  const criterionRows = await database
    .select({
      id: criteria.id,
      minValue: criteria.minValue,
      maxValue: criteria.maxValue,
    })
    .from(criteria)
    .where(eq(criteria.roundId, setId));
  const validCriteria = new Map(criterionRows.map((c) => [c.id, c]));

  const contestantRows = await database
    .select({ id: contestants.id })
    .from(contestants)
    .where(eq(contestants.eventId, eventId));
  const validContestants = new Set(contestantRows.map((c) => c.id));

  const judgeId = await getOrCreateSystemJudgeId(database, eventId);
  const clientCreatedAt = new Date().toISOString();

  let saved = 0;
  for (const score of params.scores) {
    const criterion = validCriteria.get(score.criterionId);
    if (!criterion) continue;
    if (!validContestants.has(score.contestantId)) continue;
    if (!Number.isFinite(score.value)) continue;

    // Clamp to the criterion's configured range when present.
    let value = score.value;
    if (criterion.minValue != null) value = Math.max(value, Number(criterion.minValue));
    if (criterion.maxValue != null) value = Math.min(value, Number(criterion.maxValue));

    const result = await submitScoreOperation({
      database,
      actorUserId,
      organizationId,
      input: {
        idempotencyKey: `manual-${setId}-${score.contestantId}-${score.criterionId}-${randomUUID()}`,
        deviceId: "manual-entry",
        eventId,
        roundId: setId,
        contestantId: score.contestantId,
        criterionId: score.criterionId,
        judgeId,
        value,
        clientCreatedAt,
        operation: "manual_adjustment",
      },
    });
    if (result.status === "synced") saved += 1;
  }

  return { saved };
}
