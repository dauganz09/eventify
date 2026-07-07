import { and, desc, eq } from "drizzle-orm";
import type { db } from "@/db";
import {
  auditLogs,
  criteria,
  rounds,
  scoreEvents,
  scoreRecords,
  syncOperations,
} from "@/db/schema";
import { computeScoreEventHash, lockScoreEventChain } from "@/lib/scoring/score-chain";
import { scoreOperationSchema, type ScoreOperationInput } from "@/lib/validation/domain";

export interface ScoreSyncResult {
  status: "synced" | "conflict";
  scoreRecordId?: string;
  revision?: number;
  serverReceivedAt: string;
  message?: string;
}

export async function submitScoreOperation(params: {
  database: typeof db;
  /** null when the actor is a judge without a user account */
  actorUserId: string | null;
  organizationId: string;
  input: ScoreOperationInput;
}): Promise<ScoreSyncResult> {
  const input = scoreOperationSchema.parse(params.input);
  const now = new Date();

  return await params.database.transaction(async (tx) => {
    const existingSync = await tx.query.syncOperations.findFirst({
      where: eq(syncOperations.idempotencyKey, input.idempotencyKey),
    });

    if (existingSync?.status === "synced" && existingSync.result) {
      return existingSync.result as unknown as ScoreSyncResult;
    }

    const [round] = await tx
      .select({ isLocked: rounds.isLocked, isManualEntry: rounds.isManualEntry })
      .from(rounds)
      .where(eq(rounds.id, input.roundId))
      .limit(1);

    // Manual-entry sets are edited by the tabulator regardless of run-of-show
    // lifecycle, so they're intentionally exempt from the lock guard. All other
    // sets stay locked unless they're the active set.
    if (round?.isLocked && !round.isManualEntry) {
      return {
        status: "conflict",
        serverReceivedAt: now.toISOString(),
        message: "Round is locked.",
      };
    }

    const [criterion] = await tx
      .select({
        id: criteria.id,
        minValue: criteria.minValue,
        maxValue: criteria.maxValue,
      })
      .from(criteria)
      .where(eq(criteria.id, input.criterionId))
      .limit(1);

    if (!criterion) {
      return {
        status: "conflict",
        serverReceivedAt: now.toISOString(),
        message: "Criterion no longer exists.",
      };
    }

    const [existingScore] = await tx
      .select()
      .from(scoreRecords)
      .where(
        and(
          eq(scoreRecords.eventId, input.eventId),
          eq(scoreRecords.roundId, input.roundId),
          eq(scoreRecords.contestantId, input.contestantId),
          eq(scoreRecords.judgeId, input.judgeId),
          eq(scoreRecords.criterionId, input.criterionId),
        ),
      )
      .limit(1);

    if (
      existingScore &&
      input.expectedRevision &&
      existingScore.revision !== input.expectedRevision
    ) {
      return {
        status: "conflict",
        scoreRecordId: existingScore.id,
        revision: existingScore.revision,
        serverReceivedAt: now.toISOString(),
        message: "Score was changed by another operation.",
      };
    }

    const nextRevision = existingScore ? existingScore.revision + 1 : 1;
    const status = input.operation === "draft_saved" ? "draft" : "submitted";
    // Both judge submissions and manual adjustments are final/submitted scores.
    const submittedAt = input.operation === "draft_saved" ? null : now;

    const [scoreRecord] = existingScore
      ? await tx
          .update(scoreRecords)
          .set({
            value: String(input.value),
            comment: input.comment,
            status,
            revision: nextRevision,
            submittedAt,
            updatedAt: now,
          })
          .where(eq(scoreRecords.id, existingScore.id))
          .returning()
      : await tx
          .insert(scoreRecords)
          .values({
            organizationId: params.organizationId,
            eventId: input.eventId,
            roundId: input.roundId,
            contestantId: input.contestantId,
            judgeId: input.judgeId,
            criterionId: input.criterionId,
            value: String(input.value),
            comment: input.comment,
            status,
            revision: nextRevision,
            submittedAt,
          })
          .returning();

    // Tamper-evident hash chain: serialize appenders for this event, link to
    // the current chain head, and store this entry's own content hash.
    await lockScoreEventChain(tx as unknown as typeof db, input.eventId);
    const [chainHead] = await tx
      .select({ hash: scoreEvents.hash })
      .from(scoreEvents)
      .where(eq(scoreEvents.eventId, input.eventId))
      .orderBy(desc(scoreEvents.seq))
      .limit(1);
    const prevHash = chainHead?.hash ?? null;
    const clientCreatedAt = new Date(input.clientCreatedAt);
    const hash = computeScoreEventHash({
      prevHash,
      idempotencyKey: input.idempotencyKey,
      eventId: input.eventId,
      roundId: input.roundId,
      contestantId: input.contestantId,
      judgeId: input.judgeId,
      criterionId: input.criterionId,
      operation: input.operation,
      previousValue: existingScore?.value ?? null,
      nextValue: String(input.value),
      actorUserId: params.actorUserId,
      deviceId: input.deviceId ?? null,
      clientCreatedAt,
      serverReceivedAt: now,
    });

    await tx.insert(scoreEvents).values({
      idempotencyKey: input.idempotencyKey,
      scoreRecordId: scoreRecord.id,
      organizationId: params.organizationId,
      eventId: input.eventId,
      roundId: input.roundId,
      contestantId: input.contestantId,
      judgeId: input.judgeId,
      criterionId: input.criterionId,
      operation: input.operation,
      previousValue: existingScore?.value ?? null,
      nextValue: String(input.value),
      actorUserId: params.actorUserId,
      deviceId: input.deviceId,
      metadata: {},
      clientCreatedAt,
      serverReceivedAt: now,
      prevHash,
      hash,
    });

    await tx.insert(auditLogs).values({
      organizationId: params.organizationId,
      eventId: input.eventId,
      actorUserId: params.actorUserId,
      action: input.operation,
      entityType: "score_record",
      entityId: scoreRecord.id,
      metadata: {
        revision: nextRevision,
        source: "score_sync",
      },
    });

    const result: ScoreSyncResult = {
      status: "synced",
      scoreRecordId: scoreRecord.id,
      revision: nextRevision,
      serverReceivedAt: now.toISOString(),
    };

    await tx
      .insert(syncOperations)
      .values({
        idempotencyKey: input.idempotencyKey,
        organizationId: params.organizationId,
        eventId: input.eventId,
        actorUserId: params.actorUserId,
        operationType: input.operation,
        status: "synced",
        payload: { ...input },
        result: { ...result },
      })
      .onConflictDoNothing();

    return result;
  });
}
