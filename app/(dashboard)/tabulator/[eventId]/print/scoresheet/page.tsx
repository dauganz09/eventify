import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EventLogo } from "@/components/events/event-logo";
import { PrintButton } from "@/components/scoring/print-button";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  getDetailedScoreReport,
  type CriterionBlock,
  type ContestantSetSummary,
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

// ── Page ────────────────────────────────────────────────────────────────────

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
  // roundId -> rank-order result, for rounds scored by the rank-order method.
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
    // Cumulative standings across the point/carry-over rounds (rank-order rounds
    // are already excluded by the results service) — the advancement basis.
    cumulative = results.overall;
    // A rank-order round (e.g. Q&A) is decided by summed judge ranks, not by
    // the averaged criterion scores — surface that result in the breakdown too.
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
    report.rounds.reduce((s, r) => s + r.sets.length, 0) +
    report.ungroupedSets.length;

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

  return (
    <div className="grid gap-6 print:gap-0">
      {/* On-screen controls — hidden on print */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/tabulator/${eventId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to tabulator
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {/* Raw / Weighted toggle */}
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
          <span className="text-xs text-muted-foreground">
            Generated {generatedDate.toLocaleString()}
          </span>
          <PrintButton />
        </div>
      </div>

      {/* Printable document — always renders in the light "paper" design via
          `.print-document` (see globals.css), regardless of the app's
          dark-mode setting. */}
      <article className="print-document mx-auto w-full max-w-5xl rounded-lg border border-border bg-card p-8 text-foreground shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* Header */}
        <header className="border-b-4 border-double border-foreground pb-4 text-center print:border-black">
          <EventLogo
            src={report.event.logoUrl}
            alt={report.event.name}
            className="mx-auto mb-3 size-16"
          />
          <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground print:text-gray-600">
            Judge Score Breakdown
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight print:text-2xl">
            {report.event.name}
          </h1>
          <p className="mt-1 text-sm font-medium uppercase tracking-wider text-muted-foreground print:text-gray-600">
            {mode === "raw" ? "Raw Scores" : "Weighted Scores"} — Per Judge · Per Criterion
          </p>
          <p className="mt-3 text-xs text-muted-foreground print:text-gray-600">
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
          </p>
        </header>

        <div className="mt-8 grid gap-12">
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
            <div key={set.setId} className="grid gap-6 break-inside-avoid">
              <SetSection set={set} mode={mode} roundName={null} />
              <SignatureFooter
                judges={set.judges}
                label={`Certified by the judges for ${set.setName}`}
              />
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

// ── Round section ───────────────────────────────────────────────────────────

// ── Cumulative standings (advancement basis) ─────────────────────────────────

function CumulativeStandings({ rows }: { rows: RankedRow[] }) {
  return (
    <section className="grid gap-3 break-inside-avoid">
      <div className="border-b-2 border-foreground pb-1 print:border-black">
        <h2 className="text-lg font-bold uppercase tracking-wide">
          Cumulative Standings
        </h2>
        <p className="text-xs text-muted-foreground print:text-gray-600">
          Accumulated scores across the point rounds — the basis for advancement.
          Rank-order rounds are excluded (they decide their own result).
        </p>
      </div>
      <table className="w-full caption-bottom text-sm">
        <thead>
          <tr className="border-b border-foreground/30 text-left print:border-gray-400">
            <th className="w-12 py-1.5 pr-2 font-semibold">Rank</th>
            <th className="py-1.5 pr-2 font-semibold">Candidate</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Rounds</th>
            <th className="py-1.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.contestantId}
              className="border-b border-border/60 print:border-gray-300"
            >
              <td className="py-1.5 pr-2">
                <SummaryRankBadge rank={row.rank} />
              </td>
              <td className="py-1.5 pr-2 font-medium">
                {row.displayNumber ? `${row.displayNumber}. ` : ""}
                {row.displayName}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground print:text-gray-600">
                {row.scoredCount}
              </td>
              <td className="py-1.5 text-right font-semibold tabular-nums">
                {row.value.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  // Judges responsible for this round = union of its sets' scoring judges.
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
      <div className="border-y border-foreground/20 bg-muted/40 px-4 py-2 print:border-gray-400 print:bg-gray-100">
        <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground print:text-gray-600">
          Round
        </p>
        <h2 className="text-xl font-bold print:text-lg">{round.roundName}</h2>
      </div>
      {rankOrder && <RankOrderResultTable rankOrder={rankOrder} />}
      {round.sets.map((set) => (
        <SetSection key={set.setId} set={set} mode={mode} roundName={round.roundName} />
      ))}
      <SignatureFooter
        judges={roundJudges}
        label={`Certified by the judges for ${round.roundName}`}
      />
    </div>
  );
}

// ── Rank-order result (summed judge ranks — lowest wins) ─────────────────────

function RankOrderResultTable({ rankOrder }: { rankOrder: RankOrderResult }) {
  return (
    <section className="grid gap-3 break-inside-avoid">
      <div className="border-b-2 border-foreground pb-1 print:border-black">
        <h3 className="text-lg font-bold uppercase tracking-wide">
          Rank Order Result
        </h3>
        <p className="text-xs text-muted-foreground print:text-gray-600">
          Each judge&apos;s scores become ranks; the ranks are summed across judges
          and the lowest rank sum wins.
        </p>
      </div>
      <table className="w-full border-collapse text-sm">
        <caption className="caption-bottom pt-2 text-left text-[0.65rem] text-muted-foreground print:text-gray-500">
          Under each judge: their rank for the contestant, with the score that
          produced it below. &ldquo;—&rdquo; means the judge did not score that
          contestant.
        </caption>
        <thead>
          <tr className="border-b-2 border-foreground bg-foreground/5 print:border-black print:bg-gray-100">
            <th className="w-14 py-1.5 px-3 text-left text-xs font-bold uppercase tracking-wider">
              Place
            </th>
            <th className="w-20 py-1.5 px-3 text-left text-xs font-bold uppercase tracking-wider">
              No.
            </th>
            <th className="py-1.5 px-3 text-left text-xs font-bold uppercase tracking-wider">
              Contestant
            </th>
            {rankOrder.judges.map((judge) => (
              <th
                key={judge.id}
                className="py-1.5 px-3 text-right text-xs font-bold uppercase tracking-wider"
              >
                {judge.displayName}
              </th>
            ))}
            <th className="w-24 py-1.5 px-3 text-right text-xs font-bold uppercase tracking-wider">
              Rank Sum
            </th>
          </tr>
        </thead>
        <tbody>
          {rankOrder.rows.map((row, index) => (
            <tr
              key={row.contestantId}
              className={`border-b border-border print:border-gray-300 ${
                index % 2 === 1 ? "bg-muted/30 print:bg-gray-50" : ""
              }`}
            >
              <td className="py-1.5 px-3 font-bold tabular-nums">
                <SummaryRankBadge rank={row.placement} />
              </td>
              <td className="py-1.5 px-3 tabular-nums">
                {row.displayNumber ? `#${row.displayNumber}` : "—"}
              </td>
              <td className="py-1.5 px-3 font-medium">{row.displayName}</td>
              {rankOrder.judges.map((judge) => {
                const rank = row.ranksByJudge[judge.id];
                const score = row.scoresByJudge?.[judge.id];
                return (
                  <td key={judge.id} className="py-1.5 px-3 text-right tabular-nums">
                    {rank == null ? (
                      "—"
                    ) : (
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span className="font-semibold">{rank}</span>
                        {score != null && (
                          <span className="text-[0.65rem] font-normal text-muted-foreground print:text-gray-500">
                            {score.toFixed(2)}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="py-1.5 px-3 text-right font-semibold tabular-nums">
                {row.rankSum}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Signature strokes for the judges responsible for a round or set. */
function SignatureFooter({
  judges,
  label,
}: {
  judges: { id: string; name: string }[];
  label: string;
}) {
  return (
    <footer className="mt-6 break-inside-avoid border-t-2 border-foreground pt-6 print:border-black">
      <p className="mb-6 text-center text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground print:text-gray-600">
        {label}
      </p>
      {judges.length === 0 ? (
        <p className="text-center text-sm italic text-muted-foreground print:text-gray-600">
          No judges recorded for this round.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2 print:grid-cols-2">
          {judges.map((judge) => (
            <div key={judge.id} className="grid gap-0.5">
              <p className="text-center text-sm font-semibold uppercase">{judge.name}</p>
              <div className="border-b border-foreground print:border-black" />
              <p className="text-center text-[0.7rem] font-bold uppercase tracking-[0.25em] text-muted-foreground print:text-black">
                Judge
              </p>
            </div>
          ))}
        </div>
      )}
    </footer>
  );
}

// ── Set section ─────────────────────────────────────────────────────────────

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
      <section className="grid gap-3 break-inside-avoid">
        <SetHeader set={set} roundName={roundName} />
        <p className="py-2 text-center text-sm italic text-muted-foreground print:text-gray-500">
          No scores submitted for this set.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-6">
      <SetHeader set={set} roundName={roundName} />

      {/* Per-criterion score tables */}
      {set.criteria.map((crit) => (
        <CriterionTable key={crit.criterionId} block={crit} judges={set.judges} mode={mode} />
      ))}

      {/* Summary table */}
      {set.summary.length > 0 && (
        <SummaryTable set={set} mode={mode} />
      )}
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
    <div className="flex items-baseline gap-3 border-b-2 border-foreground pb-1 print:border-black">
      <h3 className="text-lg font-bold uppercase tracking-wide">{set.setName}</h3>
      {roundName && (
        <span className="text-xs text-muted-foreground print:text-gray-600">{roundName}</span>
      )}
      {set.judges.length > 0 && (
        <span className="ml-auto text-xs text-muted-foreground print:text-gray-600">
          Judges: {set.judges.map((j) => j.name).join(" · ")}
        </span>
      )}
    </div>
  );
}

// ── Criterion table ─────────────────────────────────────────────────────────

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
    <div className="grid gap-1.5 break-inside-avoid">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">{block.criterionName}</h4>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground print:border-gray-300 print:bg-gray-100">
          {block.weight}% weight
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-foreground bg-foreground/5 print:border-black print:bg-gray-100">
              <th className="py-1.5 px-3 text-left text-xs font-bold uppercase tracking-wider">
                Contestant
              </th>
              {judges.map((j) => (
                <th
                  key={j.id}
                  className="py-1.5 px-3 text-right text-xs font-bold uppercase tracking-wider"
                >
                  {j.name}
                </th>
              ))}
              <th className="py-1.5 px-3 text-right text-xs font-bold uppercase tracking-wider text-primary print:text-black">
                {mode === "weighted" ? "Wtd. Avg" : "Raw Avg"}
              </th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => {
              const avgVal = mode === "weighted" ? row.weightedMean : row.rawMean;
              return (
                <tr
                  key={row.contestantId}
                  className={`border-b border-border print:border-gray-300 ${
                    i % 2 === 1 ? "bg-muted/30 print:bg-gray-50" : ""
                  }`}
                >
                  <td className="py-1.5 px-3 font-medium">
                    {row.contestantNumber && (
                      <span className="mr-1.5 font-mono text-xs text-muted-foreground print:text-gray-500">
                        #{row.contestantNumber}
                      </span>
                    )}
                    {row.contestantName}
                  </td>
                  {judges.map((j) => {
                    const cell = row.cells.find((c) => c.judgeId === j.id);
                    const val = cell ? (mode === "weighted" ? cell.weighted : cell.raw) : null;
                    return (
                      <td
                        key={j.id}
                        className="py-1.5 px-3 text-right tabular-nums text-muted-foreground print:text-gray-600"
                      >
                        {val !== null ? val.toFixed(2) : "—"}
                      </td>
                    );
                  })}
                  <td className="py-1.5 px-3 text-right font-semibold tabular-nums text-primary print:text-black">
                    {avgVal !== null ? avgVal.toFixed(2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Summary table ───────────────────────────────────────────────────────────

function SummaryTable({ set, mode }: { set: SetScoresheet; mode: ScoreMode }) {
  return (
    <div className="grid gap-1.5 break-inside-avoid">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground print:text-gray-600">
        Set total — {mode === "weighted" ? "weighted" : "raw"} scores
      </h4>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-foreground bg-foreground/5 print:border-black print:bg-gray-100">
            <th className="w-14 py-1.5 px-3 text-left text-xs font-bold uppercase tracking-wider">
              Rank
            </th>
            <th className="w-20 py-1.5 px-3 text-left text-xs font-bold uppercase tracking-wider">
              No.
            </th>
            <th className="py-1.5 px-3 text-left text-xs font-bold uppercase tracking-wider">
              Contestant
            </th>
            {set.criteria.map((c) => (
              <th
                key={c.criterionId}
                className="py-1.5 px-3 text-right text-xs font-bold uppercase tracking-wider"
                title={`${c.criterionName} (${c.weight}%)`}
              >
                <span className="block max-w-24 truncate">{c.criterionName}</span>
                <span className="block text-[0.6rem] font-normal text-muted-foreground print:text-gray-500">
                  {c.weight}%
                </span>
              </th>
            ))}
            <th className="py-1.5 px-3 text-right text-xs font-bold uppercase tracking-wider">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {set.summary.map((row, i) => (
            <tr
              key={row.contestantId}
              className={`border-b border-border print:border-gray-300 ${
                i % 2 === 1 ? "bg-muted/30 print:bg-gray-50" : ""
              }`}
            >
              <td className="py-1.5 px-3 font-bold">
                <SummaryRankBadge rank={row.rank} />
              </td>
              <td className="py-1.5 px-3 tabular-nums text-muted-foreground print:text-gray-600">
                {row.contestantNumber ? `#${row.contestantNumber}` : "—"}
              </td>
              <td className="py-1.5 px-3 font-medium">{row.contestantName}</td>
              {set.criteria.map((c) => {
                const val = row.bycriterion[c.criterionId] ?? null;
                return (
                  <td
                    key={c.criterionId}
                    className="py-1.5 px-3 text-right tabular-nums text-muted-foreground print:text-gray-600"
                  >
                    {val !== null ? val.toFixed(2) : "—"}
                  </td>
                );
              })}
              <td className="py-1.5 px-3 text-right font-bold tabular-nums">
                {row.total.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryRankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-amber-950 print:bg-gray-800 print:text-white">
        1
      </span>
    );
  if (rank === 2)
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-zinc-300 text-xs font-bold text-zinc-900 print:bg-gray-500 print:text-white">
        2
      </span>
    );
  if (rank === 3)
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-amber-50 print:bg-gray-400 print:text-white">
        3
      </span>
    );
  return <span className="inline-block w-6 text-center">{rank}</span>;
}
