import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { getEventById } from "@/lib/events/event-service";
import { listJudgeAssignments, listJudges } from "@/lib/events/judge-service";
import { listRoundGroups } from "@/lib/events/round-group-service";
import { listRounds } from "@/lib/events/round-service";
import { JudgesManager } from "@/components/events/judges-manager";

export default async function EventJudgesStepPage({
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

  const [judges, assignments, roundGroups, sets] = await Promise.all([
    listJudges({ database: db, eventId, organizationId: context.organization.id }),
    listJudgeAssignments({ database: db, eventId, organizationId: context.organization.id }),
    listRoundGroups({ database: db, eventId, organizationId: context.organization.id }),
    listRounds({ database: db, eventId, organizationId: context.organization.id }),
  ]);

  // Judges are assigned to ROUNDS (round groups). Older assignments may still
  // point at a single set — label those with the set's name so they stay legible.
  const groupNameById = new Map(roundGroups.map((g) => [g.id, g.name]));
  const setNameById = new Map(sets.map((s) => [s.id, s.name]));

  return (
    <JudgesManager
      eventId={eventId}
      judges={judges.map((j) => ({
        id: j.id,
        displayName: j.displayName,
        username: j.username,
        email: j.email,
        isActive: j.isActive,
      }))}
      assignments={assignments.map((a) => ({
        judgeId: a.judgeId,
        roundGroupId: a.roundGroupId,
        label: a.roundGroupId
          ? (groupNameById.get(a.roundGroupId) ?? "Unknown round")
          : a.roundId
            ? `Set: ${setNameById.get(a.roundId) ?? "Unknown"}`
            : "Event-wide",
      }))}
      rounds={roundGroups.map((g) => ({ id: g.id, name: g.name }))}
    />
  );
}
