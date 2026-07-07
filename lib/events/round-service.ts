import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/db";
import { events, rounds, roundGroups } from "@/db/schema";
import { assertNoRecordedScores } from "@/lib/events/deletion-guards";
import { roundUpsertSchema } from "@/lib/validation/domain";

async function assertEventOwnership(
  database: typeof db,
  eventId: string,
  organizationId: string,
) {
  const [event] = await database
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);

  if (!event) throw new Error("Event not found.");
}

export async function listRounds(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  return params.database
    .select()
    .from(rounds)
    .where(eq(rounds.eventId, params.eventId))
    .orderBy(asc(rounds.position), asc(rounds.createdAt));
}

export async function listRoundsWithGroups(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  return params.database
    .select({
      round: rounds,
      roundGroup: roundGroups,
    })
    .from(rounds)
    .leftJoin(roundGroups, eq(rounds.roundGroupId, roundGroups.id))
    .where(eq(rounds.eventId, params.eventId))
    .orderBy(asc(roundGroups.position), asc(rounds.position), asc(rounds.createdAt));
}

export async function upsertRound(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = roundUpsertSchema.parse(params.input);
  await assertEventOwnership(params.database, input.eventId, params.organizationId);

  if (input.roundId) {
    // Structure lock: once a set has recorded scores, moving it to another
    // round or toggling manual entry would change how its scores count.
    // Cosmetic edits (name, description, position) stay allowed.
    const [existing] = await params.database
      .select({ roundGroupId: rounds.roundGroupId, isManualEntry: rounds.isManualEntry })
      .from(rounds)
      .where(and(eq(rounds.id, input.roundId), eq(rounds.eventId, input.eventId)))
      .limit(1);
    if (!existing) return null;

    const structureChanged =
      existing.roundGroupId !== (input.roundGroupId ?? null) ||
      existing.isManualEntry !== input.isManualEntry;
    if (structureChanged) {
      await assertNoRecordedScores({
        database: params.database,
        eventId: input.eventId,
        scope: { roundIds: [input.roundId] },
        message:
          "This set already has recorded scores — it can't be moved to another round or switched to/from manual entry. Only the name, description, and position can still be edited.",
      });
    }

    const [round] = await params.database
      .update(rounds)
      .set({
        name: input.name,
        description: input.description,
        position: input.position,
        roundGroupId: input.roundGroupId ?? null,
        isManualEntry: input.isManualEntry,
        updatedAt: new Date(),
      })
      .where(and(eq(rounds.id, input.roundId), eq(rounds.eventId, input.eventId)))
      .returning();

    return round ?? null;
  }

  const [round] = await params.database
    .insert(rounds)
    .values({
      eventId: input.eventId,
      name: input.name,
      description: input.description,
      position: input.position,
      roundGroupId: input.roundGroupId ?? null,
      isManualEntry: input.isManualEntry,
      config: {},
    })
    .returning();

  return round;
}

export async function deleteRound(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  roundId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  await assertNoRecordedScores({
    database: params.database,
    eventId: params.eventId,
    scope: { roundIds: [params.roundId] },
    message:
      "This set already has recorded scores, so it can't be deleted — deleting it would destroy the score history. Use Reset scores first if you really need to remove it.",
  });

  await params.database
    .delete(rounds)
    .where(and(eq(rounds.id, params.roundId), eq(rounds.eventId, params.eventId)));
}

export async function setRoundLocked(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  roundId: string;
  isLocked: boolean;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  const [round] = await params.database
    .update(rounds)
    .set({ isLocked: params.isLocked, updatedAt: new Date() })
    .where(and(eq(rounds.id, params.roundId), eq(rounds.eventId, params.eventId)))
    .returning();

  return round ?? null;
}
