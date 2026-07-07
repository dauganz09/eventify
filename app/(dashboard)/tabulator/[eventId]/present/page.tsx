import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contestants } from "@/db/schema";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { PRESENT_FEATURE_ENABLED } from "@/lib/feature-flags";
import { getEventResultsReport } from "@/lib/scoring/print-report-service";
import {
  PresentationStage,
  type PresentEntry,
} from "@/components/scoring/presentation-stage";

export default async function PresentPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  if (!PRESENT_FEATURE_ENABLED) notFound();

  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "score.review")) notFound();

  const { eventId } = await params;

  let report;
  try {
    report = await getEventResultsReport({
      database: db,
      organizationId: context.organization.id,
      eventId,
    });
  } catch {
    notFound();
  }

  // Merge photos for a richer reveal.
  const photoRows = await db
    .select({ id: contestants.id, photoUrl: contestants.photoUrl })
    .from(contestants)
    .where(eq(contestants.eventId, eventId));
  const photoById = new Map(photoRows.map((p) => [p.id, p.photoUrl]));

  // A finished rank-order round (e.g. the Final Q&A) decides the winners — use
  // its placements for the reveal. Otherwise fall back to the overall standings.
  const rankOrderFinal = [...report.rounds]
    .reverse()
    .find(
      (round) =>
        round.status === "finished" &&
        round.rankOrder !== null &&
        round.rankOrder.rows.length > 0,
    );

  const entries: PresentEntry[] = rankOrderFinal?.rankOrder
    ? rankOrderFinal.rankOrder.rows.map((r) => ({
        rank: r.placement,
        contestantId: r.contestantId,
        displayNumber: r.displayNumber,
        displayName: r.displayName,
        value: r.rankSum,
        photoUrl: photoById.get(r.contestantId) ?? null,
      }))
    : report.overall.map((r) => ({
        rank: r.rank,
        contestantId: r.contestantId,
        displayNumber: r.displayNumber,
        displayName: r.displayName,
        value: r.value,
        photoUrl: photoById.get(r.contestantId) ?? null,
      }));

  const canControl = hasPermission(context.authorization, "score.adjust");

  return (
    <PresentationStage
      eventId={eventId}
      eventName={report.event.name}
      eventLogoUrl={report.event.logoUrl}
      entries={entries}
      canControl={canControl}
    />
  );
}
