import { and, desc, eq, isNull } from "drizzle-orm";
import type { db } from "@/db";
import {
  auditLogs,
  contestants,
  criteria,
  events,
  rounds,
  scoreEvents,
  scoreRecords,
  syncOperations,
} from "@/db/schema";
import { refreshRoundAggregatesForSync } from "@/lib/scoring/aggregate-service";
import { computeScoreEventHash, lockScoreEventChain } from "@/lib/scoring/score-chain";
import { scoreOperationSchema, type ScoreOperationInput } from "@/lib/validation/domain";

export interface ScoreSyncResult {
  status: "synced" | "conflict";
  scoreRecordId?: string;
  revision?: number;
  serverReceivedAt: string;
  message?: string;
}

export interface ScoreBatchItemResult extends ScoreSyncResult {
  idempotencyKey: string;
}

interface PendingAuditEntry {
  organizationId: string;
  eventId: string;
  actorUserId: string | null;
  action: string;
  entityId: string;
  revision: number;
}

type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface ScoreWriteContext {
  tx: TransactionClient;
  actorUserId: string | null;
  organizationId: string;
  /** Server-resolved judge identity for a judge-session actor; null for a dashboard-user actor. */
  judgeId: string | null;
  /** The one event a judge session is bound to; null for a dashboard-user actor. */
  judgeEventId: string | null;
  now: Date;
  chainState: { prevHash: string | null };
}

function countsTowardAggregates(operation: ScoreOperationInput["operation"]) {
  return operation === "submitted" || operation === "manual_adjustment";
}

/** A generic "can't accept this" result — kept vague deliberately so a probing client can't use the message to enumerate other orgs'/events' ids. */
function rejected(now: Date, message: string): { result: ScoreSyncResult } {
  return { result: { status: "conflict", serverReceivedAt: now.toISOString(), message } };
}

async function writeScoreOperationInTx(
  ctx: ScoreWriteContext,
  input: ScoreOperationInput,
): Promise<{ result: ScoreSyncResult; audit?: PendingAuditEntry }> {
  const { tx, actorUserId, organizationId, judgeId, judgeEventId, now, chainState } = ctx;

  const existingSync = await tx.query.syncOperations.findFirst({
    where: eq(syncOperations.idempotencyKey, input.idempotencyKey),
  });

  if (existingSync?.status === "synced" && existingSync.result) {
    return { result: existingSync.result as unknown as ScoreSyncResult };
  }

  // A judge session may only ever write under its own identity, into the one
  // event it's bound to — both server-resolved, never trusted from the body.
  if (judgeId && (input.judgeId !== judgeId || input.eventId !== judgeEventId)) {
    return rejected(now, "You are not authorized to submit this score.");
  }

  // The claimed event must actually belong to the caller's organization —
  // eventId/organizationId both ultimately trace back to client input (a
  // header for a dashboard actor, the body for eventId), so neither can be
  // trusted without a lookup.
  const [event] = await tx
    .select({ organizationId: events.organizationId })
    .from(events)
    .where(eq(events.id, input.eventId))
    .limit(1);
  if (!event || event.organizationId !== organizationId) {
    return rejected(now, "Event not found.");
  }

  // Row-locked (not a plain SELECT) so this can't race the tabulator's
  // lock/unlock action: a concurrent UPDATE on this round blocks here until
  // it commits, and this SELECT then sees the fresh isLocked value.
  const [round] = await tx
    .select({ eventId: rounds.eventId, isLocked: rounds.isLocked, isManualEntry: rounds.isManualEntry })
    .from(rounds)
    .where(eq(rounds.id, input.roundId))
    .for("update")
    .limit(1);

  if (!round || round.eventId !== input.eventId) {
    return rejected(now, "Round not found.");
  }

  if (round.isLocked && !round.isManualEntry) {
    return rejected(now, "Round is locked.");
  }

  const [criterion] = await tx
    .select({
      id: criteria.id,
      eventId: criteria.eventId,
      roundId: criteria.roundId,
      minValue: criteria.minValue,
      maxValue: criteria.maxValue,
    })
    .from(criteria)
    .where(eq(criteria.id, input.criterionId))
    .limit(1);

  if (!criterion || criterion.eventId !== input.eventId || criterion.roundId !== input.roundId) {
    return rejected(now, "Criterion no longer exists.");
  }

  const min = criterion.minValue === null ? null : Number(criterion.minValue);
  const max = criterion.maxValue === null ? null : Number(criterion.maxValue);
  if (Number.isNaN(input.value) || (min !== null && input.value < min) || (max !== null && input.value > max)) {
    return rejected(now, "Score is outside the allowed range for this criterion.");
  }

  const [contestant] = await tx
    .select({ eventId: contestants.eventId })
    .from(contestants)
    .where(and(eq(contestants.id, input.contestantId), isNull(contestants.archivedAt)))
    .limit(1);
  if (!contestant || contestant.eventId !== input.eventId) {
    return rejected(now, "Contestant not found.");
  }

  // Reject an out-of-order replay: if a newer edit for this exact score cell
  // already landed (e.g. a device queued offline while a different device
  // scored the same cell and came back online later), don't let the stale
  // value silently win over the newer one.
  const [latestEvent] = await tx
    .select({ clientCreatedAt: scoreEvents.clientCreatedAt })
    .from(scoreEvents)
    .where(
      and(
        eq(scoreEvents.roundId, input.roundId),
        eq(scoreEvents.contestantId, input.contestantId),
        eq(scoreEvents.judgeId, input.judgeId),
        eq(scoreEvents.criterionId, input.criterionId),
      ),
    )
    .orderBy(desc(scoreEvents.clientCreatedAt))
    .limit(1);
  const incomingClientCreatedAt = new Date(input.clientCreatedAt);
  if (latestEvent && latestEvent.clientCreatedAt >= incomingClientCreatedAt) {
    return rejected(now, "A newer edit for this score already exists.");
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
      result: {
        status: "conflict",
        scoreRecordId: existingScore.id,
        revision: existingScore.revision,
        serverReceivedAt: now.toISOString(),
        message: "Score was changed by another operation.",
      },
    };
  }

  const nextRevision = existingScore ? existingScore.revision + 1 : 1;
  const status = input.operation === "draft_saved" ? "draft" : "submitted";
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
          organizationId,
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

  const clientCreatedAt = new Date(input.clientCreatedAt);
  const hash = computeScoreEventHash({
    prevHash: chainState.prevHash,
    idempotencyKey: input.idempotencyKey,
    eventId: input.eventId,
    roundId: input.roundId,
    contestantId: input.contestantId,
    judgeId: input.judgeId,
    criterionId: input.criterionId,
    operation: input.operation,
    previousValue: existingScore?.value ?? null,
    nextValue: String(input.value),
    actorUserId,
    deviceId: input.deviceId ?? null,
    clientCreatedAt,
    serverReceivedAt: now,
  });

  await tx.insert(scoreEvents).values({
    idempotencyKey: input.idempotencyKey,
    scoreRecordId: scoreRecord.id,
    organizationId,
    eventId: input.eventId,
    roundId: input.roundId,
    contestantId: input.contestantId,
    judgeId: input.judgeId,
    criterionId: input.criterionId,
    operation: input.operation,
    previousValue: existingScore?.value ?? null,
    nextValue: String(input.value),
    actorUserId,
    deviceId: input.deviceId,
    metadata: {},
    clientCreatedAt,
    serverReceivedAt: now,
    prevHash: chainState.prevHash,
    hash,
  });

  chainState.prevHash = hash;

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
      organizationId,
      eventId: input.eventId,
      actorUserId,
      operationType: input.operation,
      status: "synced",
      payload: { ...input },
      result: { ...result },
    })
    .onConflictDoNothing();

  return {
    result,
    audit: {
      organizationId,
      eventId: input.eventId,
      actorUserId,
      action: input.operation,
      entityId: scoreRecord.id,
      revision: nextRevision,
    },
  };
}

async function recordScoreAuditLogs(
  database: typeof db,
  entries: PendingAuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  await database.insert(auditLogs).values(
    entries.map((entry) => ({
      organizationId: entry.organizationId,
      eventId: entry.eventId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: "score_record",
      entityId: entry.entityId,
      metadata: {
        revision: entry.revision,
        source: "score_sync",
      },
    })),
  );
}

async function finalizeScoreSyncSideEffects(params: {
  database: typeof db;
  eventId: string;
  auditEntries: PendingAuditEntry[];
  aggregateRoundIds: Set<string>;
  aggregateOperation: ScoreOperationInput["operation"] | null;
}): Promise<void> {
  await recordScoreAuditLogs(params.database, params.auditEntries);

  if (params.aggregateOperation && params.aggregateRoundIds.size > 0) {
    await refreshRoundAggregatesForSync({
      database: params.database,
      eventId: params.eventId,
      roundIds: params.aggregateRoundIds,
      operation: params.aggregateOperation,
    });
  }
}

export async function submitScoreOperation(params: {
  database: typeof db;
  actorUserId: string | null;
  organizationId: string;
  judgeId?: string | null;
  judgeEventId?: string | null;
  input: ScoreOperationInput;
}): Promise<ScoreSyncResult> {
  const input = scoreOperationSchema.parse(params.input);
  const now = new Date();
  const auditEntries: PendingAuditEntry[] = [];
  const aggregateRoundIds = new Set<string>();

  const result = await params.database.transaction(async (tx) => {
    await lockScoreEventChain(tx as unknown as typeof db, input.eventId);
    const [chainHead] = await tx
      .select({ hash: scoreEvents.hash })
      .from(scoreEvents)
      .where(eq(scoreEvents.eventId, input.eventId))
      .orderBy(desc(scoreEvents.seq))
      .limit(1);

    const { result: writeResult, audit } = await writeScoreOperationInTx(
      {
        tx,
        actorUserId: params.actorUserId,
        organizationId: params.organizationId,
        judgeId: params.judgeId ?? null,
        judgeEventId: params.judgeEventId ?? null,
        now,
        chainState: { prevHash: chainHead?.hash ?? null },
      },
      input,
    );

    if (audit && writeResult.status === "synced") {
      auditEntries.push(audit);
      if (countsTowardAggregates(input.operation)) {
        aggregateRoundIds.add(input.roundId);
      }
    }

    return writeResult;
  });

  await finalizeScoreSyncSideEffects({
    database: params.database,
    eventId: input.eventId,
    auditEntries,
    aggregateRoundIds,
    aggregateOperation: input.operation,
  });

  return result;
}

export async function submitScoreBatch(params: {
  database: typeof db;
  actorUserId: string | null;
  organizationId: string;
  judgeId?: string | null;
  judgeEventId?: string | null;
  inputs: ScoreOperationInput[];
}): Promise<ScoreBatchItemResult[]> {
  const inputs = params.inputs.map((input) => scoreOperationSchema.parse(input));
  if (inputs.length === 0) return [];

  const eventIds = new Set(inputs.map((input) => input.eventId));
  if (eventIds.size !== 1) {
    throw new Error("All operations in a batch must belong to the same event.");
  }

  const eventId = inputs[0]!.eventId;
  const now = new Date();
  const auditEntries: PendingAuditEntry[] = [];
  const aggregateRoundIds = new Set<string>();
  let aggregateOperation: ScoreOperationInput["operation"] | null = null;

  const results = await params.database.transaction(async (tx) => {
    await lockScoreEventChain(tx as unknown as typeof db, eventId);
    const [chainHead] = await tx
      .select({ hash: scoreEvents.hash })
      .from(scoreEvents)
      .where(eq(scoreEvents.eventId, eventId))
      .orderBy(desc(scoreEvents.seq))
      .limit(1);

    const chainState = { prevHash: chainHead?.hash ?? null };
    const batchResults: ScoreBatchItemResult[] = [];

    for (const input of inputs) {
      const { result, audit } = await writeScoreOperationInTx(
        {
          tx,
          actorUserId: params.actorUserId,
          organizationId: params.organizationId,
          judgeId: params.judgeId ?? null,
          judgeEventId: params.judgeEventId ?? null,
          now,
          chainState,
        },
        input,
      );

      if (audit && result.status === "synced") {
        auditEntries.push(audit);
        if (countsTowardAggregates(input.operation)) {
          aggregateRoundIds.add(input.roundId);
          aggregateOperation = input.operation;
        }
      }

      batchResults.push({ idempotencyKey: input.idempotencyKey, ...result });
    }

    return batchResults;
  });

  await finalizeScoreSyncSideEffects({
    database: params.database,
    eventId,
    auditEntries,
    aggregateRoundIds,
    aggregateOperation,
  });

  return results;
}
