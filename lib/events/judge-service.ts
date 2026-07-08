import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/db";
import { events, judgeAssignments, judges } from "@/db/schema";
import { hashPassword } from "@/lib/auth/local-session";
import { assertNoRecordedScores } from "@/lib/events/deletion-guards";
import { judgeAssignmentSchema, judgeUpsertSchema } from "@/lib/validation/domain";

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

export async function listJudges(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  return params.database
    .select()
    .from(judges)
    .where(eq(judges.eventId, params.eventId))
    .orderBy(asc(judges.displayName));
}

export async function listJudgeAssignments(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  return params.database
    .select()
    .from(judgeAssignments)
    .where(eq(judgeAssignments.eventId, params.eventId));
}

export async function upsertJudge(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = judgeUpsertSchema.parse(params.input);
  await assertEventOwnership(params.database, input.eventId, params.organizationId);

  // Hash password only when a new one was provided
  const passwordHash =
    input.password ? await hashPassword(input.password) : undefined;

  if (input.judgeId) {
    const updateValues: Partial<typeof judges.$inferInsert> = {
      displayName: input.displayName,
      username: input.username || null,
      email: input.email || null,
      isActive: input.isActive,
    };
    if (passwordHash) updateValues.passwordHash = passwordHash;

    const [judge] = await params.database
      .update(judges)
      .set(updateValues)
      .where(and(eq(judges.id, input.judgeId), eq(judges.eventId, input.eventId)))
      .returning();

    return judge ?? null;
  }

  const [judge] = await params.database
    .insert(judges)
    .values({
      eventId: input.eventId,
      displayName: input.displayName,
      username: input.username || null,
      passwordHash: passwordHash ?? null,
      email: input.email || null,
      isActive: input.isActive,
    })
    .returning();

  return judge;
}

export async function deleteJudge(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  judgeId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  await assertNoRecordedScores({
    database: params.database,
    eventId: params.eventId,
    scope: { judgeId: params.judgeId },
    message:
      "This judge has already submitted scores, so they can't be deleted — deactivate them instead to keep the score history intact.",
  });

  await params.database
    .delete(judges)
    .where(and(eq(judges.id, params.judgeId), eq(judges.eventId, params.eventId)));
}

export async function assignJudge(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = judgeAssignmentSchema.parse(params.input);
  await assertEventOwnership(params.database, input.eventId, params.organizationId);

  // The builder form owns the FULL set of scopes for a judge (one or more
  // rounds, or event-wide), so saving replaces any previous scopes rather than
  // accumulating rows. An empty roundGroupIds list = event-wide (one row with
  // both scopes null).
  const uniqueGroupIds = [...new Set(input.roundGroupIds)];

  await params.database
    .delete(judgeAssignments)
    .where(
      and(
        eq(judgeAssignments.eventId, input.eventId),
        eq(judgeAssignments.judgeId, input.judgeId),
      ),
    );

  const rows =
    uniqueGroupIds.length > 0
      ? uniqueGroupIds.map((roundGroupId) => ({
          eventId: input.eventId,
          judgeId: input.judgeId,
          roundGroupId,
        }))
      : [
          {
            eventId: input.eventId,
            judgeId: input.judgeId,
            roundId: input.roundId,
          },
        ];

  return params.database
    .insert(judgeAssignments)
    .values(rows)
    .onConflictDoNothing()
    .returning();
}
