"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Crown, Info, Layers, Scale, Trophy, Vote } from "lucide-react";
import { toast } from "sonner";
import {
  cancelTieBreakVoteAction,
  clearTieBreakAction,
  forceResolveTieBreakVoteAction,
} from "@/app/(dashboard)/tabulator/actions";
import { AfterHydration } from "@/components/after-hydration";
import { AskJudgesDialog } from "@/components/scoring/ask-judges-dialog";
import { TieBreakDialog } from "@/components/scoring/tie-break-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LiveStandings } from "@/components/scoring/live-standings";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// A self-contained scroll region (vertical + horizontal) so the sticky <thead>
// has a single scroll container to stick within. Using the shadcn <Table>
// wrapper here would nest an extra overflow container and break sticky.
const SCROLL_CONTAINER =
  "relative max-h-[70vh] w-full overflow-auto rounded-md border border-border";
const TABLE = "w-full caption-bottom text-base";
const STICKY_HEAD = "sticky top-0 z-20 bg-background [&_th]:bg-background";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTabulatorLiveSnapshot } from "@/components/scoring/tabulator-live-context";

type TieBreak = "shared" | "countback" | "highest_single_set";

// Short phrase describing what the method does, shown when a points tie is
// actually separated in the standings so the tabulator sees WHY the order stands.
const TIE_BREAK_HOW: Record<TieBreak, string> = {
  shared: "shared rank (no tie-break)",
  countback: "countback — higher score in a later set/round wins",
  highest_single_set: "highest single set/round score wins",
};

interface SetColumn {
  id: string;
  name: string;
}

interface SetTotalsRow {
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  photoUrl: string | null;
  cells: { setId: string; total: number | null }[];
  roundTotal: number;
  carriedIn: number;
  overall: number;
  rank: number;
}

interface FocusCriterion {
  id: string;
  name: string;
  description: string | null;
  weight: number;
}

interface JudgeColumn {
  id: string;
  displayName: string;
}

interface JudgeMatrixRow {
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  scores: Record<string, Record<string, number | null>>;
}

interface ActiveRound {
  id: string;
  name: string;
  carryOver: boolean;
}

interface Advancement {
  groupId: string;
  count: number;
  qualifiedIds: string[];
  displayOrder: string;
  roundName: string;
  isPreview: boolean;
}

interface TieBreakSummary {
  id: string;
  scope: "standings" | "advancement" | "rank_order";
  contextId: string | null;
  tiedContestantIds: string[];
  resolvedOrder: string[];
  method: "manual" | "judge_vote";
  note: string | null;
  resolvedByName: string | null;
}

/** Order-independent key for a set of contestant ids — mirrors tieKeyFor() in lib/scoring/ranking.ts. */
function tieKey(ids: string[]) {
  return [...ids].sort().join(",");
}

function findTieBreak(
  tieBreaks: TieBreakSummary[],
  scope: TieBreakSummary["scope"],
  contextId: string | null,
  clusterIds: string[],
): TieBreakSummary | null {
  const key = tieKey(clusterIds);
  return (
    tieBreaks.find((tb) => tb.scope === scope && tb.contextId === contextId && tieKey(tb.tiedContestantIds) === key) ??
    null
  );
}

interface TieBreakVoteSummary {
  id: string;
  scope: "standings" | "advancement" | "rank_order";
  contextId: string | null;
  tiedContestantIds: string[];
  eligibleJudges: { id: string; displayName: string }[];
  votedJudgeIds: string[];
}

function findOpenVote(
  votes: TieBreakVoteSummary[],
  scope: TieBreakVoteSummary["scope"],
  contextId: string | null,
  clusterIds: string[],
): TieBreakVoteSummary | null {
  const key = tieKey(clusterIds);
  return (
    votes.find((v) => v.scope === scope && v.contextId === contextId && tieKey(v.tiedContestantIds) === key) ?? null
  );
}

/** Live "N of M judges voted" strip with the tabulator's resolve-now/cancel escape hatch. */
function TieBreakVoteTally({ eventId, vote }: { eventId: string; vote: TieBreakVoteSummary }) {
  const [pending, startTransition] = useTransition();
  const votedCount = vote.votedJudgeIds.length;
  const total = vote.eligibleJudges.length;
  const pct = total > 0 ? Math.round((votedCount / total) * 100) : 0;

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed.");
      }
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[0.72rem] font-medium leading-snug text-sky-600 dark:text-sky-400">
      <Vote className="size-3 shrink-0" />
      {votedCount} of {total} judge{total === 1 ? "" : "s"} voted
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-sky-200 dark:bg-sky-900">
        <span className="block h-full bg-sky-500" style={{ width: `${pct}%` }} />
      </span>
      <button
        type="button"
        disabled={pending}
        className="underline decoration-dotted underline-offset-2 hover:text-foreground disabled:opacity-50"
        onClick={() => run(() => forceResolveTieBreakVoteAction({ eventId, voteId: vote.id }))}
      >
        Resolve now
      </button>
      <button
        type="button"
        disabled={pending}
        className="underline decoration-dotted underline-offset-2 hover:text-foreground disabled:opacity-50"
        onClick={() => run(() => cancelTieBreakVoteAction({ eventId, voteId: vote.id }))}
      >
        Cancel vote
      </button>
    </span>
  );
}

interface RankOrderRow {
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  photoUrl: string | null;
  ranksByJudge: Record<string, number>;
  scoresByJudge: Record<string, number | null>;
  rankSum: number;
  placement: number;
}

interface RankOrder {
  groupId: string;
  groupName: string;
  judges: { id: string; displayName: string }[];
  rows: RankOrderRow[];
}

function contestantLabel(row: { displayNumber: string | null; displayName: string }) {
  return row.displayNumber ? `${row.displayNumber}. ${row.displayName}` : row.displayName;
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function RevertTieBreakButton({ eventId, tieBreakId }: { eventId: string; tieBreakId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="underline decoration-dotted underline-offset-2 hover:text-foreground disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          try {
            await clearTieBreakAction({ eventId, id: tieBreakId });
            toast.success("Reverted to automatic.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to revert.");
          }
        })
      }
    >
      {pending ? "Reverting…" : "Revert to automatic"}
    </button>
  );
}

/** Assigns dense competition ranks (ties share a rank) to a desc-sorted list. */
function rankDesc<T>(rows: T[], valueOf: (row: T) => number) {
  const sorted = [...rows].sort((a, b) => valueOf(b) - valueOf(a));
  let prevValue: number | null = null;
  let prevRank = 0;
  return sorted.map((row, index) => {
    const value = valueOf(row);
    const rank = prevValue === value ? prevRank : index + 1;
    prevValue = value;
    prevRank = rank;
    return { row, rank, value };
  });
}

interface FinalRankingsColumn {
  groupId: string;
  groupName: string;
  weight: number;
}

interface FinalRankingsRow {
  rank: number;
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  photoUrl: string | null;
  roundScores: Array<{ groupId: string; score: number | null }>;
  overall: number;
}

export function TabulatorScores({
  eventId,
  setColumns,
  setTotals,
  focusCriteria,
  judgeColumns,
  judgeMatrix,
  focusSetId,
  activeRound,
  carriedFromRounds,
  finalRankings,
  advancement,
  advancementPreview = false,
  rankOrder,
  tieBreak = "shared",
  tieBreaks = [],
  openTieBreakVotes = [],
  canAdjust = false,
}: {
  eventId: string;
  setColumns: SetColumn[];
  setTotals: SetTotalsRow[];
  focusCriteria: FocusCriterion[];
  judgeColumns: JudgeColumn[];
  judgeMatrix: JudgeMatrixRow[];
  focusSetId: string | null;
  activeRound: ActiveRound | null;
  carriedFromRounds: { id: string; name: string }[];
  finalRankings: { columns: FinalRankingsColumn[]; rows: FinalRankingsRow[] } | null;
  advancement: Advancement | null;
  advancementPreview?: boolean;
  rankOrder: RankOrder | null;
  tieBreak?: TieBreak;
  /** The event's live manual tie-break overrides. */
  tieBreaks?: TieBreakSummary[];
  /** The event's currently-open "ask the judges" votes. */
  openTieBreakVotes?: TieBreakVoteSummary[];
  /** Whether the current user can resolve ties by hand ("score.adjust"). */
  canAdjust?: boolean;
}) {
  const live = useTabulatorLiveSnapshot();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlFocusSetId = searchParams.get("set");

  const resolvedSetColumns = live?.setColumns ?? setColumns;
  const resolvedSetTotals = live?.setTotals ?? setTotals;
  const resolvedFocusCriteria = live?.focusCriteria ?? focusCriteria;
  const resolvedJudgeColumns = live?.judgeColumns ?? judgeColumns;
  const resolvedJudgeMatrix = live?.judgeMatrix ?? judgeMatrix;
  const validUrlFocusSetId =
    urlFocusSetId && resolvedSetColumns.some((set) => set.id === urlFocusSetId)
      ? urlFocusSetId
      : null;
  const resolvedFocusSetId = validUrlFocusSetId ?? live?.focusSetId ?? focusSetId;
  const resolvedActiveRound = live?.activeRound ?? activeRound;
  const resolvedCarriedFromRounds = live?.carriedFromRounds ?? carriedFromRounds;
  const resolvedFinalRankings = live?.finalRankings ?? finalRankings;
  const resolvedAdvancement = live?.advancement ?? advancement;
  const resolvedAdvancementPreview = live?.advancementPreview ?? advancementPreview;
  const resolvedRankOrder = live?.rankOrder ?? rankOrder;
  const resolvedTieBreak = live?.tieBreak ?? tieBreak;
  const resolvedTieBreaks = live?.tieBreaks ?? tieBreaks;
  const resolvedOpenTieBreakVotes = live?.openTieBreakVotes ?? openTieBreakVotes;

  // Standings ties feed the advancement cut while a next round hasn't been
  // activated yet; once there's no more advancement pending they're the
  // event's final result, scoped event-wide instead.
  const advancementTieBreakContext = resolvedAdvancement
    ? { scope: "advancement" as const, contextId: resolvedAdvancement.groupId }
    : null;
  const standingsTieBreakContext = resolvedAdvancementPreview && advancementTieBreakContext
    ? advancementTieBreakContext
    : { scope: "standings" as const, contextId: null };

  const [weighted, setWeighted] = useState(true);
  const [activeTab, setActiveTab] = useState(() =>
    resolvedRankOrder ? "rankorder" : "standings",
  );
  const hadRankOrderRef = useRef(!!resolvedRankOrder);

  // Intentionally syncs the active tab to the rankOrder prop after the server
  // re-renders (auto-focus the rank-order result when it appears).
  useEffect(() => {
    if (resolvedRankOrder && !hadRankOrderRef.current) {
      hadRankOrderRef.current = true;
      setActiveTab("rankorder");
      return;
    }
    if (!resolvedRankOrder) {
      hadRankOrderRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab((tab) => (tab === "rankorder" ? "standings" : tab));
    }
  }, [resolvedRankOrder]);

  const resolvedTab =
    activeTab === "rankorder" && !resolvedRankOrder ? "standings" : activeTab;

  // A rank-order round decides the true final ranking, so the cumulative
  // score table is only the advancement basis, not the final ranking.
  const hasRankOrder = !!(resolvedRankOrder && resolvedRankOrder.rows.length > 0);
  const showCumulativeRankings =
    (!resolvedActiveRound && resolvedSetColumns.length === 0) ||
    (resolvedAdvancementPreview &&
      !!resolvedFinalRankings &&
      resolvedFinalRankings.rows.length > 0);
  const cumulativeTitle =
    hasRankOrder || resolvedAdvancement?.isPreview
      ? "Cumulative Rankings"
      : "Final Rankings";
  const cumulativeDescription =
    resolvedAdvancement?.isPreview && resolvedAdvancement.roundName
      ? `Accumulated scores from the points rounds — top ${resolvedAdvancement.count} advance to ${resolvedAdvancement.roundName}.`
      : hasRankOrder
        ? "Accumulated scores from the rounds before the rank-order final."
        : undefined;

  function selectFocusSet(setId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("set", setId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function display(raw: number | null, weight: number): number | null {
    if (raw === null) return null;
    return weighted ? round4(raw * (weight / 100)) : raw;
  }

  // Between rounds, or while previewing who advances into the next rank-order
  // round — show cumulative standings with the advancement cut line.
  if (showCumulativeRankings) {
    if (
      (resolvedRankOrder && resolvedRankOrder.rows.length > 0) ||
      (resolvedFinalRankings && resolvedFinalRankings.rows.length > 0)
    ) {
      return (
        <div className="grid gap-8">
          {resolvedAdvancementPreview && resolvedActiveRound && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <p className="font-medium">Ready for advancement</p>
              <p className="mt-1 text-muted-foreground">
                Every set in {resolvedActiveRound.name} is scored. Finish the round
                under &quot;Rounds &amp; sets&quot; when you are ready, then activate{" "}
                {resolvedAdvancement?.roundName ?? "the next round"}.
              </p>
            </div>
          )}
          {resolvedRankOrder && resolvedRankOrder.rows.length > 0 && (
            <RankOrderTable
              rankOrder={resolvedRankOrder}
              eventId={eventId}
              canAdjust={canAdjust}
              tieBreaks={resolvedTieBreaks}
              openTieBreakVotes={resolvedOpenTieBreakVotes}
            />
          )}
          {resolvedFinalRankings && resolvedFinalRankings.rows.length > 0 && (
            <FinalRankingsTable
              columns={resolvedFinalRankings.columns}
              rows={resolvedFinalRankings.rows}
              title={cumulativeTitle}
              description={cumulativeDescription}
              isFinal={!hasRankOrder && !resolvedAdvancement?.isPreview}
              tieBreak={resolvedTieBreak}
              advanceCount={resolvedAdvancement?.count ?? null}
              advanceRoundName={resolvedAdvancement?.roundName ?? null}
              eventId={eventId}
              canAdjust={canAdjust}
              tieBreaks={resolvedTieBreaks}
              openTieBreakVotes={resolvedOpenTieBreakVotes}
              tieBreakContext={standingsTieBreakContext}
            />
          )}
        </div>
      );
    }
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="font-medium">No active round</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Activate a round and a set under &quot;Rounds &amp; sets&quot; to open scoring and
          see live results here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Active-round context */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Active round:</span>
        <span className="font-medium">{resolvedActiveRound?.name ?? "Ungrouped set"}</span>
        {resolvedAdvancement && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Top {resolvedAdvancement.count} only — {resolvedAdvancement.qualifiedIds.length} qualified
            from previous rounds
          </span>
        )}
      </div>

      <Tabs
        value={resolvedTab}
        onValueChange={(value) => value && setActiveTab(value)}
      >
        <TabsList>
          {resolvedRankOrder && <TabsTrigger value="rankorder">Rank order</TabsTrigger>}
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="top">Top candidates</TabsTrigger>
          <TabsTrigger value="judges">By judge &amp; criteria</TabsTrigger>
        </TabsList>

        {/* ── Rank order (winner = lowest combined rank) ── */}
        {resolvedRankOrder && (
          <TabsContent value="rankorder" className="mt-4">
            <div className="grid gap-8">
              <RankOrderTable
                rankOrder={resolvedRankOrder}
                eventId={eventId}
                canAdjust={canAdjust}
                tieBreaks={resolvedTieBreaks}
                openTieBreakVotes={resolvedOpenTieBreakVotes}
              />
              {/* Cumulative standings from the preceding rounds — the basis for
                  who advanced into this rank-order round. Handy to announce. */}
              {resolvedFinalRankings && resolvedFinalRankings.rows.length > 0 && (
                <FinalRankingsTable
                  columns={resolvedFinalRankings.columns}
                  rows={resolvedFinalRankings.rows}
                  title="Cumulative Rankings"
                  description="Accumulated scores from the rounds before this one — the basis for advancement. Excludes this rank-order round."
                  isFinal={false}
                  tieBreak={resolvedTieBreak}
                  advanceCount={resolvedAdvancement?.count ?? null}
                  advanceRoundName={resolvedAdvancement?.roundName ?? null}
                  eventId={eventId}
                  canAdjust={canAdjust}
                  tieBreaks={resolvedTieBreaks}
                  openTieBreakVotes={resolvedOpenTieBreakVotes}
                  tieBreakContext={advancementTieBreakContext}
                />
              )}
            </div>
          </TabsContent>
        )}

        {/* ── Standings (live, FLIP-animated leaderboard) ── */}
        <TabsContent value="standings" className="mt-4">
          <LiveStandings
            eventId={eventId}
            setColumns={resolvedSetColumns}
            setTotals={resolvedSetTotals}
          />
        </TabsContent>

        {/* ── Top candidates (scope: overall round, or a single set) ── */}
        <TabsContent value="top" className="mt-4">
          <TopCandidates
            setColumns={resolvedSetColumns}
            setTotals={resolvedSetTotals}
          />
        </TabsContent>

        {/* ── By judge & criteria ── */}
        <TabsContent value="judges" className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {resolvedSetColumns.length > 1 ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Set</span>
                <Select
                  value={resolvedFocusSetId ?? undefined}
                  onValueChange={(value) => value && selectFocusSet(value)}
                  items={Object.fromEntries(
                    resolvedSetColumns.map((s) => [s.id, s.name]),
                  )}
                >
                  <SelectTrigger className="w-[14rem]">
                    <SelectValue placeholder="Select a set" />
                  </SelectTrigger>
                  <SelectContent>
                    {resolvedSetColumns.map((set) => (
                      <SelectItem key={set.id} value={set.id}>
                        {set.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <span />
            )}

            {/* Raw / Weighted toggle */}
            <div className="inline-flex rounded-md border border-border p-0.5">
              <button
                type="button"
                aria-pressed={!weighted}
                onClick={() => setWeighted(false)}
                className={cn(
                  "rounded px-3 py-1 text-sm font-medium transition-colors",
                  !weighted
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Raw
              </button>
              <button
                type="button"
                aria-pressed={weighted}
                onClick={() => setWeighted(true)}
                className={cn(
                  "rounded px-3 py-1 text-sm font-medium transition-colors",
                  weighted
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Weighted
              </button>
            </div>
          </div>

          {resolvedJudgeColumns.length === 0 ||
          resolvedJudgeMatrix.length === 0 ||
          resolvedFocusCriteria.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active judges, contestants, or criteria for this set.
            </p>
          ) : (
            <div className={SCROLL_CONTAINER}>
              <table className={TABLE}>
                <TableHeader className={STICKY_HEAD}>
                  {/* Row 1: judge groups */}
                  <TableRow>
                    <TableHead
                      rowSpan={2}
                      className="sticky left-0 z-30 w-16 bg-background align-bottom"
                    >
                      Rank
                    </TableHead>
                    <TableHead
                      rowSpan={2}
                      className="sticky left-16 z-30 border-r border-border bg-background align-bottom"
                    >
                      Contestant
                    </TableHead>
                    {resolvedJudgeColumns.map((judge) => (
                      <TableHead
                        key={judge.id}
                        colSpan={resolvedFocusCriteria.length + 1}
                        className="border-l border-border text-center"
                      >
                        {judge.displayName}
                      </TableHead>
                    ))}
                    <TableHead
                      rowSpan={2}
                      className="border-l border-border text-right align-bottom"
                    >
                      Average
                    </TableHead>
                  </TableRow>
                  {/* Row 2: criteria per judge */}
                  <TableRow>
                    {resolvedJudgeColumns.map((judge) => (
                      <CriteriaHeaderGroup
                        key={judge.id}
                        judgeId={judge.id}
                        criteria={resolvedFocusCriteria}
                      />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    // Per-judge subtotals + average for every row, in the current
                    // Raw/Weighted display mode. Ranking always uses the weighted
                    // average regardless of that toggle — the toggle only changes
                    // what's shown in the cells, not placement, so switching
                    // Raw/Weighted never reshuffles the rows.
                    const withAverage = resolvedJudgeMatrix.map((row) => {
                      // Keep unrounded per-judge totals for the average — only round
                      // once, at the very end, to match the server's Standings/report
                      // formula exactly (avg of each judge's weighted total; rounding
                      // per judge first would compound rounding error and drift from
                      // the authoritative total).
                      const rawSubtotalsUnrounded = resolvedJudgeColumns.map((judge) => {
                        const judgeScores = row.scores[judge.id] ?? {};
                        let rawSubtotal = 0;
                        let rawHasAny = false;
                        let weightedSubtotal = 0;
                        let weightedHasAny = false;
                        for (const criterion of resolvedFocusCriteria) {
                          const rawValue = judgeScores[criterion.id] ?? null;
                          if (rawValue !== null) {
                            rawSubtotal += rawValue;
                            rawHasAny = true;
                            weightedSubtotal += rawValue * (criterion.weight / 100);
                            weightedHasAny = true;
                          }
                        }
                        return {
                          judgeId: judge.id,
                          rawSubtotal: rawHasAny ? rawSubtotal : null,
                          weightedSubtotal: weightedHasAny ? weightedSubtotal : null,
                        };
                      });
                      const subtotals = rawSubtotalsUnrounded.map((s) => ({
                        judgeId: s.judgeId,
                        rawSubtotal: s.rawSubtotal === null ? null : round4(s.rawSubtotal),
                        weightedSubtotal:
                          s.weightedSubtotal === null ? null : round4(s.weightedSubtotal),
                      }));
                      const displaySubtotals = subtotals.map((s) => ({
                        judgeId: s.judgeId,
                        subtotal: weighted ? s.weightedSubtotal : s.rawSubtotal,
                      }));
                      const rawScored = rawSubtotalsUnrounded
                        .map((s) => s.rawSubtotal)
                        .filter((v): v is number => v !== null);
                      const rawAverage = rawScored.length
                        ? round4(rawScored.reduce((sum, v) => sum + v, 0) / rawScored.length)
                        : null;
                      const weightedScored = rawSubtotalsUnrounded
                        .map((s) => s.weightedSubtotal)
                        .filter((v): v is number => v !== null);
                      const weightedAverage = weightedScored.length
                        ? round4(weightedScored.reduce((sum, v) => sum + v, 0) / weightedScored.length)
                        : null;
                      const average = weighted ? weightedAverage : rawAverage;
                      return { row, subtotals, displaySubtotals, average, rawAverage, weightedAverage };
                    });

                    const scoredForRank = withAverage.filter(
                      (r): r is typeof r & { weightedAverage: number } =>
                        r.weightedAverage !== null,
                    );
                    const rankByContestantId = new Map(
                      rankDesc(scoredForRank, (r) => r.weightedAverage).map((r) => [
                        r.row.row.contestantId,
                        r.rank,
                      ]),
                    );

                    // Highest average first; unscored contestants (no rank) sink
                    // to the bottom instead of breaking the sort.
                    const sorted = [...withAverage].sort((a, b) => {
                      const rankA = rankByContestantId.get(a.row.contestantId);
                      const rankB = rankByContestantId.get(b.row.contestantId);
                      if (rankA === undefined && rankB === undefined) return 0;
                      if (rankA === undefined) return 1;
                      if (rankB === undefined) return -1;
                      return rankA - rankB;
                    });

                    return sorted.map(({ row, subtotals, displaySubtotals, average, rawAverage }) => {
                    const rank = rankByContestantId.get(row.contestantId) ?? null;

                    return (
                      <TableRow key={row.contestantId}>
                        <TableCell className="sticky left-0 z-10 bg-background font-semibold">
                          {rank === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              {rank <= 3 && (
                                <Crown
                                  className={cn(
                                    "size-4",
                                    rank === 1 && "text-amber-500",
                                    rank === 2 && "text-zinc-400",
                                    rank === 3 && "text-amber-700",
                                  )}
                                />
                              )}
                              {rank}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="sticky left-16 z-10 whitespace-nowrap border-r border-border bg-background">
                          {contestantLabel(row)}
                        </TableCell>
                        {resolvedJudgeColumns.map((judge, judgeIndex) => {
                          const judgeScores = row.scores[judge.id] ?? {};
                          const subtotal = displaySubtotals[judgeIndex].subtotal;
                          const rawSubtotal = subtotals[judgeIndex].rawSubtotal;
                          return (
                            <JudgeCells key={judge.id}>
                              {resolvedFocusCriteria.map((criterion, index) => {
                                const rawValue = judgeScores[criterion.id] ?? null;
                                const value = display(rawValue, criterion.weight);
                                return (
                                  <TableCell
                                    key={criterion.id}
                                    className={cn(
                                      "text-right tabular-nums",
                                      index === 0 && "border-l border-border",
                                    )}
                                  >
                                    <ScoreValue
                                      value={value}
                                      rawValue={rawValue}
                                      showRaw={weighted}
                                    />
                                  </TableCell>
                                );
                              })}
                              <TableCell className="text-right font-medium tabular-nums">
                                <ScoreValue
                                  value={subtotal}
                                  rawValue={rawSubtotal}
                                  showRaw={weighted}
                                />
                              </TableCell>
                            </JudgeCells>
                          );
                        })}
                        <TableCell className="border-l border-border text-right font-semibold tabular-nums">
                          <ScoreValue value={average} rawValue={rawAverage} showRaw={weighted} />
                        </TableCell>
                      </TableRow>
                    );
                    });
                  })()}
                </TableBody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Top candidates view ────────────────────────────────────────────────────────

function TopCandidates({
  setColumns,
  setTotals,
}: {
  setColumns: SetColumn[];
  setTotals: SetTotalsRow[];
}) {
  const [scope, setScope] = useState("overall");
  const [topN, setTopN] = useState("5");

  const activeSetId = scope.startsWith("set:") ? scope.slice(4) : null;
  const validSet = activeSetId && setColumns.some((s) => s.id === activeSetId);

  function scopeValue(row: SetTotalsRow): number | null {
    if (validSet && activeSetId) {
      return row.cells.find((c) => c.setId === activeSetId)?.total ?? null;
    }
    return row.overall;
  }

  const ranked = useMemo(() => {
    const scored = setTotals
      .map((row) => ({ row, value: scopeValue(row) }))
      .filter((entry) => entry.value !== null) as { row: SetTotalsRow; value: number }[];
    const withRank = rankDesc(scored, (entry) => entry.value).map((r) => ({
      row: r.row.row,
      value: r.value,
      rank: r.rank,
    }));
    if (topN === "all") return withRank;
    const n = Number(topN);
    return withRank.filter((entry) => entry.rank <= n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTotals, scope, topN]);

  const scopeLabel = validSet
    ? setColumns.find((s) => s.id === activeSetId)?.name ?? "Set"
    : "Overall (this round)";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">Scope</span>
          <Select
            value={scope}
            onValueChange={(value) => value && setScope(value)}
            items={{
              overall: "Overall (this round)",
              ...Object.fromEntries(
                setColumns.map((s) => [`set:${s.id}`, `Set: ${s.name}`]),
              ),
            }}
          >
            <SelectTrigger className="w-[20rem]">
              <SelectValue placeholder="Choose a scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overall">
                Overall (this round)
              </SelectItem>
              {setColumns.map((set) => (
                <SelectItem key={set.id} value={`set:${set.id}`}>
                  Set: {set.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">Show</span>
          <Select
            value={topN}
            onValueChange={(value) => value && setTopN(value)}
            items={{ "3": "Top 3", "5": "Top 5", "10": "Top 10", all: "All ranked" }}
          >
            <SelectTrigger className="w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Top 3</SelectItem>
              <SelectItem value="5">Top 5</SelectItem>
              <SelectItem value="10">Top 10</SelectItem>
              <SelectItem value="all">All ranked</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scores yet for {scopeLabel}.</p>
      ) : (
        <div className={SCROLL_CONTAINER}>
          <table className={TABLE}>
            <TableHeader className={STICKY_HEAD}>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Contestant</TableHead>
                <TableHead className="text-right">{scopeLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((entry) => (
                <TableRow key={entry.row.contestantId}>
                  <TableCell className="font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      {entry.rank <= 3 && (
                        <Crown
                          className={cn(
                            "size-4",
                            entry.rank === 1 && "text-amber-500",
                            entry.rank === 2 && "text-zinc-400",
                            entry.rank === 3 && "text-amber-700",
                          )}
                        />
                      )}
                      {entry.rank}
                    </span>
                  </TableCell>
                  <TableCell>{contestantLabel(entry.row)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {entry.value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Renders the criterion sub-headers (with description tooltip) plus a Total. */
function CriteriaHeaderGroup({
  judgeId,
  criteria,
}: {
  judgeId: string;
  criteria: FocusCriterion[];
}) {
  return (
    <>
      {criteria.map((criterion, index) => (
        <TableHead
          key={`${judgeId}-${criterion.id}`}
          className={cn("text-right", index === 0 && "border-l border-border")}
        >
          <div className="grid gap-0.5">
            {criterion.description ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="cursor-help underline decoration-dotted underline-offset-2" />
                  }
                >
                  {criterion.name}
                </TooltipTrigger>
                <TooltipContent>{criterion.description}</TooltipContent>
              </Tooltip>
            ) : (
              criterion.name
            )}
            <span className="text-[0.65rem] font-normal text-muted-foreground">
              {criterion.weight}%
            </span>
          </div>
        </TableHead>
      ))}
      <TableHead className="text-right">Total</TableHead>
    </>
  );
}

/** Fragment wrapper so a judge's cells share a left border on the first cell. */
function JudgeCells({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * A score cell value. In weighted mode, shows an info icon whose tooltip
 * reveals the pre-weight raw score, since the weighted number alone hides
 * what the judge actually entered.
 */
function ScoreValue({
  value,
  rawValue,
  showRaw,
}: {
  value: number | null;
  rawValue: number | null;
  showRaw: boolean;
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (!showRaw || rawValue === null || rawValue === value) return <>{value}</>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex cursor-help items-center justify-end gap-1" />
        }
      >
        {value}
        <Info className="size-3 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>Raw score: {rawValue}</TooltipContent>
    </Tooltip>
  );
}

// ── Rank-order table (lowest combined rank wins) ─────────────────────────────

/**
 * Explains, in plain words, how a rank-sum tie was resolved for one contestant —
 * so the tabulator can see WHY the placement stands, not just the number.
 * Rank-order ties are broken by judges' head-to-head majority; an even split
 * shares the place.
 */
function rankOrderTieNote(
  row: RankOrderRow,
  cluster: RankOrderRow[],
  judges: RankOrder["judges"],
): { text: string; tone: "won" | "lost" | "shared" } | null {
  if (cluster.length < 2) return null; // not tied on rank sum → nothing to explain
  const peers = cluster.filter((c) => c.contestantId !== row.contestantId);
  let ahead = 0;
  let behind = 0;
  for (const peer of peers) {
    for (const judge of judges) {
      const a = row.ranksByJudge[judge.id];
      const b = peer.ranksByJudge[judge.id];
      if (a == null || b == null) continue;
      if (a < b) ahead += 1;
      else if (b < a) behind += 1;
    }
  }
  const peerNames = peers.map((p) => contestantLabel(p)).join(", ");
  const shared = cluster.every((c) => c.placement === row.placement);
  const votes = ahead + behind;
  if (shared) {
    return {
      tone: "shared",
      text: `Tied on rank sum ${row.rankSum} with ${peerNames} — judges split ${ahead}–${behind}, so they share this place.`,
    };
  }
  if (ahead >= behind) {
    return {
      tone: "won",
      text: `Won the tie on rank sum ${row.rankSum} vs ${peerNames} — majority ${ahead}–${behind} of ${votes} judge votes.`,
    };
  }
  return {
    tone: "lost",
    text: `Lost the tie on rank sum ${row.rankSum} to ${peerNames} — majority ${behind}–${ahead} of ${votes} judge votes.`,
  };
}

function RankOrderTable({
  rankOrder,
  eventId,
  canAdjust = false,
  tieBreaks = [],
  openTieBreakVotes = [],
}: {
  rankOrder: RankOrder;
  eventId?: string;
  canAdjust?: boolean;
  tieBreaks?: TieBreakSummary[];
  openTieBreakVotes?: TieBreakVoteSummary[];
}) {
  // Contestants sharing a rank sum are the ones a tie-break had to order.
  const clusterByRankSum = new Map<number, RankOrderRow[]>();
  for (const r of rankOrder.rows) {
    const arr = clusterByRankSum.get(r.rankSum) ?? [];
    arr.push(r);
    clusterByRankSum.set(r.rankSum, arr);
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Trophy className="size-4 text-yellow-500" />
        <span className="font-semibold text-base">
          Rank order — {rankOrder.groupName}
        </span>
        <span className="text-xs text-muted-foreground">
          · each judge&rsquo;s totals become ranks; the LOWEST combined rank wins.
          Ties are broken by judges&rsquo; majority.
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Under each judge: the rank they gave, with the score behind it below it.
      </p>

      <div className={SCROLL_CONTAINER}>
        <table className={TABLE}>
          <TableHeader className={STICKY_HEAD}>
            <TableRow>
              <TableHead className="w-16">Place</TableHead>
              <TableHead>Contestant</TableHead>
              {rankOrder.judges.map((judge) => (
                <TableHead key={judge.id} className="text-right">
                  {judge.displayName}
                </TableHead>
              ))}
              <TableHead className="border-l border-border text-right font-semibold">
                Rank sum
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rankOrder.rows.map((row, idx) => {
              const prevPlacement = idx > 0 ? rankOrder.rows[idx - 1].placement : null;
              const isTied = prevPlacement === row.placement;
              const cluster = clusterByRankSum.get(row.rankSum) ?? [];
              const tieNote = rankOrderTieNote(row, cluster, rankOrder.judges);
              const override = eventId
                ? findTieBreak(
                    tieBreaks,
                    "rank_order",
                    rankOrder.groupId,
                    cluster.map((c) => c.contestantId),
                  )
                : null;
              const openVote = eventId
                ? findOpenVote(
                    openTieBreakVotes,
                    "rank_order",
                    rankOrder.groupId,
                    cluster.map((c) => c.contestantId),
                  )
                : null;
              const stillTied = cluster.length > 1 && cluster.every((c) => c.placement === row.placement);
              return (
                <TableRow
                  key={row.contestantId}
                  className={cn(row.placement === 1 && "bg-yellow-50/60 dark:bg-yellow-900/10")}
                >
                  <TableCell className="font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      {row.placement <= 3 && (
                        <Crown
                          className={cn(
                            "size-4",
                            row.placement === 1 && "text-amber-500",
                            row.placement === 2 && "text-zinc-400",
                            row.placement === 3 && "text-amber-700",
                          )}
                        />
                      )}
                      {isTied ? `T-${row.placement}` : row.placement}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="whitespace-nowrap">{contestantLabel(row)}</span>
                      {override ? (
                        <span className="max-w-[22rem] text-[0.72rem] font-medium leading-snug text-sky-600 dark:text-sky-400">
                          {"◆ Manually resolved"}
                          {override.resolvedByName ? ` by ${override.resolvedByName}` : ""}
                          {override.note ? ` — ${override.note}` : "."}
                          <AfterHydration>
                            {eventId ? (
                              <>
                                {" "}
                                <RevertTieBreakButton eventId={eventId} tieBreakId={override.id} />
                              </>
                            ) : null}
                          </AfterHydration>
                        </span>
                      ) : (
                        tieNote && (
                          <span
                            className={cn(
                              "max-w-[22rem] text-[0.72rem] font-medium leading-snug",
                              tieNote.tone === "won" && "text-emerald-600 dark:text-emerald-400",
                              tieNote.tone === "lost" && "text-muted-foreground",
                              tieNote.tone === "shared" && "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {tieNote.tone === "won" ? "▲ " : tieNote.tone === "shared" ? "▬ " : "▽ "}
                            {tieNote.text}
                            <AfterHydration>
                              {openVote && eventId ? (
                                <>
                                  {" "}
                                  <TieBreakVoteTally eventId={eventId} vote={openVote} />
                                </>
                              ) : stillTied && canAdjust && eventId ? (
                                <>
                                  {" "}
                                  <TieBreakDialog
                                    eventId={eventId}
                                    scope="rank_order"
                                    contextId={rankOrder.groupId}
                                    contestants={cluster.map((c) => ({
                                      id: c.contestantId,
                                      displayNumber: c.displayNumber,
                                      displayName: c.displayName,
                                    }))}
                                    rankLabel={`rank sum ${row.rankSum}`}
                                    trigger={
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
                                      >
                                        <Scale className="size-3" />
                                        Break tie
                                      </button>
                                    }
                                  />{" "}
                                  <AskJudgesDialog
                                    eventId={eventId}
                                    scope="rank_order"
                                    contextId={rankOrder.groupId}
                                    tiedContestantIds={cluster.map((c) => c.contestantId)}
                                    rankLabel={`rank sum ${row.rankSum}`}
                                    trigger={
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
                                      >
                                        <Vote className="size-3" />
                                        Ask judges
                                      </button>
                                    }
                                  />
                                </>
                              ) : null}
                            </AfterHydration>
                          </span>
                        )
                      )}
                    </div>
                  </TableCell>
                  {rankOrder.judges.map((judge) => {
                    const rank = row.ranksByJudge[judge.id];
                    const score = row.scoresByJudge?.[judge.id];
                    return (
                      <TableCell key={judge.id} className="text-right tabular-nums">
                        {rank == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="inline-flex flex-col items-end leading-tight">
                            <span className="font-semibold">{rank}</span>
                            {score != null && (
                              <span className="text-[0.7rem] font-normal text-muted-foreground">
                                {score.toFixed(2)}
                              </span>
                            )}
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="border-l border-border text-right font-semibold tabular-nums">
                    {row.rankSum}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </table>
      </div>
    </div>
  );
}

// ── Final rankings table ──────────────────────────────────────────────────────

function fmtScore(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "") || "0";
}

/**
 * Explains how a tie on the OVERALL score was resolved in the standings, so the
 * tabulator sees why the order stands. Points ties are broken by the event's
 * configured method (countback / highest single set); "shared" leaves them level.
 */
function standingsTieNote(
  row: FinalRankingsRow,
  peers: FinalRankingsRow[],
  tieBreak: TieBreak,
): { text: string; tone: "won" | "lost" | "shared" } | null {
  const others = peers.filter((p) => p.contestantId !== row.contestantId);
  if (others.length === 0) return null;
  const names = others
    .map((p) => (p.displayNumber ? `#${p.displayNumber}` : p.displayName))
    .join(", ");
  const how = TIE_BREAK_HOW[tieBreak];
  const allShared = others.every((p) => p.rank === row.rank);
  if (allShared) {
    return {
      tone: "shared",
      text:
        tieBreak === "shared"
          ? `Tied on ${fmtScore(row.overall)} with ${names} — shared rank (no tie-break set).`
          : `Tied on ${fmtScore(row.overall)} with ${names} — still level after ${how}.`,
    };
  }
  const placedAbove = others.some((p) => row.rank < p.rank);
  return placedAbove
    ? { tone: "won", text: `Broke a ${fmtScore(row.overall)} tie vs ${names} — ${how}.` }
    : { tone: "lost", text: `Lost a ${fmtScore(row.overall)} tie to ${names} — ${how}.` };
}

function FinalRankingsTable({
  columns,
  rows,
  title = "Final Rankings",
  description,
  isFinal = true,
  tieBreak = "shared",
  advanceCount = null,
  advanceRoundName = null,
  eventId,
  canAdjust = false,
  tieBreaks = [],
  openTieBreakVotes = [],
  tieBreakContext = null,
}: {
  columns: FinalRankingsColumn[];
  rows: FinalRankingsRow[];
  /** Header label. Defaults to "Final Rankings". */
  title?: string;
  /** Optional sub-header note shown under the title. */
  description?: string;
  /**
   * Whether these rows are the event's true final ranking. When a rank-order
   * round follows, this table only shows the cumulative standings feeding
   * advancement, so pass `false` to drop the winner (Trophy) framing.
   */
  isFinal?: boolean;
  /** Event's points tie-break method — used to explain resolved ties. */
  tieBreak?: TieBreak;
  /** Advancement cut (top N); draws the cut line. Null = no advancement. */
  advanceCount?: number | null;
  /** Target round name shown on the advancement cut line. */
  advanceRoundName?: string | null;
  eventId?: string;
  canAdjust?: boolean;
  tieBreaks?: TieBreakSummary[];
  openTieBreakVotes?: TieBreakVoteSummary[];
  /** Which tie scope/context this table's ties should be saved/looked up under; null disables the Break-tie control. */
  tieBreakContext?: { scope: "standings" | "advancement"; contextId: string | null } | null;
}) {
  const hasWeights = columns.some((c) => c.weight !== 100);
  const colSpan = columns.length + 3;

  // Contestants sharing an overall score are the ones the tie-break had to order.
  const peersByOverall = new Map<number, FinalRankingsRow[]>();
  for (const r of rows) {
    const key = round4(r.overall);
    const arr = peersByOverall.get(key) ?? [];
    arr.push(r);
    peersByOverall.set(key, arr);
  }

  // The advancement cut line goes after the last contestant that advances. When
  // a tie sits on the cut and isn't broken, MORE than N advance — worth flagging.
  const advancingCount =
    advanceCount == null ? null : rows.filter((r) => r.rank <= advanceCount).length;
  const cutAfterIndex =
    advanceCount == null
      ? -1
      : rows.reduce((last, r, i) => (r.rank <= advanceCount ? i : last), -1);
  const cutSplitsATie =
    advanceCount != null &&
    advancingCount != null &&
    advancingCount > advanceCount; // ties let extra contestants in

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          {isFinal ? (
            <Trophy className="size-4 text-yellow-500" />
          ) : (
            <Layers className="size-4 text-muted-foreground" />
          )}
          <span className="font-semibold text-base">{title}</span>
          {hasWeights && (
            <span className="text-xs text-muted-foreground">
              · weighted by round contribution %
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      <div className={SCROLL_CONTAINER}>
        <table className={TABLE}>
          <thead className={STICKY_HEAD}>
            <tr>
              <th className="w-12 px-3 py-2.5 text-left text-sm font-medium text-muted-foreground">
                #
              </th>
              <th className="px-3 py-2.5 text-left text-sm font-medium text-muted-foreground">
                Contestant
              </th>
              {columns.map((col) => (
                <th
                  key={col.groupId}
                  className="px-3 py-2.5 text-right text-sm font-medium text-muted-foreground"
                >
                  {col.groupName}
                  {hasWeights && (
                    <span className="ml-1 font-normal opacity-60">({col.weight}%)</span>
                  )}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right text-sm font-semibold">
                Overall
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const prevRank = idx > 0 ? rows[idx - 1].rank : null;
              const isTied = prevRank === row.rank;
              const cluster = peersByOverall.get(round4(row.overall)) ?? [];
              const tieNote = standingsTieNote(row, cluster, tieBreak);
              const override =
                eventId && tieBreakContext
                  ? findTieBreak(
                      tieBreaks,
                      tieBreakContext.scope,
                      tieBreakContext.contextId,
                      cluster.map((c) => c.contestantId),
                    )
                  : null;
              const openVote =
                eventId && tieBreakContext
                  ? findOpenVote(
                      openTieBreakVotes,
                      tieBreakContext.scope,
                      tieBreakContext.contextId,
                      cluster.map((c) => c.contestantId),
                    )
                  : null;
              const stillTied = cluster.length > 1 && cluster.every((c) => c.rank === row.rank);
              return (
                <Fragment key={row.contestantId}>
                <tr
                  className={cn(
                    "border-t border-border transition-colors hover:bg-muted/40",
                    isFinal && row.rank === 1 && "bg-yellow-50/60 dark:bg-yellow-900/10",
                  )}
                >
                  <td className="px-3 py-2.5 text-sm font-medium tabular-nums">
                    <span className="flex items-center gap-1">
                      {isFinal && row.rank === 1 && (
                        <Crown className="size-3.5 text-yellow-500" />
                      )}
                      {isTied ? <span className="text-muted-foreground">T-{row.rank}</span> : row.rank}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-sm">
                        {row.displayNumber ? `${row.displayNumber}. ` : ""}
                        {row.displayName}
                      </span>
                      {override ? (
                        <span className="max-w-[24rem] text-[0.72rem] font-medium leading-snug text-sky-600 dark:text-sky-400">
                          {"◆ Manually resolved"}
                          {override.resolvedByName ? ` by ${override.resolvedByName}` : ""}
                          {override.note ? ` — ${override.note}` : "."}
                          <AfterHydration>
                            {eventId ? (
                              <>
                                {" "}
                                <RevertTieBreakButton eventId={eventId} tieBreakId={override.id} />
                              </>
                            ) : null}
                          </AfterHydration>
                        </span>
                      ) : (
                        tieNote && (
                          <span
                            className={cn(
                              "max-w-[24rem] text-[0.72rem] font-medium leading-snug",
                              tieNote.tone === "won" && "text-emerald-600 dark:text-emerald-400",
                              tieNote.tone === "lost" && "text-muted-foreground",
                              tieNote.tone === "shared" && "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {tieNote.tone === "won" ? "▲ " : tieNote.tone === "shared" ? "▬ " : "▽ "}
                            {tieNote.text}
                            <AfterHydration>
                              {openVote && eventId ? (
                                <>
                                  {" "}
                                  <TieBreakVoteTally eventId={eventId} vote={openVote} />
                                </>
                              ) : stillTied && canAdjust && eventId && tieBreakContext ? (
                                <>
                                  {" "}
                                  <TieBreakDialog
                                    eventId={eventId}
                                    scope={tieBreakContext.scope}
                                    contextId={tieBreakContext.contextId}
                                    contestants={cluster.map((c) => ({
                                      id: c.contestantId,
                                      displayNumber: c.displayNumber,
                                      displayName: c.displayName,
                                    }))}
                                    rankLabel={`rank ${row.rank}`}
                                    trigger={
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
                                      >
                                        <Scale className="size-3" />
                                        Break tie
                                      </button>
                                    }
                                  />{" "}
                                  <AskJudgesDialog
                                    eventId={eventId}
                                    scope={tieBreakContext.scope}
                                    contextId={tieBreakContext.contextId}
                                    tiedContestantIds={cluster.map((c) => c.contestantId)}
                                    rankLabel={`rank ${row.rank}`}
                                    trigger={
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
                                      >
                                        <Vote className="size-3" />
                                        Ask judges
                                      </button>
                                    }
                                  />
                                </>
                              ) : null}
                            </AfterHydration>
                          </span>
                        )
                      )}
                    </div>
                  </td>
                  {row.roundScores.map((cell) => (
                    <td
                      key={cell.groupId}
                      className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground"
                    >
                      {cell.score === null ? (
                        <span className="opacity-30">—</span>
                      ) : (
                        fmtScore(cell.score)
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums">
                    {fmtScore(row.overall)}
                  </td>
                </tr>
                {idx === cutAfterIndex && idx < rows.length - 1 && (
                  <tr>
                    <td colSpan={colSpan} className="p-0">
                      <div className="flex items-center gap-2 border-y-2 border-dashed border-primary/50 bg-primary/5 px-3 py-1 text-[0.72rem] font-semibold text-primary">
                        ✂ Advancement cut — top {advanceCount} advance
                        {advanceRoundName ? ` to ${advanceRoundName}` : ""}
                        {cutSplitsATie
                          ? ` · ⚠ a tie on the line means ${advancingCount} advance (set a tie-break to cut to ${advanceCount})`
                          : ""}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
