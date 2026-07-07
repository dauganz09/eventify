import { and, asc, eq, isNull } from "drizzle-orm";
import type { db } from "@/db";
import { contestants, events } from "@/db/schema";
import { assertNoRecordedScores } from "@/lib/events/deletion-guards";
import { contestantUpsertSchema } from "@/lib/validation/domain";

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

export async function listContestants(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  return params.database
    .select()
    .from(contestants)
    .where(and(eq(contestants.eventId, params.eventId), isNull(contestants.archivedAt)))
    .orderBy(asc(contestants.position), asc(contestants.displayName));
}

export async function upsertContestant(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = contestantUpsertSchema.parse(params.input);
  await assertEventOwnership(params.database, input.eventId, params.organizationId);

  const contestantId =
    typeof params.input === "object" &&
    params.input !== null &&
    "contestantId" in params.input &&
    typeof params.input.contestantId === "string"
      ? params.input.contestantId
      : undefined;

  if (contestantId) {
    const [contestant] = await params.database
      .update(contestants)
      .set({
        displayNumber: input.displayNumber,
        displayName: input.displayName,
        category: input.category,
        division: input.division,
        photoUrl: input.photoUrl || null,
        position: input.position,
        metadata: input.metadata,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contestants.id, contestantId),
          eq(contestants.eventId, input.eventId),
        ),
      )
      .returning();

    return contestant ?? null;
  }

  const [contestant] = await params.database
    .insert(contestants)
    .values({ ...input, photoUrl: input.photoUrl || null })
    .returning();

  return contestant;
}

export async function archiveContestant(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  contestantId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  const [contestant] = await params.database
    .update(contestants)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(contestants.id, params.contestantId), eq(contestants.eventId, params.eventId)),
    )
    .returning();

  return contestant ?? null;
}

export async function deleteContestant(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  contestantId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  await assertNoRecordedScores({
    database: params.database,
    eventId: params.eventId,
    scope: { contestantId: params.contestantId },
    message:
      "This contestant already has recorded scores, so they can't be deleted — archive them instead to keep the score history intact.",
  });

  await params.database
    .delete(contestants)
    .where(
      and(eq(contestants.id, params.contestantId), eq(contestants.eventId, params.eventId)),
    );
}
