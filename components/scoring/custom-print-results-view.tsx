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
  const colCount = 3 + 1 + judgeCols.length + 1;

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
                  judgeCols.length > 0 ? (
                    <>
                      Columns show each judge&apos;s own score; {valueLabel.toLowerCase()} is the
                      combined result. &ldquo;—&rdquo; means the judge did not score that contestant.
                    </>
                  ) : undefined
                }
              >
                <PrintTheadRow>
                  <PrintTh>Rank</PrintTh>
                  <PrintTh className="w-20">No.</PrintTh>
                  <PrintTh>Contestant</PrintTh>
                  <PrintTh align="right" className="w-16">
                    Sets
                  </PrintTh>
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
                  judgeCols={judgeCols}
                  colCount={colCount}
                />
              </PrintTable>
            )}
          </section>

          {results.sets.map((set) => (
            <section key={set.id} className="grid gap-2 rpt-break-avoid">
              <PrintSectionHeader
                title={results.setLabels.find((s) => s.id === set.id)?.label ?? set.name}
                subtitle="Per-set ranking (included in combined total above)"
              />
              {set.ranking.length === 0 ? (
                <p className="rpt-empty-state">No scores submitted yet.</p>
              ) : (
                <PrintTable>
                  <PrintTheadRow>
                    <PrintTh>Rank</PrintTh>
                    <PrintTh className="w-20">No.</PrintTh>
                    <PrintTh>Contestant</PrintTh>
                    <PrintTh align="right" className="w-24">
                      Total
                    </PrintTh>
                  </PrintTheadRow>
                  <PrintRankingRows
                    rows={set.ranking}
                    judgeCols={[]}
                    colCount={4}
                  />
                </PrintTable>
              )}
            </section>
          ))}
        </PrintDocumentBody>

        <PrintSignatureBlock judges={results.judges} />
        <PrintVerificationFooter code={results.verificationCode} />
      </PrintDocument>
    </div>
  );
}
