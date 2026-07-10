import { and, eq, inArray, isNull } from "drizzle-orm";
import type { db } from "@/db";
import { tieBreaks, userProfiles } from "@/db/schema";
import { tieKeyFor } from "@/lib/scoring/ranking";

export type TieBreakScope = "standings" | "advancement" | "rank_order";
export type TieBreakMethod = "manual" | "judge_vote";

export interface TieBreakRow {
  id: string;
  scope: TieBreakScope;
  contextId: string | null;
  tiedContestantIds: string[];
  resolvedOrder: string[];
  method: TieBreakMethod;
  note: string | null;
  resolvedByUserId: string | null;
  resolvedByName: string | null;
  resolvedAt: Date;
}

/** All of an event's live tie-break overrides, across every scope/context. */
export async function listTieBreaks(
  database: typeof db,
  eventId: string,
): Promise<TieBreakRow[]> {
  const rows = await database
    .select({
      id: tieBreaks.id,
      scope: tieBreaks.scope,
      contextId: tieBreaks.contextId,
      tiedContestantIds: tieBreaks.tiedContestantIds,
      resolvedOrder: tieBreaks.resolvedOrder,
      method: tieBreaks.method,
      note: tieBreaks.note,
      resolvedByUserId: tieBreaks.resolvedByUserId,
      resolvedByName: userProfiles.displayName,
      resolvedAt: tieBreaks.resolvedAt,
    })
    .from(tieBreaks)
    .leftJoin(userProfiles, eq(userProfiles.id, tieBreaks.resolvedByUserId))
    .where(eq(tieBreaks.eventId, eventId));

  return rows.map((row) => ({
    ...row,
    scope: row.scope as TieBreakScope,
    method: row.method as TieBreakMethod,
  }));
}

/** Narrows a full list down to the tieKey -> order map a given call site needs. */
export function overrideMapFor(
  rows: TieBreakRow[],
  scope: TieBreakScope,
  contextId: string | null,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (row.scope !== scope || row.contextId !== contextId) continue;
    map.set(tieKeyFor(row.tiedContestantIds), row.resolvedOrder);
  }
  return map;
}

/**
 * Records (or replaces) the tabulator's manual resolution for one tied
 * cluster. Any existing override for the same (eventId, scope, contextId,
 * tied contestant set) is superseded — there's only ever one live row per
 * tie; the full history of what changed lives in `audit_logs`.
 */
export async function saveTieBreak(params: {
  database: typeof db;
  eventId: string;
  scope: TieBreakScope;
  contextId: string | null;
  tiedContestantIds: string[];
  order: string[];
  method?: TieBreakMethod;
  note?: string | null;
  actorUserId: string | null;
}): Promise<{ id: string }> {
  const { database, eventId, scope, contextId, tiedContestantIds, order, actorUserId } = params;

  if (tiedContestantIds.length < 2) {
    throw new Error("A tie-break needs at least two tied contestants.");
  }
  const isExactPermutation =
    order.length === tiedContestantIds.length &&
    new Set(order).size === order.length &&
    tiedContestantIds.every((id) => order.includes(id));
  if (!isExactPermutation) {
    throw new Error("The resolved order must include exactly the tied contestants, once each.");
  }

  return database.transaction(async (tx) => {
    const existing = await tx
      .select({ id: tieBreaks.id, tiedContestantIds: tieBreaks.tiedContestantIds })
      .from(tieBreaks)
      .where(
        and(
          eq(tieBreaks.eventId, eventId),
          eq(tieBreaks.scope, scope),
          contextId === null ? isNull(tieBreaks.contextId) : eq(tieBreaks.contextId, contextId),
        ),
      );

    const key = tieKeyFor(tiedContestantIds);
    const staleIds = existing
      .filter((row) => tieKeyFor(row.tiedContestantIds) === key)
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await tx.delete(tieBreaks).where(inArray(tieBreaks.id, staleIds));
    }

    const [created] = await tx
      .insert(tieBreaks)
      .values({
        eventId,
        scope,
        contextId,
        tiedContestantIds,
        resolvedOrder: order,
        method: params.method ?? "manual",
        note: params.note ?? null,
        resolvedByUserId: actorUserId,
      })
      .returning({ id: tieBreaks.id });
    return { id: created.id };
  });
}

/** Reverts a tied cluster back to the automatic result. */
export async function clearTieBreak(params: {
  database: typeof db;
  eventId: string;
  id: string;
}): Promise<void> {
  await params.database
    .delete(tieBreaks)
    .where(and(eq(tieBreaks.id, params.id), eq(tieBreaks.eventId, params.eventId)));
}
