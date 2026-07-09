"use client";

import { useSearchParams } from "next/navigation";
import { PrintControls } from "@/components/scoring/print-controls";
import type { ScopeOption } from "@/components/scoring/print-scope-selector";
import {
  PrintDocument,
  PrintDocumentBody,
  PrintDocumentHeader,
  PrintRankBadge,
  PrintRankingRows,
  PrintRoundBanner,
  PrintSectionHeader,
  PrintSignatureBlock,
  PrintTable,
  PrintTheadRow,
  PrintTh,
  PrintVerificationFooter,
} from "@/components/scoring/print-report-ui";
import {
  parsePrintScope,
  printScopeToValue,
  resolvePrintScopeView,
} from "@/lib/scoring/print-report-scope";
import type {
  JudgeReport,
  RankedRow,
  ResultsReport,
  RoundReport,
  SetReport,
} from "@/lib/scoring/print-report-service";
import type { RoundScoreMode } from "@/lib/scoring/ranking";

export function PrintResultsView({
  eventId,
  report,
  scopeOptions,
}: {
  eventId: string;
  report: ResultsReport;
  scopeOptions: ScopeOption[];
}) {
  const searchParams = useSearchParams();
  const scope = parsePrintScope(searchParams.get("scope"));
  const showJudges = searchParams.get("judges") === "1";
  const view = resolvePrintScopeView(report, scope);
  const generatedDate = new Date(report.generatedAt);

  const overallJudges = dedupeJudges([
    ...report.rounds.flatMap((r) => r.judges),
    ...report.ungroupedSets.flatMap((s) => s.judges),
  ]);

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
      · {report.contestants} contestants
    </>
  );

  const scopeKey = `${printScopeToValue(scope)}-${showJudges ? "judges" : "summary"}`;

  return (
    <div className="grid gap-6 print:gap-0">
      <PrintControls
        backHref={`/tabulator/${eventId}`}
        generatedAt={report.generatedAt}
        scope={printScopeToValue(scope)}
        scopeOptions={scopeOptions}
        showJudges={showJudges}
      />

      <PrintDocument key={scopeKey}>
        <PrintDocumentHeader
          eventName={report.event.name}
          eventLogoUrl={report.event.logoUrl}
          eyebrow="Official Results Report"
          subtitle={view.scopeTitle}
          meta={meta}
        />

        <PrintDocumentBody>
          {view.renderOverall && (
            <section className="grid gap-2 rpt-break-avoid">
              <PrintSectionHeader
                title="Overall Ranking"
                subtitle={
                  report.roundScoreMode === "sum"
                    ? "Event-wide total points"
                    : "Event-wide average"
                }
              />
              <RankingTable
                rows={report.overall}
                valueLabel={report.roundScoreMode === "sum" ? "Points" : "Average"}
                showScoredCount
                judges={showJudges ? overallJudges : undefined}
                advancement={report.advancement}
              />
            </section>
          )}

          {view.renderRounds.map((round) => (
            <RoundBlock
              key={round.id}
              round={round}
              mode={report.roundScoreMode}
              showJudges={showJudges}
            />
          ))}

          {view.renderUngrouped.length > 0 && (
            <div className="grid gap-6">
              {view.renderUngrouped.map((set) => (
                <div key={set.id} className="grid gap-6 rpt-break-avoid">
                  <section className="grid gap-2 rpt-break-avoid">
                    <PrintSectionHeader
                      title={set.name}
                      subtitle={set.carryOver ? "Carries forward" : undefined}
                    />
                    <SetTable set={set} showJudges={showJudges} />
                  </section>
                  <PrintSignatureBlock
                    judges={set.judges}
                    label={`Certified by the judges for ${set.name}`}
                  />
                </div>
              ))}
            </div>
          )}

          {view.renderSingleSet && (
            <>
              <section className="grid gap-2 rpt-break-avoid">
                <PrintSectionHeader
                  title={view.renderSingleSet.set.name}
                  subtitle={
                    view.renderSingleSet.round
                      ? `${view.renderSingleSet.round.name} · per-set ranking`
                      : "Per-set ranking"
                  }
                />
                <SetTable set={view.renderSingleSet.set} showJudges={showJudges} />
              </section>
              <PrintSignatureBlock
                judges={view.renderSingleSet.set.judges}
                label={`Certified by the judges for ${view.renderSingleSet.set.name}`}
              />
            </>
          )}
        </PrintDocumentBody>

        {view.renderOverall &&
          view.renderRounds.length === 0 &&
          !view.renderSingleSet && (
            <PrintSignatureBlock judges={overallJudges} />
          )}

        <PrintVerificationFooter code={report.verificationCode} />
      </PrintDocument>
    </div>
  );
}

function RoundBlock({
  round,
  mode,
  showJudges,
}: {
  round: RoundReport;
  mode: RoundScoreMode;
  showJudges: boolean;
}) {
  return (
    <div className="grid gap-6 rpt-break-avoid">
      <PrintRoundBanner label="Round" title={round.name} />

      {round.rankOrder && round.rankOrder.rows.length > 0 && (
        <section className="grid gap-2 rpt-break-avoid">
          <PrintSectionHeader
            title="Rank Order Result"
            subtitle="Judges' ranks summed — lowest wins"
          />
          <RankOrderTable rankOrder={round.rankOrder} />
        </section>
      )}

      {!round.isRankOrder && (
        <>
          {round.ranking.length > 0 && (
            <section className="grid gap-2 rpt-break-avoid">
              <PrintSectionHeader
                title="Round Ranking"
                subtitle={
                  mode === "sum"
                    ? "Total points across this round's sets"
                    : "Average across this round's sets"
                }
              />
              <RankingTable
                rows={round.ranking}
                valueLabel={mode === "sum" ? "Points" : "Average"}
                showScoredCount
                judges={showJudges ? round.judges : undefined}
              />
            </section>
          )}

          {round.sets.map((set) => (
            <section key={set.id} className="grid gap-2 rpt-break-avoid">
              <PrintSectionHeader
                title={set.name}
                subtitle={set.carryOver ? "Carries forward" : undefined}
              />
              <SetTable set={set} showJudges={showJudges} />
            </section>
          ))}
        </>
      )}

      <PrintSignatureBlock
        judges={round.judges}
        label={`Certified by the judges for ${round.name}`}
      />
    </div>
  );
}

function SetTable({ set, showJudges }: { set: SetReport; showJudges?: boolean }) {
  if (set.ranking.length === 0) {
    return <p className="rpt-empty-state">No scores submitted yet.</p>;
  }
  return (
    <RankingTable
      rows={set.ranking}
      valueLabel="Total"
      judges={showJudges ? set.judges : undefined}
    />
  );
}

function RankingTable({
  rows,
  valueLabel,
  showScoredCount = false,
  judges,
  advancement,
}: {
  rows: RankedRow[];
  valueLabel: string;
  showScoredCount?: boolean;
  judges?: JudgeReport[];
  advancement?: ResultsReport["advancement"];
}) {
  const judgeCols = judges ?? [];
  const colCount = 3 + (showScoredCount ? 1 : 0) + judgeCols.length + 1;

  return (
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
        {showScoredCount && (
          <PrintTh align="right" className="w-16">
            Sets
          </PrintTh>
        )}
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
        rows={rows}
        showScoredCount={showScoredCount}
        judgeCols={judgeCols}
        advancement={advancement}
        colCount={colCount}
      />
    </PrintTable>
  );
}

function RankOrderTable({
  rankOrder,
}: {
  rankOrder: NonNullable<RoundReport["rankOrder"]>;
}) {
  return (
    <PrintTable
      caption={
        <>
          Under each judge: their rank for the contestant, with the score that produced it
          below it. Lowest rank sum wins.
        </>
      }
    >
      <PrintTheadRow>
        <PrintTh>Place</PrintTh>
        <PrintTh className="w-20">No.</PrintTh>
        <PrintTh>Contestant</PrintTh>
        {rankOrder.judges.map((judge) => (
          <PrintTh key={judge.id} align="right">
            {judge.displayName}
          </PrintTh>
        ))}
        <PrintTh align="right" className="w-24">
          Rank Sum
        </PrintTh>
      </PrintTheadRow>
      <tbody>
        {rankOrder.rows.map((row, index) => (
          <tr
            key={row.contestantId}
            className={`rpt-tbody-row ${index % 2 === 1 ? "rpt-tbody-row-alt" : ""}`}
          >
            <td className="rpt-td">
              <PrintRankBadge rank={row.placement} />
            </td>
            <td className="rpt-td rpt-td-mono">
              {row.displayNumber ? `#${row.displayNumber}` : "—"}
            </td>
            <td className="rpt-td rpt-td-name">{row.displayName}</td>
            {rankOrder.judges.map((judge) => {
              const rank = row.ranksByJudge[judge.id];
              const score = row.scoresByJudge?.[judge.id];
              return (
                <td key={judge.id} className="rpt-td rpt-td-right">
                  {rank == null ? (
                    "—"
                  ) : (
                    <span className="inline-flex flex-col items-end leading-tight">
                      <span className="font-semibold">{rank}</span>
                      {score != null && (
                        <span className="rpt-td-subtle">{score.toFixed(2)}</span>
                      )}
                    </span>
                  )}
                </td>
              );
            })}
            <td className="rpt-td rpt-td-value">{row.rankSum}</td>
          </tr>
        ))}
      </tbody>
    </PrintTable>
  );
}

function dedupeJudges(judges: JudgeReport[]): JudgeReport[] {
  const seen = new Set<string>();
  const out: JudgeReport[] = [];
  for (const judge of judges) {
    if (seen.has(judge.id)) continue;
    seen.add(judge.id);
    out.push(judge);
  }
  return out;
}
