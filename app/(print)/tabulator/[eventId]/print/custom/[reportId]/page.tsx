import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getCustomPrintReportResults } from "@/lib/scoring/custom-print-report-service";
import { CustomPrintResultsView } from "@/components/scoring/custom-print-results-view";

export const dynamic = "force-dynamic";

export default async function CustomPrintReportPage({
  params,
}: {
  params: Promise<{ eventId: string; reportId: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "score.review")) notFound();

  const { eventId, reportId } = await params;

  let results;
  try {
    results = await getCustomPrintReportResults({
      database: db,
      organizationId: context.organization.id,
      eventId,
      reportId,
    });
  } catch {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <CustomPrintResultsView eventId={eventId} results={results} />
    </Suspense>
  );
}
