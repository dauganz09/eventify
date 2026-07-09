import { notFound } from "next/navigation";
import { Suspense } from "react";
import { JudgeScoresPrintToolbar } from "@/components/scoring/judge-scores-print-picker";
import {
  PrintDocument,
  PrintDocumentBody,
  PrintDocumentHeader,
  PrintRoundBanner,
  PrintSectionHeader,
  PrintSignatureBlock,
  PrintTable,
  PrintTheadRow,
  PrintTh,
} from "@/components/scoring/print-report-ui";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  getJudgeScoresReport,
  getJudgeScoresReportPicker,
  type JudgeRoundReport,
  type JudgeSetReport,
} from "@/lib/scoring/judge-scores-report-service";

export const dynamic = "force-dynamic";

export default async function JudgeScoresPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ judge?: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "score.review")) notFound();

  const { eventId } = await params;
  const { judge: judgeId } = await searchParams;

  let picker;
  try {
    picker = await getJudgeScoresReportPicker({
      database: db,
      organizationId: context.organization.id,
      eventId,
    });
  } catch {
    notFound();
  }

  if (!judgeId) {
    return (
      <div className="grid gap-6 print:gap-0">
        <Suspense fallback={null}>
          <JudgeScoresPrintToolbar eventId={eventId} judgeId={null} judges={picker.judges} />
        </Suspense>
        <div className="rounded-lg border border-dashed border-border p-12 text-center print:hidden">
          <p className="text-lg font-medium">Judge score sheet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Select a judge above to view and print every score they submitted for
            the rounds and sets they are assigned to.
          </p>
        </div>
      </div>
    );
  }

  let report;
  try {
    report = await getJudgeScoresReport({
      database: db,
      organizationId: context.organization.id,
      eventId,
      judgeId,
    });
  } catch {
    notFound();
  }

  const totalSets =
    report.rounds.reduce((sum, round) => sum + round.sets.length, 0) +
    report.ungroupedSets.length;
  const generatedDate = new Date(report.generatedAt);

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
      })}
      {totalSets > 0 && (
        <>
          {" "}
          · {totalSets} set{totalSets === 1 ? "" : "s"}
        </>
      )}
    </>
  );

  return (
    <div className="grid gap-6 print:gap-0">
      <Suspense fallback={null}>
        <JudgeScoresPrintToolbar
          eventId={eventId}
          judgeId={judgeId}
          judges={picker.judges}
          generatedAt={report.generatedAt}
        />
      </Suspense>

      <PrintDocument wide>
        <PrintDocumentHeader
          eventName={report.event.name}
          eventLogoUrl={report.event.logoUrl}
          eyebrow="Judge Score Sheet"
          subtitle={report.judge.displayName}
          meta={meta}
        />

        <PrintDocumentBody>
          {totalSets === 0 ? (
            <p className="rpt-empty-state">
              No assigned sets with scores for {report.judge.displayName} yet.
            </p>
          ) : (
            <>
              {report.rounds.map((round) => (
                <RoundBlock key={round.roundId} round={round} judgeName={report.judge.displayName} />
              ))}
              {report.ungroupedSets.map((set) => (
                <div key={set.setId} className="grid gap-4 rpt-break-avoid">
                  <SetScoresTable set={set} />
                  <PrintSignatureBlock
                    judges={[{ id: report.judge.id, displayName: report.judge.displayName }]}
                    label={`Certified by ${report.judge.displayName} — ${set.setName}`}
                  />
                </div>
              ))}
            </>
          )}
        </PrintDocumentBody>
      </PrintDocument>
    </div>
  );
}

function RoundBlock({
  round,
  judgeName,
}: {
  round: JudgeRoundReport;
  judgeName: string;
}) {
  return (
    <div className="grid gap-6">
      <PrintRoundBanner label="Round" title={round.roundName} />
      {round.sets.map((set) => (
        <div key={set.setId} className="grid gap-4 rpt-break-avoid">
          <SetScoresTable set={set} />
        </div>
      ))}
      <PrintSignatureBlock
        judges={[{ id: "judge", displayName: judgeName }]}
        label={`Certified by ${judgeName} — ${round.roundName}`}
      />
    </div>
  );
}

function SetScoresTable({ set }: { set: JudgeSetReport }) {
  if (set.criteria.length === 0) {
    return (
      <section className="grid gap-2">
        <PrintSectionHeader title={set.setName} subtitle="No criteria configured" />
        <p className="rpt-empty-state">No scores for this set.</p>
      </section>
    );
  }

  const scoredRows = set.rows.filter((row) => row.total !== null);

  return (
    <section className="grid gap-2 rpt-break-avoid">
      <PrintSectionHeader
        title={set.setName}
        subtitle={`${scoredRows.length} of ${set.rows.length} contestant${set.rows.length === 1 ? "" : "s"} scored`}
      />
      <div className="overflow-x-auto">
        <PrintTable>
          <PrintTheadRow>
            <PrintTh className="w-16">No.</PrintTh>
            <PrintTh>Contestant</PrintTh>
            {set.criteria.map((crit) => (
              <PrintTh key={crit.id} align="right" className="max-w-28">
                <span className="block truncate">{crit.name}</span>
                <span className="block text-[0.6rem] font-normal opacity-80">{crit.weight}%</span>
              </PrintTh>
            ))}
            <PrintTh align="right">Total</PrintTh>
          </PrintTheadRow>
          <tbody>
            {set.rows.map((row, index) => (
              <tr
                key={row.contestantId}
                className={`rpt-tbody-row ${index % 2 === 1 ? "rpt-tbody-row-alt" : ""}`}
              >
                <td className="rpt-td rpt-td-mono">
                  {row.displayNumber ? `#${row.displayNumber}` : "—"}
                </td>
                <td className="rpt-td rpt-td-name">{row.displayName}</td>
                {set.criteria.map((crit) => {
                  const value = row.scores[crit.id];
                  return (
                    <td key={crit.id} className="rpt-td rpt-td-muted rpt-td-right">
                      {value !== null ? value.toFixed(2) : "—"}
                    </td>
                  );
                })}
                <td className="rpt-td rpt-td-value">
                  {row.total !== null ? row.total.toFixed(2) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </PrintTable>
      </div>
    </section>
  );
}
