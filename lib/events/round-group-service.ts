import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/db";
import { events, roundGroups, rounds } from "@/db/schema";
import { assertNoRecordedScores } from "@/lib/events/deletion-guards";
import { roundGroupUpsertSchema } from "@/lib/validation/domain";

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

export async function listRoundGroups(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  return params.database
    .select()
    .from(roundGroups)
    .where(eq(roundGroups.eventId, params.eventId))
    .orderBy(asc(roundGroups.position), asc(roundGroups.createdAt));
}

export async function upsertRoundGroup(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = roundGroupUpsertSchema.parse(params.input);
  await assertEventOwnership(params.database, input.eventId, params.organizationId);

  if (input.roundGroupId) {
    // Structure lock: once any of this round's sets has recorded scores, the
    // settings that decide how those scores count (carry-over, weight,
    // advancement, winner method) are frozen. Cosmetic edits stay allowed.
    const [existing] = await params.database
      .select()
      .from(roundGroups)
      .where(
        and(
          eq(roundGroups.id, input.roundGroupId),
          eq(roundGroups.eventId, input.eventId),
        ),
      )
      .limit(1);
    if (!existing) return null;

    const scoringSettingsChanged =
      existing.carryOverScores !== input.carryOverScores ||
      existing.carryOverWeight !== input.carryOverWeight ||
      existing.advanceCount !== input.advanceCount ||
      existing.advanceDisplayOrder !== input.advanceDisplayOrder ||
      existing.scoringMethod !== input.scoringMethod;

    if (scoringSettingsChanged) {
      const groupSets = await params.database
        .select({ id: rounds.id })
        .from(rounds)
        .where(eq(rounds.roundGroupId, input.roundGroupId));
      await assertNoRecordedScores({
        database: params.database,
        eventId: input.eventId,
        scope: { roundIds: groupSets.map((set) => set.id) },
        message:
          "This round already has recorded scores — its scoring settings (carry-over, weight, advancement, winner method) are locked to protect the results. Only the name, description, and position can still be edited.",
      });
    }

    const [group] =     await params.database
      .update(roundGroups)
      .set({
        name: input.name,
        description: input.description,
        position: input.position,
        carryOverScores: input.carryOverScores,
        carryOverWeight: input.carryOverWeight,
        advanceCount: input.advanceCount,
        advanceDisplayOrder: input.advanceDisplayOrder,
        scoringMethod: input.scoringMethod,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(roundGroups.id, input.roundGroupId),
          eq(roundGroups.eventId, input.eventId),
        ),
      )
      .returning();

    return group ?? null;
  }

  const [group] = await params.database
    .insert(roundGroups)
    .values({
      eventId: input.eventId,
      name: input.name,
      description: input.description,
      position: input.position,
      carryOverScores: input.carryOverScores,
      carryOverWeight: input.carryOverWeight,
      advanceCount: input.advanceCount,
      advanceDisplayOrder: input.advanceDisplayOrder,
      scoringMethod: input.scoringMethod,
    })
    .returning();

  return group;
}

export async function deleteRoundGroup(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  roundGroupId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  const groupSets = await params.database
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.roundGroupId, params.roundGroupId));
  await assertNoRecordedScores({
    database: params.database,
    eventId: params.eventId,
    scope: { roundIds: groupSets.map((set) => set.id) },
    message:
      "This round already has recorded scores in one of its sets, so it can't be deleted — deleting it would destroy the score history. Use Reset scores first if you really need to remove it.",
  });

  await params.database
    .delete(roundGroups)
    .where(
      and(
        eq(roundGroups.id, params.roundGroupId),
        eq(roundGroups.eventId, params.eventId),
      ),
    );
}
