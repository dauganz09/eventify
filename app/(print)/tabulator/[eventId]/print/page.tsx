import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getEventResultsReport } from "@/lib/scoring/print-report-service";
import { buildPrintScopeOptions } from "@/lib/scoring/print-report-scope";
import { PrintResultsView } from "@/components/scoring/print-results-view";

export const dynamic = "force-dynamic";

export default async function PrintResultsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
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

  const scopeOptions = buildPrintScopeOptions(report);

  return (
    <Suspense fallback={null}>
      <PrintResultsView
        eventId={eventId}
        report={report}
        scopeOptions={scopeOptions}
      />
    </Suspense>
  );
}
