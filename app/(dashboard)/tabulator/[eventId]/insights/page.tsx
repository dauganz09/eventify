import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getEventInsights } from "@/lib/scoring/insights-service";
import { InsightsTables } from "@/components/scoring/insights-tables";

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "score.review")) notFound();

  const { eventId } = await params;

  let insights;
  try {
    insights = await getEventInsights({
      database: db,
      organizationId: context.organization.id,
      eventId,
    });
  } catch {
    notFound();
  }

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href={`/tabulator/${eventId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to tabulator
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">{insights.event.name}</p>
      </div>

      <InsightsTables
        conflicts={insights.conflicts}
        judges={insights.judges}
        criteria={insights.criteria}
      />
    </div>
  );
}
