import { and, asc, eq, isNull } from "drizzle-orm";
import type { db } from "@/db";
import { criteria, events } from "@/db/schema";
import { assertNoRecordedScores } from "@/lib/events/deletion-guards";
import { criterionUpsertSchema } from "@/lib/validation/domain";

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

export async function listCriteria(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  return params.database
    .select()
    .from(criteria)
    .where(eq(criteria.eventId, params.eventId))
    .orderBy(asc(criteria.position), asc(criteria.name));
}

export async function upsertCriterion(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = criterionUpsertSchema.parse(params.input);
  await assertEventOwnership(params.database, input.eventId, params.organizationId);

  const criterionId =
    typeof params.input === "object" &&
    params.input !== null &&
    "criterionId" in params.input &&
    typeof params.input.criterionId === "string"
      ? params.input.criterionId
      : undefined;

  const values = {
    eventId: input.eventId,
    roundId: input.roundId,
    name: input.name,
    description: input.description,
    inputType: input.inputType,
    minValue: input.minValue === undefined ? null : String(input.minValue),
    maxValue: input.maxValue === undefined ? null : String(input.maxValue),
    stepValue: input.stepValue === undefined ? null : String(input.stepValue),
    weight: String(input.weight),
    position: input.position,
    isRequired: input.isRequired,
    config: input.config,
  };

  if (criterionId) {
    // Structure lock: once a criterion has recorded scores, its
    // scoring-affecting fields are frozen — changing the weight or range after
    // judges have scored silently changes results. Cosmetic edits (name,
    // description, position) stay allowed.
    const [existing] = await params.database
      .select()
      .from(criteria)
      .where(and(eq(criteria.id, criterionId), eq(criteria.eventId, input.eventId)))
      .limit(1);
    if (!existing) return null;

    const scoringFieldsChanged =
      existing.inputType !== values.inputType ||
      existing.isRequired !== values.isRequired ||
      Number(existing.weight) !== Number(values.weight) ||
      numericChanged(existing.minValue, values.minValue) ||
      numericChanged(existing.maxValue, values.maxValue) ||
      numericChanged(existing.stepValue, values.stepValue) ||
      existing.roundId !== (values.roundId ?? null);

    if (scoringFieldsChanged) {
      await assertNoRecordedScores({
        database: params.database,
        eventId: input.eventId,
        scope: { criterionId },
        message:
          "This criterion already has recorded scores — its scoring settings (points, range, weight) are locked to protect the results. Only the name and description can still be edited. Use Reset scores if the structure really must change.",
      });
    }

    const [criterion] = await params.database
      .update(criteria)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(criteria.id, criterionId),
          eq(criteria.eventId, input.eventId),
        ),
      )
      .returning();

    return criterion ?? null;
  }

  // Structure lock: adding a criterion to a set that already has scores would
  // change what "complete" means for every judge mid-round.
  if (input.roundId) {
    await assertNoRecordedScores({
      database: params.database,
      eventId: input.eventId,
      scope: { roundIds: [input.roundId] },
      message:
        "This set already has recorded scores — new criteria can't be added to it. Use Reset scores if the structure really must change.",
    });
  }

  const [criterion] = await params.database
    .insert(criteria)
    .values(values)
    .returning();

  return criterion;
}

function numericChanged(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a !== b;
  return Number(a) !== Number(b);
}

export async function copyCriteriaToRound(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  /** The round to copy FROM. Pass null for event-wide criteria. */
  sourceRoundId: string | null;
  /** The round to copy TO. Pass null for event-wide. */
  targetRoundId: string | null;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  // Structure lock: copying criteria into a set that already has scores would
  // change what "complete" means for every judge mid-round.
  if (params.targetRoundId) {
    await assertNoRecordedScores({
      database: params.database,
      eventId: params.eventId,
      scope: { roundIds: [params.targetRoundId] },
      message:
        "The target set already has recorded scores — criteria can't be copied into it. Use Reset scores if the structure really must change.",
    });
  }

  // Fetch all criteria belonging to the source round
  const sourceCriteria = await params.database
    .select()
    .from(criteria)
    .where(
      and(
        eq(criteria.eventId, params.eventId),
        params.sourceRoundId === null
          ? isNull(criteria.roundId)
          : eq(criteria.roundId, params.sourceRoundId),
      ),
    )
    .orderBy(asc(criteria.position), asc(criteria.name));

  if (sourceCriteria.length === 0) return [];

  // Insert copies with the target roundId — new UUIDs are generated by the DB default
  const copies = await params.database
    .insert(criteria)
    .values(
      sourceCriteria.map((c) => ({
        eventId: c.eventId,
        roundId: params.targetRoundId,
        name: c.name,
        description: c.description,
        inputType: c.inputType,
        minValue: c.minValue,
        maxValue: c.maxValue,
        stepValue: c.stepValue,
        weight: c.weight,
        position: c.position,
        isRequired: c.isRequired,
        config: c.config,
      })),
    )
    .returning();

  return copies;
}

export async function deleteCriterion(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  criterionId: string;
}) {
  await assertEventOwnership(params.database, params.eventId, params.organizationId);

  await assertNoRecordedScores({
    database: params.database,
    eventId: params.eventId,
    scope: { criterionId: params.criterionId },
    message:
      "This criterion already has recorded scores, so it can't be deleted — deleting it would destroy the score history. Use Reset scores first if you really need to remove it.",
  });

  await params.database
    .delete(criteria)
    .where(and(eq(criteria.id, params.criterionId), eq(criteria.eventId, params.eventId)));
}
