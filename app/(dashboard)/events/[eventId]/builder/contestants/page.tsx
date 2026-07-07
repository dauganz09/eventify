import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { listContestants } from "@/lib/events/contestant-service";
import { getEventById } from "@/lib/events/event-service";
import { ContestantsManager } from "@/components/events/contestants-manager";

export default async function EventContestantsStepPage({
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

  const contestants = await listContestants({
    database: db,
    eventId,
    organizationId: context.organization.id,
  });

  return (
    <ContestantsManager
      eventId={eventId}
      contestants={contestants.map((c) => ({
        id: c.id,
        displayNumber: c.displayNumber,
        displayName: c.displayName,
        category: c.category,
        division: c.division,
        photoUrl: c.photoUrl,
        position: c.position,
      }))}
    />
  );
}
