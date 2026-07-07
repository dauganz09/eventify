import { and, eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { db } from "@/db";
import { scoreEvents, scoreRecords } from "@/db/schema";

/**
 * Tamper guard for structural deletions.
 *
 * Score records and the append-only score_events history hang off rounds,
 * criteria, contestants, and judges with ON DELETE CASCADE — deleting any of
 * those entities would silently destroy recorded scores and their audit
 * history. Once ANY score exists in the scope (drafts included), deletion is
 * refused; the sanctioned path is the audited "Reset scores" flow first.
 */
export async function assertNoRecordedScores(params: {
  database: typeof db;
  eventId: string;
  /** Narrowing filters applied to both score tables (e.g. by roundId). */
  scope: {
    roundIds?: string[];
    criterionId?: string;
    contestantId?: string;
    judgeId?: string;
  };
  /** Error message shown when scores exist. */
  message: string;
}) {
  const { database, eventId, scope, message } = params;
  if (scope.roundIds !== undefined && scope.roundIds.length === 0) return;

  const buildWhere = (table: typeof scoreRecords | typeof scoreEvents): SQL | undefined => {
    const conditions: (SQL | undefined)[] = [eq(table.eventId, eventId)];
    if (scope.roundIds) conditions.push(inArray(table.roundId, scope.roundIds));
    if (scope.criterionId) conditions.push(eq(table.criterionId, scope.criterionId));
    if (scope.contestantId) conditions.push(eq(table.contestantId, scope.contestantId));
    if (scope.judgeId) conditions.push(eq(table.judgeId, scope.judgeId));
    return and(...conditions);
  };

  const [record] = await database
    .select({ id: scoreRecords.id })
    .from(scoreRecords)
    .where(buildWhere(scoreRecords))
    .limit(1);
  if (record) throw new Error(message);

  const [event] = await database
    .select({ id: scoreEvents.id })
    .from(scoreEvents)
    .where(buildWhere(scoreEvents))
    .limit(1);
  if (event) throw new Error(message);
}
