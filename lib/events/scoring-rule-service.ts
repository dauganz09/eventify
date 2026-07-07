import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/db";
import { events, scoringRules } from "@/db/schema";
import { scoringRuleUpsertSchema } from "@/lib/validation/domain";

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

export async function listScoringRules(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  return params.database
    .select()
    .from(scoringRules)
    .where(eq(scoringRules.eventId, params.eventId))
    .orderBy(asc(scoringRules.createdAt));
}

export async function upsertScoringRule(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = scoringRuleUpsertSchema.parse(params.input);
  await assertEventOwnership(params.database, input.eventId, params.organizationId);

  if (input.ruleId) {
    const [rule] = await params.database
      .update(scoringRules)
      .set({
        roundId: input.roundId,
        name: input.name,
        aggregation: input.aggregation,
      })
      .where(and(eq(scoringRules.id, input.ruleId), eq(scoringRules.eventId, input.eventId)))
      .returning();

    return rule ?? null;
  }

  const [rule] = await params.database
    .insert(scoringRules)
    .values({
      eventId: input.eventId,
      roundId: input.roundId,
      name: input.name,
      aggregation: input.aggregation,
      config: {},
    })
    .returning();

  return rule;
}

export async function deleteScoringRule(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  ruleId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  await params.database
    .delete(scoringRules)
    .where(and(eq(scoringRules.id, params.ruleId), eq(scoringRules.eventId, params.eventId)));
}
