import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/scoring/print-button";
import {
  PrintDocument,
  PrintDocumentBody,
  PrintDocumentHeader,
  PrintRankBadge,
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
  getDetailedScoreReport,
  type CriterionBlock,
  type SetScoresheet,
  type RoundScoresheet,
  type DetailedScoreReport,
} from "@/lib/scoring/scoresheet-service";
import {
  getEventResultsReport,
  type RankedRow,
  type RoundReport,
} from "@/lib/scoring/print-report-service";

type RankOrderResult = NonNullable<RoundReport["rankOrder"]>;
type ScoreMode = "weighted" | "raw";

function parseMode(raw: string | undefined): ScoreMode {
  return raw === "raw" ? "raw" : "weighted";
}

export default async function ScoresheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "score.review")) notFound();

  const { eventId } = await params;
  const { mode: modeRaw } = await searchParams;
  const mode = parseMode(modeRaw);

  let report: DetailedScoreReport;
  let cumulative: RankedRow[] = [];
  const rankOrderByRound = new Map<string, RankOrderResult>();
  try {
    const [detailed, results] = await Promise.all([
      getDetailedScoreReport({
        database: db,
        organizationId: context.organization.id,
        eventId,
      }),
      getEventResultsReport({
        database: db,
        organizationId: context.organization.id,
        eventId,
      }),
    ]);
    report = detailed;
    cumulative = results.overall;
    for (const r of results.rounds) {
      if (r.rankOrder && r.rankOrder.rows.length > 0) {
        rankOrderByRound.set(r.id, r.rankOrder);
      }
    }
  } catch {
    notFound();
  }

  const generatedDate = new Date(report.generatedAt);
  const totalSets =
    report.rounds.reduce((s, r) => s + r.sets.length, 0) + report.ungroupedSets.length;

  if (totalSets === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
        <p className="text-lg font-medium">No sets with scores yet.</p>
        <Link href={`/tabulator/${eventId}`} className="text-sm underline">
          Back to tabulator
        </Link>
      </div>
    );
  }

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
          <div className="flex items-center overflow-hidden rounded-lg border">
            <Link
              href={`?mode=weighted`}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "weighted"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              Weighted
            </Link>
            <Link
              href={`?mode=raw`}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "raw"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              Raw
            </Link>
          </div>
          <span className="text-xs text-[#5c6478]">
            Generated {generatedDate.toLocaleString()}
          </span>
          <PrintButton />
        </div>
      </div>

      <PrintDocument wide>
        <PrintDocumentHeader
          eventName={report.event.name}
          eventLogoUrl={report.event.logoUrl}
          eyebrow="Judge Score Breakdown"
          subtitle={`${mode === "raw" ? "Raw Scores" : "Weighted Scores"} — Per Judge · Per Criterion`}
          meta={meta}
        />

        <PrintDocumentBody>
          {cumulative.length > 0 && <CumulativeStandings rows={cumulative} />}
          {report.rounds.map((round) => (
            <RoundSection
              key={round.roundId}
              round={round}
              mode={mode}
              rankOrder={rankOrderByRound.get(round.roundId) ?? null}
            />
          ))}
          {report.ungroupedSets.map((set) => (
            <div key={set.setId} className="grid gap-6 rpt-break-avoid">
              <SetSection set={set} mode={mode} roundName={null} />
              <PrintSignatureBlock
                judges={set.judges.map((j) => ({ id: j.id, displayName: j.name }))}
                label={`Certified by the judges for ${set.setName}`}
              />
            </div>
          ))}
        </PrintDocumentBody>
      </PrintDocument>
    </div>
  );
}

function CumulativeStandings({ rows }: { rows: RankedRow[] }) {
  return (
    <section className="grid gap-3 rpt-break-avoid">
      <PrintSectionHeader
        title="Cumulative Standings"
        subtitle="Accumulated scores across the point rounds — the basis for advancement. Rank-order rounds are excluded."
      />
      <PrintTable>
        <PrintTheadRow>
          <PrintTh className="w-12">Rank</PrintTh>
          <PrintTh>Candidate</PrintTh>
          <PrintTh align="right">Rounds</PrintTh>
          <PrintTh align="right">Total</PrintTh>
        </PrintTheadRow>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.contestantId}
              className={`rpt-tbody-row ${index % 2 === 1 ? "rpt-tbody-row-alt" : ""}`}
            >
              <td className="rpt-td">
                <PrintRankBadge rank={row.rank} />
              </td>
              <td className="rpt-td rpt-td-name">
                {row.displayNumber ? `${row.displayNumber}. ` : ""}
                {row.displayName}
              </td>
              <td className="rpt-td rpt-td-muted rpt-td-right">{row.scoredCount}</td>
              <td className="rpt-td rpt-td-value">{row.value.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </PrintTable>
    </section>
  );
}

function RoundSection({
  round,
  mode,
  rankOrder,
}: {
  round: RoundScoresheet;
  mode: ScoreMode;
  rankOrder: RankOrderResult | null;
}) {
  if (round.sets.length === 0) return null;

  const seen = new Set<string>();
  const roundJudges: { id: string; name: string }[] = [];
  for (const set of round.sets) {
    for (const judge of set.judges) {
      if (seen.has(judge.id)) continue;
      seen.add(judge.id);
      roundJudges.push(judge);
    }
  }

  return (
    <div className="grid gap-8">
      <PrintRoundBanner label="Round" title={round.roundName} />
      {rankOrder && <RankOrderResultTable rankOrder={rankOrder} />}
      {round.sets.map((set) => (
        <SetSection key={set.setId} set={set} mode={mode} roundName={round.roundName} />
      ))}
      <PrintSignatureBlock
        judges={roundJudges.map((j) => ({ id: j.id, displayName: j.name }))}
        label={`Certified by the judges for ${round.roundName}`}
      />
    </div>
  );
}

function RankOrderResultTable({ rankOrder }: { rankOrder: RankOrderResult }) {
  return (
    <section className="grid gap-3 rpt-break-avoid">
      <PrintSectionHeader
        title="Rank Order Result"
        subtitle="Each judge's scores become ranks; the ranks are summed across judges and the lowest rank sum wins."
      />
      <PrintTable
        caption={
          <>
            Under each judge: their rank for the contestant, with the score that produced it
            below. &ldquo;—&rdquo; means the judge did not score that contestant.
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
                          <span className="rpt-td-subtle">
                            {score.toFixed(2)}
                          </span>
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
    </section>
  );
}

function SetSection({
  set,
  mode,
  roundName,
}: {
  set: SetScoresheet;
  mode: ScoreMode;
  roundName: string | null;
}) {
  if (set.criteria.length === 0) {
    return (
      <section className="grid gap-3 rpt-break-avoid">
        <SetHeader set={set} roundName={roundName} />
        <p className="rpt-empty-state">No scores submitted for this set.</p>
      </section>
    );
  }

  return (
    <section className="grid gap-6">
      <SetHeader set={set} roundName={roundName} />
      {set.criteria.map((crit) => (
        <CriterionTable key={crit.criterionId} block={crit} judges={set.judges} mode={mode} />
      ))}
      {set.summary.length > 0 && <SummaryTable set={set} mode={mode} />}
    </section>
  );
}

function SetHeader({
  set,
  roundName,
}: {
  set: SetScoresheet;
  roundName: string | null;
}) {
  return (
    <div className="rpt-set-header">
      <h3 className="rpt-set-header-title">{set.setName}</h3>
      {roundName && <span className="rpt-set-header-meta">{roundName}</span>}
      {set.judges.length > 0 && (
        <span className="rpt-set-header-meta ml-auto">
          Judges: {set.judges.map((j) => j.name).join(" · ")}
        </span>
      )}
    </div>
  );
}

function CriterionTable({
  block,
  judges,
  mode,
}: {
  block: CriterionBlock;
  judges: { id: string; name: string }[];
  mode: ScoreMode;
}) {
  if (block.rows.length === 0) return null;

  return (
    <div className="grid gap-1.5 rpt-break-avoid">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">{block.criterionName}</h4>
        <span className="rpt-weight-pill">{block.weight}% weight</span>
      </div>

      <div className="overflow-x-auto">
        <PrintTable>
          <PrintTheadRow>
            <PrintTh>Contestant</PrintTh>
            {judges.map((j) => (
              <PrintTh key={j.id} align="right">
                {j.name}
              </PrintTh>
            ))}
            <PrintTh align="right">{mode === "weighted" ? "Wtd. Avg" : "Raw Avg"}</PrintTh>
          </PrintTheadRow>
          <tbody>
            {block.rows.map((row, i) => {
              const avgVal = mode === "weighted" ? row.weightedMean : row.rawMean;
              return (
                <tr
                  key={row.contestantId}
                  className={`rpt-tbody-row ${i % 2 === 1 ? "rpt-tbody-row-alt" : ""}`}
                >
                  <td className="rpt-td rpt-td-name">
                    {row.contestantNumber && (
                      <span className="mr-1.5 font-mono text-xs rpt-td-subtle">
                        #{row.contestantNumber}
                      </span>
                    )}
                    {row.contestantName}
                  </td>
                  {judges.map((j) => {
                    const cell = row.cells.find((c) => c.judgeId === j.id);
                    const val = cell ? (mode === "weighted" ? cell.weighted : cell.raw) : null;
                    return (
                      <td key={j.id} className="rpt-td rpt-td-muted rpt-td-right">
                        {val !== null ? val.toFixed(2) : "—"}
                      </td>
                    );
                  })}
                  <td className="rpt-td rpt-td-value">{avgVal !== null ? avgVal.toFixed(2) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </PrintTable>
      </div>
    </div>
  );
}

function SummaryTable({ set, mode }: { set: SetScoresheet; mode: ScoreMode }) {
  return (
    <div className="grid gap-1.5 rpt-break-avoid">
      <h4 className="text-sm font-semibold uppercase tracking-wide rpt-set-header-meta">
        Set total — {mode === "weighted" ? "weighted" : "raw"} scores
      </h4>
      <PrintTable>
        <PrintTheadRow>
          <PrintTh>Rank</PrintTh>
          <PrintTh className="w-20">No.</PrintTh>
          <PrintTh>Contestant</PrintTh>
          {set.criteria.map((c) => (
            <PrintTh key={c.criterionId} align="right" className="max-w-24">
              <span className="block truncate">{c.criterionName}</span>
              <span className="block text-[0.6rem] font-normal opacity-80">{c.weight}%</span>
            </PrintTh>
          ))}
          <PrintTh align="right">Total</PrintTh>
        </PrintTheadRow>
        <tbody>
          {set.summary.map((row, i) => (
            <tr
              key={row.contestantId}
              className={`rpt-tbody-row ${i % 2 === 1 ? "rpt-tbody-row-alt" : ""}`}
            >
              <td className="rpt-td">
                <PrintRankBadge rank={row.rank} />
              </td>
              <td className="rpt-td rpt-td-muted rpt-td-mono">
                {row.contestantNumber ? `#${row.contestantNumber}` : "—"}
              </td>
              <td className="rpt-td rpt-td-name">{row.contestantName}</td>
              {set.criteria.map((c) => {
                const val = row.bycriterion[c.criterionId] ?? null;
                return (
                  <td key={c.criterionId} className="rpt-td rpt-td-muted rpt-td-right">
                    {val !== null ? val.toFixed(2) : "—"}
                  </td>
                );
              })}
              <td className="rpt-td rpt-td-value">{row.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </PrintTable>
    </div>
  );
}
