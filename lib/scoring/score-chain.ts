import { createHash } from "crypto";
import { asc, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { scoreEvents } from "@/db/schema";

/**
 * Tamper-evident hash chain over the append-only `score_events` history.
 *
 * Every event stores the previous event's hash (per event, in seq order) and a
 * SHA-256 of its own content. Anyone editing, inserting, or deleting a
 * historical row directly in the database breaks the chain, which
 * `verifyScoreEventChain` detects. Rows written before the chain existed have
 * a null hash and are reported as "legacy" (unverifiable, not broken).
 */

/** Numeric columns round-trip as "5.0000"; normalize so hashing is stable. */
function normalizeValue(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isNaN(num) ? String(value) : num.toFixed(4);
}

export interface ScoreEventHashInput {
  prevHash: string | null;
  idempotencyKey: string;
  eventId: string;
  roundId: string;
  contestantId: string;
  judgeId: string;
  criterionId: string;
  operation: string;
  previousValue: string | number | null;
  nextValue: string | number | null;
  actorUserId: string | null;
  deviceId: string | null;
  clientCreatedAt: Date;
  serverReceivedAt: Date;
}

export function computeScoreEventHash(input: ScoreEventHashInput): string {
  // Fixed-order array so the hash doesn't depend on object key ordering.
  const payload = JSON.stringify([
    input.prevHash,
    input.idempotencyKey,
    input.eventId,
    input.roundId,
    input.contestantId,
    input.judgeId,
    input.criterionId,
    input.operation,
    normalizeValue(input.previousValue),
    normalizeValue(input.nextValue),
    input.actorUserId,
    input.deviceId,
    input.clientCreatedAt.toISOString(),
    input.serverReceivedAt.toISOString(),
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Serializes appenders for one event's chain within the current transaction.
 * Must be called inside a transaction before reading the chain head.
 */
export async function lockScoreEventChain(tx: typeof db, eventId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`);
}

export interface ChainVerification {
  ok: boolean;
  total: number;
  /** Rows whose stored hash matched the recomputed one. */
  verified: number;
  /** Pre-chain rows without a hash (unverifiable, not counted as broken). */
  legacy: number;
  /** Seq of the first broken link, if any. */
  brokenAtSeq: number | null;
  reason: string | null;
}

export async function verifyScoreEventChain(params: {
  database: typeof db;
  eventId: string;
}): Promise<ChainVerification> {
  const rows = await params.database
    .select()
    .from(scoreEvents)
    .where(eq(scoreEvents.eventId, params.eventId))
    .orderBy(asc(scoreEvents.seq));

  let verified = 0;
  let legacy = 0;
  let prevHash: string | null = null;

  for (const row of rows) {
    if (row.hash === null) {
      // Legacy row: hashes only start part-way through history is fine, but a
      // null AFTER hashed rows means someone stripped a hash — that's broken.
      if (prevHash !== null) {
        return {
          ok: false,
          total: rows.length,
          verified,
          legacy,
          brokenAtSeq: row.seq,
          reason: "A hashed entry is followed by an entry with no hash.",
        };
      }
      legacy += 1;
      continue;
    }

    if (row.prevHash !== prevHash) {
      return {
        ok: false,
        total: rows.length,
        verified,
        legacy,
        brokenAtSeq: row.seq,
        reason: "Chain link mismatch — an entry was altered, removed, or reordered.",
      };
    }

    const recomputed = computeScoreEventHash({
      prevHash: row.prevHash,
      idempotencyKey: row.idempotencyKey,
      eventId: row.eventId,
      roundId: row.roundId,
      contestantId: row.contestantId,
      judgeId: row.judgeId,
      criterionId: row.criterionId,
      operation: row.operation,
      previousValue: row.previousValue,
      nextValue: row.nextValue,
      actorUserId: row.actorUserId,
      deviceId: row.deviceId,
      clientCreatedAt: row.clientCreatedAt,
      serverReceivedAt: row.serverReceivedAt,
    });
    if (recomputed !== row.hash) {
      return {
        ok: false,
        total: rows.length,
        verified,
        legacy,
        brokenAtSeq: row.seq,
        reason: "An entry's content does not match its recorded hash.",
      };
    }

    verified += 1;
    prevHash = row.hash;
  }

  return { ok: true, total: rows.length, verified, legacy, brokenAtSeq: null, reason: null };
}

/**
 * One-off backfill: rebuilds an event's entire chain in seq order (legacy rows
 * get hashed; already-hashed rows are re-linked if legacy rows precede them).
 * Deterministic and safe to re-run.
 */
export async function backfillScoreEventChain(params: {
  database: typeof db;
  eventId: string;
}): Promise<number> {
  const { database, eventId } = params;
  return database.transaction(async (tx) => {
    await lockScoreEventChain(tx as unknown as typeof db, eventId);

    const rows = await tx
      .select()
      .from(scoreEvents)
      .where(eq(scoreEvents.eventId, eventId))
      .orderBy(asc(scoreEvents.seq));

    let prevHash: string | null = null;
    let written = 0;
    for (const row of rows) {
      const hash = computeScoreEventHash({
        prevHash,
        idempotencyKey: row.idempotencyKey,
        eventId: row.eventId,
        roundId: row.roundId,
        contestantId: row.contestantId,
        judgeId: row.judgeId,
        criterionId: row.criterionId,
        operation: row.operation,
        previousValue: row.previousValue,
        nextValue: row.nextValue,
        actorUserId: row.actorUserId,
        deviceId: row.deviceId,
        clientCreatedAt: row.clientCreatedAt,
        serverReceivedAt: row.serverReceivedAt,
      });
      if (row.hash !== hash || row.prevHash !== prevHash) {
        await tx
          .update(scoreEvents)
          .set({ prevHash, hash })
          .where(eq(scoreEvents.id, row.id));
        written += 1;
      }
      prevHash = hash;
    }
    return written;
  });
}

/** Event ids that still have un-hashed legacy rows (for backfill tooling). */
export async function listEventsWithLegacyScoreEvents(database: typeof db) {
  const rows = await database
    .selectDistinct({ eventId: scoreEvents.eventId })
    .from(scoreEvents)
    .where(isNull(scoreEvents.hash));
  return rows.map((r) => r.eventId);
}
