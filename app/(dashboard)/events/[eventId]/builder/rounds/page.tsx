import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scoreEvents, scoreRecords } from "@/db/schema";
import { requireAuthContext } from "@/lib/auth/context";
import { getEventById } from "@/lib/events/event-service";
import { listRoundGroups } from "@/lib/events/round-group-service";
import { listRoundsWithGroups } from "@/lib/events/round-service";
import { parseRoundScoreMode } from "@/lib/scoring/ranking";
import { RoundsManager } from "@/components/events/rounds-manager";

export default async function EventRoundsStepPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const context = await requireAuthContext();
  const event = await getEventById({
    database: db,
    eventId,
    organizationId: context.organization.id,
  });

  if (!event) notFound();

  const [roundGroups, roundsWithGroups, scoredRecordRounds, scoredEventRounds] =
    await Promise.all([
      listRoundGroups({ database: db, eventId, organizationId: context.organization.id }),
      listRoundsWithGroups({ database: db, eventId, organizationId: context.organization.id }),
      db
        .selectDistinct({ roundId: scoreRecords.roundId })
        .from(scoreRecords)
        .where(eq(scoreRecords.eventId, eventId)),
      db
        .selectDistinct({ roundId: scoreEvents.roundId })
        .from(scoreEvents)
        .where(eq(scoreEvents.eventId, eventId)),
    ]);

  // Sets with any recorded score (or score history) can't be deleted — the
  // manager disables their delete buttons; the services enforce it server-side.
  const scoredRoundIds = Array.from(
    new Set([...scoredRecordRounds, ...scoredEventRounds].map((r) => r.roundId)),
  );

  const roundScoreMode = parseRoundScoreMode(
    (event.config as Record<string, unknown> | null)?.roundScoreMode,
  );

  return (
    <RoundsManager
      eventId={eventId}
      roundScoreMode={roundScoreMode}
      scoredRoundIds={scoredRoundIds}
      roundGroups={roundGroups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        position: g.position,
        carryOverScores: g.carryOverScores,
        carryOverWeight: g.carryOverWeight,
        advanceCount: g.advanceCount,
        advanceDisplayOrder: g.advanceDisplayOrder,
        scoringMethod: g.scoringMethod,
      }))}
      rounds={roundsWithGroups.map(({ round }) => ({
        id: round.id,
        name: round.name,
        description: round.description,
        position: round.position,
        isLocked: round.isLocked,
        isManualEntry: round.isManualEntry,
        roundGroupId: round.roundGroupId,
      }))}
    />
  );
}
