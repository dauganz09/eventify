"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CustomPrintReportResults } from "@/lib/scoring/custom-print-report-service";
import {
  PrintDocument,
  PrintDocumentBody,
  PrintDocumentHeader,
  PrintRankingRows,
  PrintSectionHeader,
  PrintSignatureBlock,
  PrintTable,
  PrintTheadRow,
  PrintTh,
  PrintVerificationFooter,
} from "@/components/scoring/print-report-ui";

export function CustomPrintResultsView({
  eventId,
  results,
}: {
  eventId: string;
  results: CustomPrintReportResults;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showJudges = searchParams.get("judges") === "1";
  const generatedDate = new Date(results.generatedAt);

  function toggleJudges(next: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("judges", "1");
    else params.delete("judges");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const valueLabel = results.roundScoreMode === "sum" ? "Points" : "Average";
  const judgeCols = showJudges ? results.judges : [];

  // Per-set score behind the combined total, keyed by set so the combined
  // ranking table can show each contestant's score in every selected set.
  const setValueById = new Map(
    results.sets.map((set) => [
      set.id,
      new Map(set.ranking.map((row) => [row.contestantId, row.value])),
    ]),
  );
  const setCols = results.setLabels.map((set) => ({
    id: set.id,
    label: set.label,
    valueOf: (contestantId: string) => setValueById.get(set.id)?.get(contestantId) ?? null,
  }));

  const colCount = 3 + 1 + setCols.length + judgeCols.length + 1;

  const meta = (
    <>
      {generatedDate.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}{" "}
      ·{" "}
      {generatedDate.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}{" "}
      · {results.contestants} contestants
    </>
  );

  return (
    <div className="grid gap-6 print:gap-0">
      <div className="rpt-page-toolbar flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/tabulator/${eventId}`}
          className="inline-flex items-center gap-1 text-sm text-[#5c6478] hover:text-[#0f1f3d]"
        >
          <ArrowLeft className="size-4" />
          Back to tabulator
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="show-judges"
              checked={showJudges}
              onCheckedChange={toggleJudges}
            />
            <Label htmlFor="show-judges" className="text-sm text-[#5c6478]">
              Judge scores
            </Label>
          </div>
          <span className="text-xs text-[#5c6478]">
            Generated {generatedDate.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Printer className="size-4" />
            Print
          </button>
        </div>
      </div>

      <PrintDocument>
        <PrintDocumentHeader
          eventName={results.event.name}
          eventLogoUrl={results.event.logoUrl}
          eyebrow="Custom Results Report"
          subtitle={results.definition.name}
          meta={meta}
        />

        <PrintDocumentBody>
          {results.definition.description ? (
            <p className="mb-4 text-sm text-[#5c6478]">{results.definition.description}</p>
          ) : null}

          <section className="grid gap-2 rpt-break-avoid">
            <PrintSectionHeader
              title="Combined Ranking"
              subtitle={
                results.roundScoreMode === "sum"
                  ? `Total points across ${results.setLabels.map((s) => s.label).join(" + ")}`
                  : `Average across ${results.setLabels.map((s) => s.label).join(" + ")}`
              }
            />
            {results.ranking.length === 0 ? (
              <p className="rpt-empty-state">No scores submitted yet for the selected sets.</p>
            ) : (
              <PrintTable
                caption={
                  <>
                    {setCols.length > 0 && (
                      <>
                        Per-set columns show each contestant&apos;s score in that set;{" "}
                        {valueLabel.toLowerCase()} is the combined result.{" "}
                      </>
                    )}
                    {judgeCols.length > 0 && (
                      <>Judge columns show that judge&apos;s own score. </>
                    )}
                    {(setCols.length > 0 || judgeCols.length > 0) && (
                      <>&ldquo;—&rdquo; means not scored there.</>
                    )}
                  </>
                }
              >
                <PrintTheadRow>
                  <PrintTh>Rank</PrintTh>
                  <PrintTh className="w-20">No.</PrintTh>
                  <PrintTh>Contestant</PrintTh>
                  <PrintTh align="right" className="w-16">
                    Sets
                  </PrintTh>
                  {setCols.map((set) => (
                    <PrintTh key={set.id} align="right">
                      {set.label}
                    </PrintTh>
                  ))}
                  {judgeCols.map((judge) => (
                    <PrintTh key={judge.id} align="right">
                      {judge.displayName}
                    </PrintTh>
                  ))}
                  <PrintTh align="right" className="w-24">
                    {valueLabel}
                  </PrintTh>
                </PrintTheadRow>
                <PrintRankingRows
                  rows={results.ranking}
                  showScoredCount
                  extraCols={setCols}
                  judgeCols={judgeCols}
                  colCount={colCount}
                />
              </PrintTable>
            )}
          </section>
        </PrintDocumentBody>

        <PrintSignatureBlock judges={results.judges} />
        <PrintVerificationFooter code={results.verificationCode} />
      </PrintDocument>
    </div>
  );
}
