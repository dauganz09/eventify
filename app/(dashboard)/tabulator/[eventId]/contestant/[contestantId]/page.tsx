import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getContestantBreakdown } from "@/lib/scoring/insights-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function fmt(value: number | null) {
  return value === null ? "—" : value.toFixed(2);
}

export default async function ContestantBreakdownPage({
  params,
}: {
  params: Promise<{ eventId: string; contestantId: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "score.review")) notFound();

  const { eventId, contestantId } = await params;

  let data;
  try {
    data = await getContestantBreakdown({
      database: db,
      organizationId: context.organization.id,
      eventId,
      contestantId,
    });
  } catch {
    notFound();
  }

  const { contestant, judges, sets } = data;

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
        <div className="mt-3 flex items-center gap-4">
          {contestant.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contestant.photoUrl}
              alt={contestant.displayName}
              className="size-16 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
              {contestant.displayNumber ?? "?"}
            </span>
          )}
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {contestant.displayName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {contestant.displayNumber ? `#${contestant.displayNumber} · ` : ""}
              {data.event.name}
            </p>
          </div>
        </div>
      </div>

      {sets.map((set) => (
        <Card key={set.setId}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{set.setName}</span>
              <span className="text-base font-normal text-muted-foreground">
                Set total:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {fmt(set.setTotal)}
                </span>
              </span>
            </CardTitle>
            <CardDescription>
              Each judge&apos;s raw score per criterion, with their weighted set total.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {set.criteria.length === 0 ? (
              <p className="text-sm text-muted-foreground">No criteria in this set.</p>
            ) : (
              <div className="relative w-full overflow-auto rounded-md border border-border">
                <table className="w-full caption-bottom text-sm">
                  <thead className="bg-muted/40">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left font-medium">Criterion</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                        Weight
                      </th>
                      {judges.map((j) => (
                        <th
                          key={j.id}
                          className="px-3 py-2 text-right font-medium"
                        >
                          {j.displayName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {set.criteria.map((crit) => (
                      <tr key={crit.criterionId} className="border-b border-border">
                        <td className="px-3 py-2 font-medium">{crit.criterionName}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {crit.weight}%
                        </td>
                        {judges.map((j) => {
                          const v = crit.byJudge[j.id];
                          return (
                            <td
                              key={j.id}
                              className="px-3 py-2 text-right tabular-nums"
                            >
                              {v === null || v === undefined ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                v
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                      <td className="px-3 py-2" colSpan={2}>
                        Weighted total
                      </td>
                      {judges.map((j) => (
                        <td key={j.id} className="px-3 py-2 text-right tabular-nums">
                          {fmt(set.judgeTotals[j.id] ?? null)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
