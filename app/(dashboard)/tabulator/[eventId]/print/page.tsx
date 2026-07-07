import { Fragment } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  getEventResultsReport,
  type JudgeReport,
  type RankedRow,
  type ResultsReport,
  type RoundReport,
  type SetReport,
} from "@/lib/scoring/print-report-service";
import type { RoundScoreMode } from "@/lib/scoring/ranking";
import { EventLogo } from "@/components/events/event-logo";
import { PrintControls } from "@/components/scoring/print-controls";
import type { ScopeOption } from "@/components/scoring/print-scope-selector";

type Scope =
  | { kind: "all" }
  | { kind: "overall" }
  | { kind: "round"; id: string }
  | { kind: "set"; id: string };

function parseScope(raw: string | undefined): Scope {
  if (!raw || raw === "all") return { kind: "all" };
  if (raw === "overall") return { kind: "overall" };
  if (raw.startsWith("round-")) return { kind: "round", id: raw.slice(6) };
  if (raw.startsWith("set-")) return { kind: "set", id: raw.slice(4) };
  return { kind: "all" };
}

function scopeToValue(scope: Scope): string {
  if (scope.kind === "all") return "all";
  if (scope.kind === "overall") return "overall";
  if (scope.kind === "round") return `round-${scope.id}`;
  return `set-${scope.id}`;
}

function buildScopeOptions(report: ResultsReport): ScopeOption[] {
  const options: ScopeOption[] = [
    { value: "all", label: "Final Results", group: "general" },
    { value: "overall", label: "Overall ranking", group: "general" },
  ];
  for (const round of report.rounds) {
    options.push({
      value: `round-${round.id}`,
      label: round.name,
      group: "rounds",
    });
    for (const set of round.sets) {
      options.push({
        value: `set-${set.id}`,
        label: `${round.name} · ${set.name}`,
        group: "sets",
      });
    }
  }
  for (const set of report.ungroupedSets) {
    options.push({ value: `set-${set.id}`, label: set.name, group: "sets" });
  }
  return options;
}

function findRound(report: ResultsReport, id: string): RoundReport | undefined {
  return report.rounds.find((r) => r.id === id);
}

function findSet(
  report: ResultsReport,
  id: string,
): { round: RoundReport | null; set: SetReport } | undefined {
  for (const round of report.rounds) {
    const set = round.sets.find((s) => s.id === id);
    if (set) return { round, set };
  }
  const ungrouped = report.ungroupedSets.find((s) => s.id === id);
  if (ungrouped) return { round: null, set: ungrouped };
  return undefined;
}

export default async function PrintResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ scope?: string; judges?: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "score.review")) notFound();

  const { eventId } = await params;
  const { scope: scopeRaw, judges: judgesRaw } = await searchParams;
  const scope = parseScope(scopeRaw);
  // When on, every ranking table expands to show each judge's own scores.
  const showJudges = judgesRaw === "1";

  let report: ResultsReport;
  try {
    report = await getEventResultsReport({
      database: db,
      organizationId: context.organization.id,
      eventId,
    });
  } catch {
    notFound();
  }

  const scopeOptions = buildScopeOptions(report);
  const generatedDate = new Date(report.generatedAt);

  // Pick what to render based on scope
  let renderOverall = false;
  let renderRounds: RoundReport[] = [];
  let renderUngrouped: SetReport[] = [];
  let renderSingleSet: { round: RoundReport | null; set: SetReport } | null = null;
  let scopeTitle = "Final Results";

  if (scope.kind === "all") {
    // "Final Results" = the deciding round only. When a rank-order round is
    // configured (e.g. Q&A), that round's result IS the final result, so show
    // just it — no other rounds, sets, or the cumulative ranking. If there is
    // no rank-order round, the overall ranking is the final result instead.
    const rankOrderRounds = report.rounds.filter(
      (r) => r.isRankOrder && r.rankOrder && r.rankOrder.rows.length > 0,
    );
    if (rankOrderRounds.length > 0) {
      renderRounds = rankOrderRounds;
    } else {
      renderOverall = report.overall.length > 0;
    }
  } else if (scope.kind === "overall") {
    renderOverall = true;
    scopeTitle = "Overall Ranking";
  } else if (scope.kind === "round") {
    const round = findRound(report, scope.id);
    if (!round) notFound();
    // Round-only scope: just the round's aggregate ranking — drop per-set
    // tables so the printed page is purely "round ranking".
    renderRounds = [{ ...round, sets: [] }];
    scopeTitle = `${round.name} — Round Ranking`;
  } else if (scope.kind === "set") {
    const found = findSet(report, scope.id);
    if (!found) notFound();
    renderSingleSet = found;
    scopeTitle = found.round
      ? `${found.round.name} — ${found.set.name}`
      : found.set.name;
  }

  // Union of every judge who is responsible for any round/set in the report —
  // used to certify the event-wide overall ranking.
  const overallJudges = dedupeJudges([
    ...report.rounds.flatMap((r) => r.judges),
    ...report.ungroupedSets.flatMap((s) => s.judges),
  ]);

  return (
    <div className="grid gap-6 print:gap-0">
      <PrintControls
        backHref={`/tabulator/${eventId}`}
        generatedAt={report.generatedAt}
        scope={scopeToValue(scope)}
        scopeOptions={scopeOptions}
        showJudges={showJudges}
      />

      {/* The printable document. Always renders in the light "paper" design
          via `.print-document` (see globals.css), regardless of the app's
          dark-mode setting — both in this on-screen preview and when
          actually printed. Constrained to a comfortable width on screen;
          full bleed when printed. */}
      <article className="print-document mx-auto w-full max-w-3xl rounded-lg border border-border bg-card p-8 text-foreground shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocumentHeader
          eventName={report.event.name}
          eventLogoUrl={report.event.logoUrl}
          contestants={report.contestants}
          generatedDate={generatedDate}
          subtitle={scopeTitle}
          verificationCode={report.verificationCode}
        />

        <div className="mt-8 grid gap-10">
          {renderOverall && (
            <Section
              title="Overall Ranking"
              subtitle={
                report.roundScoreMode === "sum"
                  ? "Event-wide total points"
                  : "Event-wide average"
              }
            >
              <RankingTable
                rows={report.overall}
                valueLabel={report.roundScoreMode === "sum" ? "Points" : "Average"}
                showScoredCount
                judges={showJudges ? overallJudges : undefined}
                advancement={report.advancement}
              />
            </Section>
          )}

          {renderRounds.map((round) => (
            <RoundBlock
              key={round.id}
              round={round}
              mode={report.roundScoreMode}
              showJudges={showJudges}
            />
          ))}

          {renderUngrouped.length > 0 && (
            <div className="grid gap-6">
              {renderUngrouped.map((set) => (
                <div key={set.id} className="grid gap-6 break-inside-avoid">
                  <Section
                    title={set.name}
                    subtitle={set.carryOver ? "Carries forward" : undefined}
                  >
                    <SetTable set={set} showJudges={showJudges} />
                  </Section>
                  <SignatureBlock
                    judges={set.judges}
                    label={`Certified by the judges for ${set.name}`}
                  />
                </div>
              ))}
            </div>
          )}

          {renderSingleSet && (
            <>
              <Section
                title={renderSingleSet.set.name}
                subtitle={
                  renderSingleSet.round
                    ? `${renderSingleSet.round.name} · per-set ranking`
                    : "Per-set ranking"
                }
              >
                <SetTable set={renderSingleSet.set} showJudges={showJudges} />
              </Section>
              <SignatureBlock
                judges={renderSingleSet.set.judges}
                label={`Certified by the judges for ${renderSingleSet.set.name}`}
              />
            </>
          )}
        </div>

        {/* Rounds and sets carry their own per-round signatures above. A
            whole-panel block is only meaningful for the event-wide overall
            ranking, where every participating judge certifies. */}
        {renderOverall && renderRounds.length === 0 && !renderSingleSet && (
          <SignatureBlock judges={overallJudges} />
        )}

        <p className="mt-6 text-center text-[0.65rem] text-muted-foreground print:text-gray-500">
          Document verification code{" "}
          <span className="font-mono font-semibold">{report.verificationCode}</span> — an
          authentic copy of this report reproduces the same code when regenerated in the
          system against the recorded scores.
        </p>
      </article>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function DocumentHeader({
  eventName,
  eventLogoUrl,
  contestants,
  generatedDate,
  subtitle,
  verificationCode,
}: {
  eventName: string;
  eventLogoUrl: string | null;
  contestants: number;
  generatedDate: Date;
  subtitle: string;
  verificationCode: string;
}) {
  return (
    <header className="border-b-4 border-double border-foreground pb-4 text-center print:border-black">
      <EventLogo
        src={eventLogoUrl}
        alt={eventName}
        className="mx-auto mb-3 size-16"
      />
      <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground print:text-gray-600">
        Official Results Report
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight print:text-2xl">
        {eventName}
      </h1>
      <p className="mt-1 text-sm font-medium uppercase tracking-wider text-muted-foreground print:text-gray-600">
        {subtitle}
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
        })}{" "}
        · {contestants} contestants
      </p>
      <p className="mt-1 text-xs text-muted-foreground print:text-gray-600">
        Verification code:{" "}
        <span className="font-mono font-semibold tracking-wider">{verificationCode}</span>
      </p>
    </header>
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
    <div className="grid gap-6 break-inside-avoid">
      <div className="border-y border-foreground/20 bg-muted/40 px-4 py-2 print:border-gray-400 print:bg-gray-100">
        <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground print:text-gray-600">
          Round
        </p>
        <h2 className="text-xl font-bold print:text-lg">{round.name}</h2>
      </div>

      {round.rankOrder && round.rankOrder.rows.length > 0 && (
        <Section
          title="Rank Order Result"
          subtitle="Judges' ranks summed — lowest wins"
        >
          <RankOrderTable rankOrder={round.rankOrder} />
        </Section>
      )}

      {/* A rank-order round's result IS the rank-order table above — its
          averaged round ranking and per-set tables aren't meaningful, so they
          are omitted. Everything below is for point/carry-over rounds only. */}
      {!round.isRankOrder && (
        <>
          {round.ranking.length > 0 && (
            <Section
              title="Round Ranking"
              subtitle={
                mode === "sum"
                  ? "Total points across this round's sets"
                  : "Average across this round's sets"
              }
            >
              <RankingTable
                rows={round.ranking}
                valueLabel={mode === "sum" ? "Points" : "Average"}
                showScoredCount
                judges={showJudges ? round.judges : undefined}
              />
            </Section>
          )}

          {round.sets.map((set) => (
            <Section
              key={set.id}
              title={set.name}
              subtitle={set.carryOver ? "Carries forward" : undefined}
            >
              <SetTable set={set} showJudges={showJudges} />
            </Section>
          ))}
        </>
      )}

      {/* Certified only by the judges assigned to this round. */}
      <SignatureBlock judges={round.judges} label={`Certified by the judges for ${round.name}`} />
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2 break-inside-avoid">
      <div className="flex items-baseline justify-between border-b border-border pb-1 print:border-gray-400">
        <h3 className="text-base font-semibold uppercase tracking-wide">
          {title}
        </h3>
        {subtitle && (
          <span className="text-xs text-muted-foreground print:text-gray-600">
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function SetTable({ set, showJudges }: { set: SetReport; showJudges?: boolean }) {
  if (set.ranking.length === 0) {
    return (
      <p className="py-2 text-center text-sm italic text-muted-foreground print:text-gray-600">
        No scores submitted yet.
      </p>
    );
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
  /** When provided, a column per judge shows each judge's own score. */
  judges?: JudgeReport[];
  /** When provided, marks which contestants advance and draws a cutoff line. */
  advancement?: ResultsReport["advancement"];
}) {
  const judgeCols = judges ?? [];
  const advancingIds = new Set(advancement?.contestantIds ?? []);
  // Row index of the last contestant that advances — the cutoff line is drawn
  // after it. -1 disables the line (no advancement, or none of these rows
  // advance).
  const lastAdvancingIndex = advancement
    ? rows.reduce((last, row, i) => (advancingIds.has(row.contestantId) ? i : last), -1)
    : -1;
  // Rank + No. + Contestant, plus optional Sets, judge, and value columns.
  const colCount = 3 + (showScoredCount ? 1 : 0) + judgeCols.length + 1;
  return (
    <table className="w-full border-collapse text-sm">
      {judgeCols.length > 0 && (
        <caption className="caption-bottom pt-2 text-left text-[0.65rem] text-muted-foreground print:text-gray-500">
          Columns show each judge&apos;s own score; {valueLabel.toLowerCase()} is the
          combined result. &ldquo;—&rdquo; means the judge did not score that contestant.
        </caption>
      )}
      <thead>
        <tr className="border-b-2 border-foreground bg-foreground/5 print:border-black print:bg-gray-100">
          <th className="w-14 py-2 px-3 text-left text-xs font-bold uppercase tracking-wider">
            Rank
          </th>
          <th className="w-20 py-2 px-3 text-left text-xs font-bold uppercase tracking-wider">
            No.
          </th>
          <th className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wider">
            Contestant
          </th>
          {showScoredCount && (
            <th className="w-16 py-2 px-3 text-right text-xs font-bold uppercase tracking-wider">
              Sets
            </th>
          )}
          {judgeCols.map((judge) => (
            <th
              key={judge.id}
              className="py-2 px-3 text-right text-xs font-bold uppercase tracking-wider"
            >
              {judge.displayName}
            </th>
          ))}
          <th className="w-24 py-2 px-3 text-right text-xs font-bold uppercase tracking-wider">
            {valueLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const advances = advancingIds.has(row.contestantId);
          return (
          <Fragment key={row.contestantId}>
          <tr
            className={`border-b border-border print:border-gray-300 ${
              advances
                ? "bg-emerald-50/70 print:bg-transparent"
                : index % 2 === 1
                  ? "bg-muted/30 print:bg-gray-50"
                  : ""
            }`}
          >
            <td className="py-2 px-3 font-bold tabular-nums">
              <RankBadge rank={row.rank} />
            </td>
            <td className="py-2 px-3 tabular-nums">
              {row.displayNumber ? `#${row.displayNumber}` : "—"}
            </td>
            <td className="py-2 px-3 font-medium">
              <span className="inline-flex items-center gap-2">
                {row.displayName}
                {advances && (
                  <span className="rounded-sm border border-emerald-600 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-emerald-700 print:border-black print:text-black">
                    Advances
                  </span>
                )}
              </span>
            </td>
            {showScoredCount && (
              <td className="py-2 px-3 text-right tabular-nums text-muted-foreground print:text-gray-600">
                {row.scoredCount}
              </td>
            )}
            {judgeCols.map((judge) => {
              const score = row.scoresByJudge[judge.id];
              return (
                <td
                  key={judge.id}
                  className="py-2 px-3 text-right tabular-nums text-muted-foreground print:text-gray-600"
                >
                  {score == null ? "—" : score.toFixed(2)}
                </td>
              );
            })}
            <td className="py-2 px-3 text-right font-semibold tabular-nums">
              {row.value.toFixed(2)}
            </td>
          </tr>
          {advancement && index === lastAdvancingIndex && (
            <tr aria-hidden className="print:break-inside-avoid">
              <td colSpan={colCount} className="p-0">
                <div className="flex items-center gap-2 border-t-2 border-dashed border-emerald-600 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-700 print:border-black print:text-black">
                  <span className="flex-1 border-t border-dashed border-emerald-600/60 print:border-black" />
                  Top {advancement.count} advance to {advancement.roundName}
                  <span className="flex-1 border-t border-dashed border-emerald-600/60 print:border-black" />
                </div>
              </td>
            </tr>
          )}
          </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function RankOrderTable({
  rankOrder,
}: {
  rankOrder: NonNullable<RoundReport["rankOrder"]>;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="caption-bottom pt-2 text-left text-[0.65rem] text-muted-foreground print:text-gray-500">
        Under each judge: their rank for the contestant, with the score that
        produced it below it. Lowest rank sum wins.
      </caption>
      <thead>
        <tr className="border-b-2 border-foreground bg-foreground/5 print:border-black print:bg-gray-100">
          <th className="w-14 py-2 px-3 text-left text-xs font-bold uppercase tracking-wider">
            Place
          </th>
          <th className="w-20 py-2 px-3 text-left text-xs font-bold uppercase tracking-wider">
            No.
          </th>
          <th className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wider">
            Contestant
          </th>
          {rankOrder.judges.map((judge) => (
            <th
              key={judge.id}
              className="py-2 px-3 text-right text-xs font-bold uppercase tracking-wider"
            >
              {judge.displayName}
            </th>
          ))}
          <th className="w-24 py-2 px-3 text-right text-xs font-bold uppercase tracking-wider">
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
            <td className="py-2 px-3 font-bold tabular-nums">
              <RankBadge rank={row.placement} />
            </td>
            <td className="py-2 px-3 tabular-nums">
              {row.displayNumber ? `#${row.displayNumber}` : "—"}
            </td>
            <td className="py-2 px-3 font-medium">{row.displayName}</td>
            {rankOrder.judges.map((judge) => {
              const rank = row.ranksByJudge[judge.id];
              const score = row.scoresByJudge?.[judge.id];
              return (
                <td key={judge.id} className="py-2 px-3 text-right tabular-nums">
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
            <td className="py-2 px-3 text-right font-semibold tabular-nums">
              {row.rankSum}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-amber-950 print:bg-gray-800 print:text-white">
        1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-zinc-300 text-xs font-bold text-zinc-900 print:bg-gray-500 print:text-white">
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-amber-50 print:bg-gray-400 print:text-white">
        3
      </span>
    );
  }
  return <span className="inline-block w-6 text-center">{rank}</span>;
}

/** De-duplicates judges by id, preserving first-seen order. */
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

function SignatureBlock({
  judges,
  label = "Certified by the Panel of Judges",
}: {
  judges: JudgeReport[];
  label?: string;
}) {
  return (
    <footer className="mt-12 break-inside-avoid border-t-2 border-foreground pt-6 print:mt-10 print:border-black">
      <p className="mb-6 text-center text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground print:text-gray-600">
        {label}
      </p>
      {judges.length === 0 ? (
        <p className="text-center text-sm italic text-muted-foreground print:text-gray-600">
          No active judges to certify.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2 print:grid-cols-2">
          {judges.map((judge) => (
            <div key={judge.id} className="grid gap-0.5">
              {/* Name sits above the line, the line is the signature stroke
                  (just a border — no empty space), and "JUDGE" sits directly
                  below the line. */}
              <p className="text-center text-sm font-semibold uppercase">
                {judge.displayName}
              </p>
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
