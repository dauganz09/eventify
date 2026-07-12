import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import {
  aggregateResults,
  contestants,
  criteria,
  events,
  judgeAssignments,
  judges,
  judgeSessions,
  judgeSetSubmissions,
  roundGroups,
  rounds,
  scoreConflicts,
  scoreRecords,
  scoringRules,
} from "@/db/schema";
import { calculateContestantResults } from "@/lib/scoring/calculate";
import {
  applyManualOverrides,
  computeRankOrder,
  parseRoundScoreMode,
  parseScoringMethod,
  parseTieBreak,
  rankWithTieBreak,
  type RoundScoreMode,
  type TieBreak,
} from "@/lib/scoring/ranking";
import { listTieBreaks, overrideMapFor } from "@/lib/scoring/tie-break-service";
import { listOpenVotes } from "@/lib/scoring/tie-break-vote-service";
import type { AggregationRule, CriterionConfig, SubmittedScore } from "@/lib/scoring/types";

const AGGREGATION_RULES: readonly AggregationRule[] = [
  "sum",
  "average",
  "weighted_sum",
  "drop_high",
  "drop_low",
  "drop_high_low",
];

function toAggregationRule(value: string | null | undefined): AggregationRule {
  return AGGREGATION_RULES.includes(value as AggregationRule)
    ? (value as AggregationRule)
    : "weighted_sum";
}

function pct(submitted: number, expected: number) {
  if (expected <= 0) return 0;
  return Math.min(100, Math.round((submitted / expected) * 100));
}

// ── Public shapes ────────────────────────────────────────────────────────────

export type Lifecycle = "idle" | "active" | "finished";

/** A "set" in the UI == a `rounds` row. */
export interface SetSummary {
  id: string;
  name: string;
  position: number;
  groupId: string | null;
  status: Lifecycle;
  isActive: boolean;
  /** True when this set's totals carry forward into subsequent active rounds. */
  carryOver: boolean;
  /** True for manual-entry (pre-event) categories filled in by the tabulator. */
  isManualEntry: boolean;
  expected: number;
  submitted: number;
  completionPct: number;
}

/** A "round" in the UI == a `round_groups` row. */
export interface GroupSummary {
  id: string;
  name: string;
  position: number;
  status: Lifecycle;
  isActive: boolean;
  carryOver: boolean;
  /** Weight (0–100) applied when this round's scores carry forward. */
  carryOverWeight: number;
  /** Only the top N from previous rounds may be scored in this round (null = everyone). */
  advanceCount: number | null;
  /** "number" | "rank" — how qualifiers are ordered in the judge panel. */
  advanceDisplayOrder: string;
  /** "points" | "rank_order" — how this round decides its winner. */
  scoringMethod: string;
  /** True once a qualifier snapshot was taken (happens on activation). */
  hasQualifierSnapshot: boolean;
  sets: SetSummary[];
}

export interface JudgeSummary {
  id: string;
  displayName: string;
  isActive: boolean;
  submitted: number;
  /** True when the judge currently has a live (non-expired) login session. */
  signedIn: boolean;
  /**
   * Per-judge completion on the currently ACTIVE set: how many contestants the
   * judge has fully scored (all required criteria submitted) out of the total.
   * `null` when there's no active set, or the judge isn't scoring that set.
   */
  activeSetProgress: { setId: string; setName: string; done: number; total: number } | null;
  /** True when the judge has finalized ("submit & lock") the active set. */
  finalizedActiveSet: boolean;
}

export interface SetTotalsCell {
  setId: string;
  total: number | null;
}

export interface SetTotalsRow {
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  photoUrl: string | null;
  /** One cell per set in the active round. */
  cells: SetTotalsCell[];
  /** Average across this round's scored set cells (sets without scores are excluded). */
  roundTotal: number;
  /** Average of the carried sets the contestant was scored in, across finished
   *  earlier rounds. 0 when no sets carry or the contestant has no carried scores. */
  carriedIn: number;
  /** roundTotal + carriedIn. */
  overall: number;
  rank: number;
}

/** One row in the final-standings table (shown when all rounds are finished). */
export interface FinalRankingsRow {
  rank: number;
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  photoUrl: string | null;
  /** Weighted-average score for each round group (null if not scored). */
  roundScores: Array<{ groupId: string; score: number | null }>;
  /** Sum of all weighted round contributions. */
  overall: number;
}

/** One column in the final-standings table. */
export interface FinalRankingsColumn {
  groupId: string;
  groupName: string;
  weight: number;
}

/** One row of a rank-order standings table (lowest rank-sum wins). */
export interface RankOrderRow {
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  photoUrl: string | null;
  /** judgeId -> the rank that judge's totals give this contestant (1 = best). */
  ranksByJudge: Record<string, number>;
  /** judgeId -> the score behind that judge's rank (null = not scored). */
  scoresByJudge: Record<string, number | null>;
  rankSum: number;
  /** Final placement (1 = winner); ties share a placement. */
  placement: number;
}

/** A scored-table column. Carries group metadata for round-scoped & carry-over views. */
export interface SetColumn {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  /** Round-group ordering; ungrouped sets sort last via a large sentinel. */
  groupPosition: number;
  /** When true, this set's round group carries forward prior groups' totals. */
  carryOver: boolean;
}

export interface FocusCriterion {
  id: string;
  name: string;
  description: string | null;
  weight: number;
}

export interface JudgeMatrixRow {
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  /** judgeId -> criterionId -> raw value the judge gave (null = not scored). */
  scores: Record<string, Record<string, number | null>>;
}

export interface ManualSetCriterion {
  id: string;
  name: string;
  minValue: number | null;
  maxValue: number | null;
}

export interface ManualSetRow {
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  /** criterionId -> entered value (null = not yet entered). */
  values: Record<string, number | null>;
}

/** A tabulator's manually-resolved tie, as shown in the UI. */
export interface TieBreakSummary {
  id: string;
  scope: "standings" | "advancement" | "rank_order";
  contextId: string | null;
  tiedContestantIds: string[];
  resolvedOrder: string[];
  method: "manual" | "judge_vote";
  note: string | null;
  resolvedByName: string | null;
}

/** A currently-open "ask the judges" vote for the tabulator's live tally. */
export interface TieBreakVoteSummary {
  id: string;
  scope: "standings" | "advancement" | "rank_order";
  contextId: string | null;
  tiedContestantIds: string[];
  eligibleJudges: { id: string; displayName: string }[];
  votedJudgeIds: string[];
}

/** A manual-entry (pre-event) category the tabulator types final scores into. */
export interface ManualSet {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  criteria: ManualSetCriterion[];
  rows: ManualSetRow[];
  submitted: number;
  expected: number;
  completionPct: number;
}

export interface EventTabulatorDetail {
  event: { id: string; name: string; status: string; logoUrl: string | null };
  widgets: {
    progressPct: number;
    submitted: number;
    expected: number;
    activeSets: number;
    totalSets: number;
    contestants: number;
    activeJudges: number;
    conflicts: number;
  };
  groups: GroupSummary[];
  ungroupedSets: SetSummary[];
  /** Manual-entry categories (pre-event), each with an editable score grid. */
  manualSets: ManualSet[];
  judges: JudgeSummary[];
  /** The currently active round group, if any (drives which columns show). */
  activeRound: { id: string; name: string; carryOver: boolean } | null;
  /**
   * Advancement scope for the active round, or a preview of who would advance
   * into the next rank-order round before it is activated.
   */
  advancement: {
    /** The round_groups.id the qualifiers are advancing into. */
    groupId: string;
    count: number;
    qualifiedIds: string[];
    displayOrder: string;
    roundName: string;
    /** True when the target round is not yet active (preview before activation). */
    isPreview: boolean;
  } | null;
  /**
   * Rank-order standings for the active rank-order round (or, when no round is
   * active, the most recent finished rank-order round — the final result).
   */
  rankOrder: {
    groupId: string;
    groupName: string;
    judges: { id: string; displayName: string }[];
    rows: RankOrderRow[];
  } | null;
  /** How set totals combine into a round total ("average" | "sum"). */
  roundScoreMode: RoundScoreMode;
  /** The event's configured points tie-break method (drives standings order). */
  tieBreak: TieBreak;
  /** Finished earlier rounds whose scores carry into the active round. */
  carriedFromRounds: { id: string; name: string }[];
  /** Columns for the sets in the active round only (empty when no active round). */
  setColumns: SetColumn[];
  setTotals: SetTotalsRow[];
  focusSetId: string | null;
  focusCriteria: FocusCriterion[];
  judgeColumns: { id: string; displayName: string }[];
  judgeMatrix: JudgeMatrixRow[];
  /**
   * Final weighted standings across finished point rounds. Populated when there
   * is no active round, a rank-order round is active, or every set in the last
   * points round before a rank-order round is finished (advancement preview).
   */
  finalRankings: {
    columns: FinalRankingsColumn[];
    rows: FinalRankingsRow[];
  } | null;
  /**
   * True when cumulative standings + advancement cut should be shown before
   * activating the next rank-order round — including while the last points
   * round is still marked active but all of its sets are finished.
   */
  advancementPreview: boolean;
  /** The event's live manual tie-break overrides, across every scope/context. */
  tieBreaks: TieBreakSummary[];
  /** Currently-open "ask the judges" votes, for the tabulator's live tally. */
  openTieBreakVotes: TieBreakVoteSummary[];
}

// ── Cumulative standings (shared by final rankings + advancement) ───────────

export interface GroupStandingsGroup {
  id: string;
  position: number;
  carryOver: boolean;
  carryOverWeight: number;
  sets: Array<{ id: string; carryOver: boolean }>;
}

export interface GroupStandingRow {
  contestantId: string;
  roundScores: Array<{ groupId: string; score: number | null }>;
  overall: number;
  rank: number;
}

/**
 * Standings across a list of FINISHED round groups. Used for the final
 * rankings table and for the top-N advancement snapshot, so both are computed
 * from exactly the same math.
 *
 * Only carry-over-flagged sets of carry-over groups contribute to the overall
 * (weighted by carryOverWeight); when no carry-over is configured, all groups
 * count — averaged equally, or plainly summed in points-based events.
 */
export function computeGroupStandings(params: {
  groups: GroupStandingsGroup[];
  /** setId -> contestantId -> judge-averaged set total. */
  totalsBySet: Map<string, Map<string, number>>;
  contestantIds: string[];
  roundScoreMode: RoundScoreMode;
  tieBreak: ReturnType<typeof parseTieBreak>;
  /** Tabulator-resolved tie overrides (tieKeyFor(ids) -> order), if any. */
  manualOverrides?: Map<string, string[]>;
}): { rows: GroupStandingRow[]; useCarryOver: boolean } {
  const { totalsBySet, roundScoreMode } = params;
  const finishedGroups = [...params.groups].sort((a, b) => a.position - b.position);

  const finishedCarriedGroups = finishedGroups
    .filter((g) => g.carryOver)
    .map((g) => ({ ...g, sets: g.sets.filter((s) => s.carryOver) }))
    .filter((g) => g.sets.length > 0);
  const useCarryOver = finishedCarriedGroups.length > 0;
  const scoringGroups = useCarryOver ? finishedCarriedGroups : finishedGroups;

  const unranked = params.contestantIds.map((contestantId) => {
    let overall = 0;
    const roundScores: GroupStandingRow["roundScores"] = finishedGroups.map((group) => {
      // Use only the carry-over-flagged sets for this group, if any.
      const scoringGroup = scoringGroups.find((sg) => sg.id === group.id);
      const setIds = scoringGroup
        ? scoringGroup.sets.map((s) => s.id)
        : group.sets.map((s) => s.id);
      const scored = setIds.filter((id) => totalsBySet.get(id)?.has(contestantId));
      if (scored.length === 0) return { groupId: group.id, score: null };
      const sum = scored.reduce(
        (s, id) => s + (totalsBySet.get(id)?.get(contestantId) ?? 0),
        0,
      );
      // Group score = mean of its scored sets, or their SUM in points-based
      // events (e.g. three 10-point sets making a 30-point round).
      const groupScore = roundScoreMode === "sum" ? sum : sum / scored.length;
      // Only add to overall if this group is in the scoring set.
      if (scoringGroup) {
        const weight = useCarryOver
          ? group.carryOverWeight / 100
          : roundScoreMode === "sum"
            ? 1
            : 1 / scoringGroups.length;
        overall += groupScore * weight;
      }
      return {
        groupId: group.id,
        score: Math.round((groupScore + Number.EPSILON) * 10_000) / 10_000,
      };
    });
    return {
      contestantId,
      roundScores,
      overall: Math.round((overall + Number.EPSILON) * 10_000) / 10_000,
    };
  });

  const rankMap = applyManualOverrides(
    rankWithTieBreak(
      unranked.map((r) => ({
        id: r.contestantId,
        primary: r.overall,
        setScoresByRecency: r.roundScores.map((s) => s.score ?? 0).reverse(),
      })),
      params.tieBreak,
    ),
    params.manualOverrides ?? new Map(),
  );

  const rows = unranked
    .map((r) => ({ ...r, rank: rankMap.get(r.contestantId) ?? 0 }))
    .sort((a, b) => a.rank - b.rank || b.overall - a.overall);

  return { rows, useCarryOver };
}

/**
 * Loads submitted scores and returns cumulative standings over the event's
 * FINISHED round groups (optionally only those before a given position).
 * Used by the tabulator's round-activation action to snapshot the top-N
 * qualifiers for an advancement-restricted round.
 */
export async function getCumulativeStandings(params: {
  database: typeof db;
  eventId: string;
  /** Only groups with position strictly below this count (e.g. the group being activated). */
  beforePosition?: number;
  /** Tabulator-resolved tie overrides (tieKeyFor(ids) -> order), if any. */
  manualOverrides?: Map<string, string[]>;
}): Promise<{ rows: GroupStandingRow[] }> {
  const { database, eventId } = params;

  const [[event], groupRows, roundRows, criteriaRows, contestantRows, scoreRows, assignmentRows, judgeRows] =
    await Promise.all([
      database
        .select({ config: events.config })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1),
      database.select().from(roundGroups).where(eq(roundGroups.eventId, eventId)),
      database.select().from(rounds).where(eq(rounds.eventId, eventId)),
      database
        .select({ id: criteria.id, roundId: criteria.roundId, weight: criteria.weight })
        .from(criteria)
        .where(eq(criteria.eventId, eventId)),
      database
        .select({ id: contestants.id })
        .from(contestants)
        .where(and(eq(contestants.eventId, eventId), isNull(contestants.archivedAt))),
      database
        .select({
          roundId: scoreRecords.roundId,
          contestantId: scoreRecords.contestantId,
          judgeId: scoreRecords.judgeId,
          criterionId: scoreRecords.criterionId,
          value: scoreRecords.value,
        })
        .from(scoreRecords)
        .where(and(eq(scoreRecords.eventId, eventId), eq(scoreRecords.status, "submitted"))),
      database
        .select({
          judgeId: judgeAssignments.judgeId,
          roundId: judgeAssignments.roundId,
          roundGroupId: judgeAssignments.roundGroupId,
        })
        .from(judgeAssignments)
        .where(eq(judgeAssignments.eventId, eventId)),
      database
        .select({ id: judges.id, isActive: judges.isActive, isSystem: judges.isSystem })
        .from(judges)
        .where(eq(judges.eventId, eventId)),
    ]);

  const roundScoreMode = parseRoundScoreMode(
    (event?.config as Record<string, unknown> | null)?.roundScoreMode,
  );
  const tieBreak = parseTieBreak(
    (event?.config as Record<string, unknown> | null)?.tieBreak,
  );

  const weightByCriterion = new Map(criteriaRows.map((c) => [c.id, Number(c.weight ?? 100)]));

  // Same judge-assignment scoping as getEventTabulatorDetail's totalsBySet: a
  // judge reassigned away after scoring shouldn't keep pulling weight in the
  // cumulative standings that decide who qualifies for the next round.
  const activeJudgeIds = judgeRows.filter((j) => j.isActive && !j.isSystem).map((j) => j.id);
  const manualEntryRoundIds = new Set(roundRows.filter((r) => r.isManualEntry).map((r) => r.id));
  function judgesForSet(setId: string): string[] {
    const groupId = roundRows.find((r) => r.id === setId)?.roundGroupId ?? null;
    const ids = new Set<string>();
    for (const assignment of assignmentRows) {
      const eventWide = assignment.roundId === null && assignment.roundGroupId === null;
      const matchesSet = assignment.roundId === setId;
      const matchesRound = assignment.roundGroupId !== null && assignment.roundGroupId === groupId;
      if (eventWide || matchesSet || matchesRound) {
        ids.add(assignment.judgeId);
      }
    }
    if (ids.size === 0) return activeJudgeIds;
    return Array.from(ids).filter((id) => activeJudgeIds.includes(id));
  }

  // setId -> contestantId -> judge-averaged weighted total (same math as the
  // tabulator detail loader).
  const perJudge = new Map<string, Map<string, Map<string, number>>>();
  const eligibleJudgesBySet = new Map<string, Set<string>>();
  for (const row of scoreRows) {
    if (row.value === null) continue;
    if (!manualEntryRoundIds.has(row.roundId)) {
      let eligible = eligibleJudgesBySet.get(row.roundId);
      if (eligible === undefined) {
        eligible = new Set(judgesForSet(row.roundId));
        eligibleJudgesBySet.set(row.roundId, eligible);
      }
      if (!eligible.has(row.judgeId)) continue;
    }
    const weighted = Number(row.value) * ((weightByCriterion.get(row.criterionId) ?? 100) / 100);
    const byContestant = perJudge.get(row.roundId) ?? new Map();
    const byJudge = byContestant.get(row.contestantId) ?? new Map<string, number>();
    byJudge.set(row.judgeId, (byJudge.get(row.judgeId) ?? 0) + weighted);
    byContestant.set(row.contestantId, byJudge);
    perJudge.set(row.roundId, byContestant);
  }
  const totalsBySet = new Map<string, Map<string, number>>();
  for (const [setId, byContestant] of perJudge.entries()) {
    const averages = new Map<string, number>();
    for (const [contestantId, byJudge] of byContestant.entries()) {
      const totals = Array.from(byJudge.values());
      const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
      averages.set(contestantId, Math.round((average + Number.EPSILON) * 10_000) / 10_000);
    }
    totalsBySet.set(setId, averages);
  }

  const finishedGroups: GroupStandingsGroup[] = groupRows
    .filter(
      (g) =>
        g.status === "finished" &&
        (params.beforePosition === undefined || g.position < params.beforePosition),
    )
    .map((g) => ({
      id: g.id,
      position: g.position,
      carryOver: g.carryOverScores,
      carryOverWeight: g.carryOverWeight,
      sets: roundRows
        .filter((r) => r.roundGroupId === g.id)
        .map((r) => ({ id: r.id, carryOver: r.carryOverScores })),
    }));

  return computeGroupStandings({
    groups: finishedGroups,
    totalsBySet,
    contestantIds: contestantRows.map((c) => c.id),
    roundScoreMode,
    tieBreak,
    manualOverrides: params.manualOverrides,
  });
}

/**
 * Snapshot the top-N qualifiers for an advancement-restricted round group,
 * writing them to `round_groups.qualified_contestant_ids` (rank order, best
 * first). Called when the group is activated; re-activating recomputes.
 *
 * Returns null when the group has no advancement restriction. Throws when the
 * restriction can't be satisfied (no scored finished rounds to qualify from).
 */
export async function snapshotAdvancementQualifiers(params: {
  database: typeof db;
  eventId: string;
  groupId: string;
}): Promise<{ qualifiedIds: string[]; standings: GroupStandingRow[] } | null> {
  const { database, eventId, groupId } = params;

  const [group] = await database
    .select({
      id: roundGroups.id,
      position: roundGroups.position,
      advanceCount: roundGroups.advanceCount,
    })
    .from(roundGroups)
    .where(and(eq(roundGroups.id, groupId), eq(roundGroups.eventId, eventId)))
    .limit(1);
  if (!group || group.advanceCount === null) return null;

  const tieBreakRows = await listTieBreaks(database, eventId);
  const { rows } = await getCumulativeStandings({
    database,
    eventId,
    beforePosition: group.position,
    manualOverrides: overrideMapFor(tieBreakRows, "advancement", groupId),
  });
  const scoredRows = rows.filter((row) =>
    row.roundScores.some((score) => score.score !== null),
  );
  if (scoredRows.length === 0) {
    throw new Error(
      "This round only admits the top contestants from previous rounds, but no finished round has scores yet. Finish and score an earlier round first.",
    );
  }

  // Top N by rank; contestants tied at the cut-off rank all qualify.
  const qualifiedIds = scoredRows
    .filter((row) => row.rank <= group.advanceCount!)
    .map((row) => row.contestantId);

  await database
    .update(roundGroups)
    .set({ qualifiedContestantIds: qualifiedIds, updatedAt: new Date() })
    .where(eq(roundGroups.id, groupId));

  return { qualifiedIds, standings: scoredRows };
}

function isPointsRoundGroup(group: Pick<GroupSummary, "scoringMethod">) {
  return group.scoringMethod !== "rank_order";
}

function allSetsFinished(group: Pick<GroupSummary, "sets">) {
  return group.sets.length > 0 && group.sets.every((set) => set.status === "finished");
}

/**
 * The next rank-order round waiting to open once every preceding points round
 * has been scored (group finished, or still active with all sets finished).
 */
function resolvePendingAdvancementGroup(groups: GroupSummary[]): GroupSummary | null {
  const sorted = [...groups].sort((a, b) => a.position - b.position);
  for (const group of sorted) {
    if (group.scoringMethod !== "rank_order" || group.advanceCount === null) continue;
    if (group.status === "active") continue;

    const priorPoints = sorted.filter(
      (g) => g.position < group.position && isPointsRoundGroup(g),
    );
    if (priorPoints.length === 0) continue;

    const priorComplete = priorPoints.every(
      (g) => g.status === "finished" || allSetsFinished(g),
    );
    if (priorComplete) return group;
  }
  return null;
}

function buildAdvancement(params: {
  group: GroupSummary;
  qualifiedSnapshot: string[] | null;
  finalRankings: EventTabulatorDetail["finalRankings"];
}): EventTabulatorDetail["advancement"] {
  const { group, qualifiedSnapshot, finalRankings } = params;
  if (group.advanceCount === null) return null;

  const fromSnapshot =
    group.status === "active" && qualifiedSnapshot && qualifiedSnapshot.length > 0
      ? qualifiedSnapshot.slice(0, group.advanceCount)
      : null;
  const fromStandings =
    finalRankings?.rows
      .filter((row) => row.rank <= group.advanceCount!)
      .map((row) => row.contestantId) ?? [];

  const qualifiedIds = fromSnapshot ?? fromStandings;
  if (qualifiedIds.length === 0 && !finalRankings) return null;

  return {
    groupId: group.id,
    count: group.advanceCount,
    qualifiedIds,
    displayOrder: group.advanceDisplayOrder,
    roundName: group.name,
    isPreview: group.status !== "active",
  };
}

// ── Main loader ──────────────────────────────────────────────────────────────

export async function getEventTabulatorDetail(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  focusSetId?: string | null;
  /**
   * Live snapshot mode: load score row values only for these sets. Pair with
   * `submissionCountByRound` / `submissionCountByJudge` so completion widgets
   * stay accurate without scanning every score in the event.
   */
  scoreRoundFilter?: string[];
  submissionCountByRound?: Record<string, number>;
  submissionCountByJudge?: Record<string, number>;
}): Promise<EventTabulatorDetail> {
  const { database, organizationId, eventId } = params;

  const [event] = await database
    .select({
      id: events.id,
      name: events.name,
      status: events.status,
      logoUrl: events.logoUrl,
      config: events.config,
    })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.organizationId, organizationId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);

  if (!event) throw new Error("Event not found.");

  const tieBreak = parseTieBreak(
    (event.config as Record<string, unknown> | null)?.tieBreak,
  );
  const roundScoreMode = parseRoundScoreMode(
    (event.config as Record<string, unknown> | null)?.roundScoreMode,
  );

  const [
    groupRows,
    roundRows,
    contestantRows,
    criteriaRows,
    judgeRows,
    assignmentRows,
    conflictRows,
    sessionRows,
    submissionRows,
    tieBreakRows,
    openVoteRows,
  ] = await Promise.all([
      database
        .select()
        .from(roundGroups)
        .where(eq(roundGroups.eventId, eventId))
        .orderBy(asc(roundGroups.position), asc(roundGroups.createdAt)),
      database
        .select()
        .from(rounds)
        .where(eq(rounds.eventId, eventId))
        .orderBy(asc(rounds.position), asc(rounds.createdAt)),
      database
        .select({
          id: contestants.id,
          displayNumber: contestants.displayNumber,
          displayName: contestants.displayName,
          photoUrl: contestants.photoUrl,
        })
        .from(contestants)
        .where(and(eq(contestants.eventId, eventId), isNull(contestants.archivedAt)))
        .orderBy(
          sql`nullif(regexp_replace(coalesce(${contestants.displayNumber}, ''), '\\D', '', 'g'), '')::int asc nulls last`,
          asc(contestants.position),
          asc(contestants.displayName),
        ),
      database
        .select({
          id: criteria.id,
          name: criteria.name,
          description: criteria.description,
          roundId: criteria.roundId,
          weight: criteria.weight,
          minValue: criteria.minValue,
          maxValue: criteria.maxValue,
          isRequired: criteria.isRequired,
          position: criteria.position,
        })
        .from(criteria)
        .where(eq(criteria.eventId, eventId))
        .orderBy(asc(criteria.position), asc(criteria.name)),
      database
        .select({
          id: judges.id,
          displayName: judges.displayName,
          isActive: judges.isActive,
          isSystem: judges.isSystem,
        })
        .from(judges)
        .where(eq(judges.eventId, eventId))
        .orderBy(asc(judges.displayName)),
      database
        .select({
          judgeId: judgeAssignments.judgeId,
          roundId: judgeAssignments.roundId,
          roundGroupId: judgeAssignments.roundGroupId,
        })
        .from(judgeAssignments)
        .where(eq(judgeAssignments.eventId, eventId)),
      database
        .select({ id: scoreConflicts.id })
        .from(scoreConflicts)
        .where(and(eq(scoreConflicts.eventId, eventId), isNull(scoreConflicts.resolvedAt))),
      database
        .select({ judgeId: judgeSessions.judgeId })
        .from(judgeSessions)
        .where(
          and(eq(judgeSessions.eventId, eventId), gt(judgeSessions.expiresAt, new Date())),
        ),
      database
        .select({
          judgeId: judgeSetSubmissions.judgeId,
          roundId: judgeSetSubmissions.roundId,
        })
        .from(judgeSetSubmissions)
        .where(eq(judgeSetSubmissions.eventId, eventId)),
      listTieBreaks(database, eventId),
      listOpenVotes(database, eventId),
    ]);

  const signedInJudgeIds = new Set(sessionRows.map((r) => r.judgeId));
  // System judges (used only to hold manually-entered pre-event scores) are
  // never shown in judge-facing UI, online counts, or scoring matrices.
  const realJudgeRows = judgeRows.filter((judge) => !judge.isSystem);
  const activeJudges = realJudgeRows.filter((judge) => judge.isActive);
  const activeJudgeIds = activeJudges.map((judge) => judge.id);
  const contestantCount = contestantRows.length;

  function judgesForSet(setId: string): string[] {
    // Assignment scopes: a specific set (roundId), a whole round
    // (roundGroupId → every set inside it), or event-wide (both null).
    const groupId = roundRows.find((r) => r.id === setId)?.roundGroupId ?? null;
    const ids = new Set<string>();
    for (const assignment of assignmentRows) {
      const eventWide = assignment.roundId === null && assignment.roundGroupId === null;
      const matchesSet = assignment.roundId === setId;
      const matchesRound =
        assignment.roundGroupId !== null && assignment.roundGroupId === groupId;
      if (eventWide || matchesSet || matchesRound) {
        ids.add(assignment.judgeId);
      }
    }
    if (ids.size === 0) return activeJudgeIds;
    return Array.from(ids).filter((id) => activeJudgeIds.includes(id));
  }

  function requiredCriteriaForSet(setId: string) {
    return criteriaRows.filter((c) => c.roundId === setId && c.isRequired);
  }

  function weightForCriterion(criterionId: string, setId: string): number {
    const criterion = criteriaRows.find(
      (c) => c.id === criterionId && c.roundId === setId,
    );
    return Number(criterion?.weight ?? 100);
  }

  // Submitted score rows — optionally scoped to specific sets for live snapshots.
  const scoreConditions = [
    eq(scoreRecords.eventId, eventId),
    eq(scoreRecords.status, "submitted"),
  ];
  if (params.scoreRoundFilter && params.scoreRoundFilter.length > 0) {
    scoreConditions.push(inArray(scoreRecords.roundId, params.scoreRoundFilter));
  }

  const scoreRows = await database
    .select({
      roundId: scoreRecords.roundId,
      contestantId: scoreRecords.contestantId,
      judgeId: scoreRecords.judgeId,
      criterionId: scoreRecords.criterionId,
      value: scoreRecords.value,
    })
    .from(scoreRecords)
    .where(and(...scoreConditions));

  const submittedBySet = new Map<string, number>();
  const submittedByJudge = new Map<string, number>();
  const scoresBySet = new Map<string, SubmittedScore[]>();

  if (params.submissionCountByRound) {
    for (const [roundId, count] of Object.entries(params.submissionCountByRound)) {
      submittedBySet.set(roundId, count);
    }
  }
  if (params.submissionCountByJudge) {
    for (const [judgeId, count] of Object.entries(params.submissionCountByJudge)) {
      submittedByJudge.set(judgeId, count);
    }
  }

  for (const row of scoreRows) {
    if (!params.submissionCountByRound) {
      submittedBySet.set(row.roundId, (submittedBySet.get(row.roundId) ?? 0) + 1);
    }
    if (!params.submissionCountByJudge) {
      submittedByJudge.set(row.judgeId, (submittedByJudge.get(row.judgeId) ?? 0) + 1);
    }
    if (row.value !== null) {
      const bucket = scoresBySet.get(row.roundId) ?? [];
      bucket.push({
        contestantId: row.contestantId,
        judgeId: row.judgeId,
        criterionId: row.criterionId,
        value: Number(row.value),
      });
      scoresBySet.set(row.roundId, bucket);
    }
  }

  // Qualifier snapshots: groups restricted to the top N carry the qualifying
  // contestant ids (taken at activation). Intersect with current contestants so
  // an archived qualifier doesn't inflate expected counts.
  const currentContestantIds = new Set(contestantRows.map((c) => c.id));
  const snapshotByGroupId = new Map<string, string[]>();
  for (const group of groupRows) {
    if (group.advanceCount === null) continue;
    const snapshot = (group.qualifiedContestantIds ?? []).filter((id) =>
      currentContestantIds.has(id),
    );
    if (snapshot.length > 0) snapshotByGroupId.set(group.id, snapshot);
  }
  function contestantCountForSet(groupId: string | null): number {
    const snapshot = groupId ? snapshotByGroupId.get(groupId) : undefined;
    return snapshot ? snapshot.length : contestantCount;
  }

  // Sets (rounds) summary.
  const setSummaries: SetSummary[] = roundRows.map((round) => {
    const setContestantCount = contestantCountForSet(round.roundGroupId);
    // Manual-entry sets are filled by the tabulator (one system judge), so
    // their expected count is criteria × contestants — independent of how many
    // real judges the event has.
    const expected = round.isManualEntry
      ? criteriaRows.filter((c) => c.roundId === round.id).length * setContestantCount
      : judgesForSet(round.id).length *
        requiredCriteriaForSet(round.id).length *
        setContestantCount;
    const submitted = submittedBySet.get(round.id) ?? 0;
    return {
      id: round.id,
      name: round.name,
      position: round.position,
      groupId: round.roundGroupId,
      status: round.status as Lifecycle,
      isActive: round.status === "active",
      carryOver: round.carryOverScores,
      isManualEntry: round.isManualEntry,
      expected,
      submitted,
      completionPct: pct(submitted, expected),
    };
  });
  const groups: GroupSummary[] = groupRows.map((group) => {
    const sets = setSummaries.filter((s) => s.groupId === group.id);
    return {
      id: group.id,
      name: group.name,
      position: group.position,
      status: group.status as Lifecycle,
      isActive: group.status === "active",
      carryOver: group.carryOverScores,
      carryOverWeight: group.carryOverWeight,
      advanceCount: group.advanceCount,
      advanceDisplayOrder: group.advanceDisplayOrder,
      scoringMethod: parseScoringMethod(group.scoringMethod),
      hasQualifierSnapshot: snapshotByGroupId.has(group.id),
      sets,
    };
  });
  const ungroupedSets = setSummaries.filter((s) => s.groupId === null);

  // Per-set totals matrix: each cell is the WEIGHTED AVERAGE among judges —
  // i.e. each judge's weighted total (sum over criteria of value*weight/100),
  // averaged across the judges who actually scored that contestant.
  const totalsBySet = new Map<string, Map<string, number>>();
  // setId -> contestantId -> judgeId -> weighted total (kept for rank-order).
  const perJudgeBySet = new Map<string, Map<string, Map<string, number>>>();
  for (const set of setSummaries) {
    // Only count scores from judges currently assigned to this set — a judge
    // reassigned away after scoring shouldn't keep pulling weight in totals or
    // rank-order, matching the "By judge & criteria" tab's own scoping.
    // Manual-entry sets are always written by the (non-real) system judge, so
    // assignment scoping doesn't apply to them.
    const eligibleJudgeIds = set.isManualEntry ? null : new Set(judgesForSet(set.id));

    // contestantId -> judgeId -> weighted total
    const perJudge = new Map<string, Map<string, number>>();
    for (const score of scoresBySet.get(set.id) ?? []) {
      if (eligibleJudgeIds && !eligibleJudgeIds.has(score.judgeId)) continue;
      const weighted = score.value * (weightForCriterion(score.criterionId, set.id) / 100);
      const byJudge = perJudge.get(score.contestantId) ?? new Map<string, number>();
      byJudge.set(score.judgeId, (byJudge.get(score.judgeId) ?? 0) + weighted);
      perJudge.set(score.contestantId, byJudge);
    }
    perJudgeBySet.set(set.id, perJudge);

    const averages = new Map<string, number>();
    for (const [contestantId, byJudge] of perJudge.entries()) {
      const totals = Array.from(byJudge.values());
      const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
      averages.set(contestantId, Math.round((average + Number.EPSILON) * 10_000) / 10_000);
    }
    totalsBySet.set(set.id, averages);
  }

  // The scores views show the ACTIVE ROUND only. Columns are that round's sets;
  // sets from any other (inactive/finished) round are hidden.
  const activeSets = setSummaries.filter((s) => s.isActive);
  const activeGroup = groups.find((g) => g.isActive) ?? null;

  // When the active round is advancement-restricted, every scoring view scopes
  // to the snapshotted qualifiers (in snapshot = rank order, best first).
  const activeQualifiedIds = activeGroup
    ? (snapshotByGroupId.get(activeGroup.id) ?? null)
    : null;
  const activeQualifiedSet = activeQualifiedIds ? new Set(activeQualifiedIds) : null;
  const scopedContestants = activeQualifiedSet
    ? contestantRows.filter((c) => activeQualifiedSet.has(c.id))
    : contestantRows;

  // Per-judge progress on the active set (at most one active set per event):
  // a contestant counts as "done" for a judge once that judge has submitted
  // every completion criterion for them. Completion criteria = the set's
  // required criteria, falling back to all of the set's criteria if none are
  // marked required. Drives the "8/10" column in the tabulator's judges table.
  const activeSet = activeSets[0] ?? null;
  const finalizedActiveSetJudgeIds = new Set(
    activeSet
      ? submissionRows.filter((r) => r.roundId === activeSet.id).map((r) => r.judgeId)
      : [],
  );
  const progressByJudge = new Map<string, number>();
  let activeSetJudgeIds: Set<string> | null = null;
  let completionCriteriaCount = 0;
  if (activeSet) {
    activeSetJudgeIds = new Set(judgesForSet(activeSet.id));
    const required = requiredCriteriaForSet(activeSet.id);
    const completionCriteriaIds = (
      required.length > 0
        ? required
        : criteriaRows.filter((c) => c.roundId === activeSet.id)
    ).map((c) => c.id);
    completionCriteriaCount = completionCriteriaIds.length;

    // judgeId -> contestantId -> set of submitted criterion ids
    const perJudgeContestant = new Map<string, Map<string, Set<string>>>();
    for (const score of scoresBySet.get(activeSet.id) ?? []) {
      let byContestant = perJudgeContestant.get(score.judgeId);
      if (!byContestant) {
        byContestant = new Map();
        perJudgeContestant.set(score.judgeId, byContestant);
      }
      let submitted = byContestant.get(score.contestantId);
      if (!submitted) {
        submitted = new Set();
        byContestant.set(score.contestantId, submitted);
      }
      submitted.add(score.criterionId);
    }

    // Only count progress for contestants that are actually in scope for this
    // set (the snapshotted qualifiers on an advancement round, else everyone).
    // Otherwise leftover scores for non-qualifiers push "done" past the total
    // and the column reads e.g. 33/30.
    const scopedIdSet = new Set(scopedContestants.map((c) => c.id));
    if (completionCriteriaCount > 0) {
      for (const [judgeId, byContestant] of perJudgeContestant) {
        let done = 0;
        for (const [contestantId, submitted] of byContestant) {
          if (!scopedIdSet.has(contestantId)) continue;
          if (completionCriteriaIds.every((id) => submitted.has(id))) done += 1;
        }
        progressByJudge.set(judgeId, done);
      }
    }
  }
  // Sets to display: the active round's sets, or a stray active ungrouped set.
  const displaySets = (
    activeGroup
      ? activeGroup.sets
      : setSummaries.filter((s) => s.isActive && s.groupId === null)
  )
    .slice()
    .sort((a, b) => a.position - b.position);

  // Carry-over (per-set, decided at finish-round time):
  // a finished set in an earlier finished round whose own `carryOver` flag is
  // true contributes its per-contestant total to the active round's
  // Carried-in column. Granularity is per-set so the tabulator can pick
  // exactly which sets to carry.
  const activePosition = activeGroup?.position ?? Number.MAX_SAFE_INTEGER;
  const carriedRounds = groups
    .filter((g) => g.status === "finished" && g.position < activePosition)
    .map((g) => ({ ...g, sets: g.sets.filter((s) => s.carryOver) }))
    .filter((g) => g.sets.length > 0)
    .sort((a, b) => a.position - b.position);
  const setColumns: SetColumn[] = displaySets.map((s) => ({
    id: s.id,
    name: s.name,
    groupId: s.groupId,
    groupName: activeGroup?.name ?? null,
    groupPosition: activeGroup?.position ?? Number.MAX_SAFE_INTEGER,
    carryOver: false,
  }));

  const unrankedTotals = scopedContestants.map((contestant) => {
    const cells: SetTotalsCell[] = displaySets.map((set) => {
      const total = totalsBySet.get(set.id)?.get(contestant.id);
      return { setId: set.id, total: total ?? null };
    });
    // Round score across the sets the contestant has been scored in — the mean
    // by default, or a straight SUM in points-based events. Sets with no
    // submitted scores yet ("—") are excluded so a contestant isn't penalized
    // while later sets are still pending.
    const scoredCells = cells
      .map((cell) => cell.total)
      .filter((value): value is number => value !== null);
    const scoredSum = scoredCells.reduce((sum, value) => sum + value, 0);
    const roundTotal =
      scoredCells.length === 0
        ? 0
        : roundScoreMode === "sum"
          ? scoredSum
          : scoredSum / scoredCells.length;
    // During an active round the table shows only this round's own sets.
    // Carry-over scores are shown only in the Final Rankings table (no active round).
    const roundTotalRounded = Math.round((roundTotal + Number.EPSILON) * 10_000) / 10_000;
    return {
      contestantId: contestant.id,
      displayNumber: contestant.displayNumber,
      displayName: contestant.displayName,
      photoUrl: contestant.photoUrl,
      cells,
      roundTotal: roundTotalRounded,
      carriedIn: 0,
      overall: roundTotalRounded,
    };
  });

  // Rank by overall (desc) with the event's configured tie-break. `cells` is in
  // set-position order; reverse it so the latest set is compared first (countback).
  const rankMap = rankWithTieBreak(
    unrankedTotals.map((row) => ({
      id: row.contestantId,
      primary: row.overall,
      setScoresByRecency: [...row.cells]
        .reverse()
        .map((c) => c.total ?? 0),
    })),
    tieBreak,
  );
  const setTotals: SetTotalsRow[] = unrankedTotals
    .map((row) => ({ ...row, rank: rankMap.get(row.contestantId) ?? 0 }))
    .sort((a, b) => a.rank - b.rank || b.overall - a.overall);

  // ── Final rankings (shown when there is no active round) ─────────────────────
  // Mirrors the carriedRounds formula: only sets whose carryOver flag was set
  // by the tabulator at finish-time contribute, and only from groups whose
  // carryOver flag is true. Weight is each group's carryOverWeight / 100.
  //
  // For groups/sets that are finished but have no carry-over flag (independent
  // rounds), they appear as display columns but don't contribute to the overall.
  const finishedGroups = groups
    .filter((g) => g.status === "finished")
    .sort((a, b) => a.position - b.position);

  // The cumulative standings show who advances (by accumulated score across the
  // point/carry-over rounds). A rank-order round decides its own result and its
  // score isn't comparable, so exclude rank-order rounds from this total — but
  // still show the accumulated standings of the rounds that precede it.
  const pendingAdvancementGroup = resolvePendingAdvancementGroup(groups);
  const activePointsAllSetsDone =
    activeGroup && isPointsRoundGroup(activeGroup) && allSetsFinished(activeGroup)
      ? activeGroup
      : null;
  const standingsGroups = [
    ...finishedGroups.filter((g) => isPointsRoundGroup(g)),
    ...(activePointsAllSetsDone &&
    pendingAdvancementGroup &&
    activePointsAllSetsDone.position < pendingAdvancementGroup.position &&
    !finishedGroups.some((g) => g.id === activePointsAllSetsDone.id)
      ? [activePointsAllSetsDone]
      : []),
  ].sort((a, b) => a.position - b.position);

  // Expose cumulative standings when between rounds, during a rank-order round,
  // or while the last points round before rank-order is fully scored (even if
  // the tabulator hasn't clicked "Finish round" yet).
  const activeIsRankOrder = activeGroup?.scoringMethod === "rank_order";
  const advancementPreview =
    pendingAdvancementGroup !== null &&
    standingsGroups.length > 0 &&
    (activeGroup === null || activeIsRankOrder || activePointsAllSetsDone !== null);
  let finalRankings: EventTabulatorDetail["finalRankings"] = null;
  if (advancementPreview || ((activeGroup === null || activeIsRankOrder) && standingsGroups.length > 0)) {
    // While previewing an advancement cut, a manually-broken tie is scoped to
    // the round it feeds (it decides who qualifies); once there's no more
    // advancement pending, ties in these standings are the event's final
    // result, scoped event-wide instead.
    const standingsOverrides =
      advancementPreview && pendingAdvancementGroup
        ? overrideMapFor(tieBreakRows, "advancement", pendingAdvancementGroup.id)
        : overrideMapFor(tieBreakRows, "standings", null);
    const standings = computeGroupStandings({
      groups: standingsGroups,
      totalsBySet,
      contestantIds: contestantRows.map((c) => c.id),
      roundScoreMode,
      tieBreak,
      manualOverrides: standingsOverrides,
    });

    const contestantById = new Map(contestantRows.map((c) => [c.id, c]));
    finalRankings = {
      columns: standingsGroups.map((g) => ({
        groupId: g.id,
        groupName: g.name,
        weight: standings.useCarryOver ? g.carryOverWeight : 0,
      })),
      rows: standings.rows.flatMap((row) => {
        const contestant = contestantById.get(row.contestantId);
        if (!contestant) return [];
        return [
          {
            rank: row.rank,
            contestantId: row.contestantId,
            displayNumber: contestant.displayNumber,
            displayName: contestant.displayName,
            photoUrl: contestant.photoUrl,
            roundScores: row.roundScores,
            overall: row.overall,
          },
        ];
      }),
    };
  }

  // ── Per-judge matrix for the focus set ──
  // The by-judge view focuses one set within the active round.
  const displaySetIds = new Set(displaySets.map((s) => s.id));
  const requestedInRound =
    params.focusSetId != null && displaySetIds.has(params.focusSetId);
  const focusSetId = requestedInRound
    ? params.focusSetId!
    : (displaySets.find((s) => s.isActive)?.id ?? displaySets[0]?.id ?? null);

  // Scope the by-judge matrix to the judges assigned to the focused set, so a
  // judge who doesn't judge this set isn't shown as an (always-empty) column.
  const focusJudgeIds = focusSetId ? new Set(judgesForSet(focusSetId)) : new Set<string>();
  const focusJudges = activeJudges.filter((judge) => focusJudgeIds.has(judge.id));
  const judgeColumns = focusJudges.map((judge) => ({
    id: judge.id,
    displayName: judge.displayName,
  }));
  let focusCriteria: FocusCriterion[] = [];
  let judgeMatrix: JudgeMatrixRow[] = [];

  if (focusSetId) {
    focusCriteria = criteriaRows
      .filter((c) => c.roundId === focusSetId)
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        weight: Number(c.weight ?? 100),
      }));

    // contestantId -> judgeId -> criterionId -> raw value
    const lookup = new Map<string, Map<string, Map<string, number>>>();
    for (const score of scoresBySet.get(focusSetId) ?? []) {
      const byJudge = lookup.get(score.contestantId) ?? new Map<string, Map<string, number>>();
      const byCriterion = byJudge.get(score.judgeId) ?? new Map<string, number>();
      byCriterion.set(score.criterionId, score.value);
      byJudge.set(score.judgeId, byCriterion);
      lookup.set(score.contestantId, byJudge);
    }

    judgeMatrix = scopedContestants.map((contestant) => {
      const scores: Record<string, Record<string, number | null>> = {};
      const contestantScores = lookup.get(contestant.id);
      for (const judge of focusJudges) {
        const byCriterion = contestantScores?.get(judge.id);
        const row: Record<string, number | null> = {};
        for (const criterion of focusCriteria) {
          const value = byCriterion?.get(criterion.id);
          row[criterion.id] = value === undefined ? null : value;
        }
        scores[judge.id] = row;
      }
      return {
        contestantId: contestant.id,
        displayNumber: contestant.displayNumber,
        displayName: contestant.displayName,
        scores,
      };
    });
  }

  // ── Manual-entry categories ──
  // Surface each manual set with its criteria and a per-contestant value grid.
  // Only the system judge writes these, so values can be read straight from the
  // set's score bucket without caring which judge id produced them.
  const manualRoundIds = new Set(
    roundRows.filter((r) => r.isManualEntry).map((r) => r.id),
  );
  const manualSets: ManualSet[] = setSummaries
    .filter((set) => manualRoundIds.has(set.id))
    .sort((a, b) => a.position - b.position)
    .map((set) => {
      const setCriteria: ManualSetCriterion[] = criteriaRows
        .filter((c) => c.roundId === set.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          minValue: c.minValue === null ? null : Number(c.minValue),
          maxValue: c.maxValue === null ? null : Number(c.maxValue),
        }));

      const valueLookup = new Map<string, Map<string, number>>();
      for (const score of scoresBySet.get(set.id) ?? []) {
        const byCriterion = valueLookup.get(score.contestantId) ?? new Map();
        byCriterion.set(score.criterionId, score.value);
        valueLookup.set(score.contestantId, byCriterion);
      }

      const rows: ManualSetRow[] = contestantRows.map((contestant) => {
        const byCriterion = valueLookup.get(contestant.id);
        const values: Record<string, number | null> = {};
        for (const criterion of setCriteria) {
          const value = byCriterion?.get(criterion.id);
          values[criterion.id] = value === undefined ? null : value;
        }
        return {
          contestantId: contestant.id,
          displayNumber: contestant.displayNumber,
          displayName: contestant.displayName,
          values,
        };
      });

      return {
        id: set.id,
        name: set.name,
        groupId: set.groupId,
        groupName: groups.find((g) => g.id === set.groupId)?.name ?? null,
        criteria: setCriteria,
        rows,
        submitted: set.submitted,
        expected: set.expected,
        completionPct: set.completionPct,
      };
    });

  // ── Rank-order standings ──
  // Shown for the active rank-order round while it runs, and for the most
  // recent finished rank-order round afterwards (the final result).
  const rankOrderGroup =
    activeGroup?.scoringMethod === "rank_order"
      ? activeGroup
      : activeGroup === null
        ? ([...groups]
            .filter((g) => g.status === "finished" && g.scoringMethod === "rank_order")
            .sort((a, b) => b.position - a.position)[0] ?? null)
        : null;

  let rankOrder: EventTabulatorDetail["rankOrder"] = null;
  if (rankOrderGroup) {
    const eligible = snapshotByGroupId.get(rankOrderGroup.id);
    const eligibleSet = eligible ? new Set(eligible) : null;

    // judgeId -> contestantId -> combined total across the group's sets,
    // combined the same way as round totals (sum or mean of scored sets).
    const sums = new Map<string, Map<string, number>>();
    const counts = new Map<string, Map<string, number>>();
    for (const set of rankOrderGroup.sets) {
      for (const [contestantId, byJudge] of (perJudgeBySet.get(set.id) ?? new Map())) {
        if (eligibleSet && !eligibleSet.has(contestantId)) continue;
        for (const [judgeId, total] of byJudge.entries()) {
          const judgeSums = sums.get(judgeId) ?? new Map<string, number>();
          const judgeCounts = counts.get(judgeId) ?? new Map<string, number>();
          judgeSums.set(contestantId, (judgeSums.get(contestantId) ?? 0) + total);
          judgeCounts.set(contestantId, (judgeCounts.get(contestantId) ?? 0) + 1);
          sums.set(judgeId, judgeSums);
          counts.set(judgeId, judgeCounts);
        }
      }
    }
    const perJudgeTotals = new Map<string, Map<string, number>>();
    for (const [judgeId, judgeSums] of sums.entries()) {
      const totals = new Map<string, number>();
      for (const [contestantId, sum] of judgeSums.entries()) {
        const count = counts.get(judgeId)?.get(contestantId) ?? 1;
        totals.set(contestantId, roundScoreMode === "sum" ? sum : sum / count);
      }
      perJudgeTotals.set(judgeId, totals);
    }

    if (perJudgeTotals.size > 0) {
      const contestantById = new Map(contestantRows.map((c) => [c.id, c]));
      const rankOrderOverrides = overrideMapFor(tieBreakRows, "rank_order", rankOrderGroup.id);
      const rawResults = computeRankOrder(perJudgeTotals);
      const placementMap = applyManualOverrides(
        new Map(rawResults.map((r) => [r.contestantId, r.placement])),
        rankOrderOverrides,
      );
      const results = rawResults.map((r) => ({
        ...r,
        placement: placementMap.get(r.contestantId) ?? r.placement,
      }));
      rankOrder = {
        groupId: rankOrderGroup.id,
        groupName: rankOrderGroup.name,
        judges: activeJudges
          .filter((j) => perJudgeTotals.has(j.id))
          .map((j) => ({ id: j.id, displayName: j.displayName })),
        rows: results
          .flatMap((result) => {
            const contestant = contestantById.get(result.contestantId);
            if (!contestant) return [];
            return [
              {
                contestantId: result.contestantId,
                displayNumber: contestant.displayNumber,
                displayName: contestant.displayName,
                photoUrl: contestant.photoUrl,
                ranksByJudge: result.ranksByJudge,
                scoresByJudge: result.scoresByJudge,
                rankSum: result.rankSum,
                placement: result.placement,
              },
            ];
          })
          .sort((a, b) => a.placement - b.placement || a.rankSum - b.rankSum),
      };
    }
  }

  // ── Widgets ──
  const submittedTotal = setSummaries.reduce((sum, s) => sum + s.submitted, 0);
  const expectedTotal = setSummaries.reduce((sum, s) => sum + s.expected, 0);
  return {
    event,
    widgets: {
      progressPct: pct(submittedTotal, expectedTotal),
      submitted: submittedTotal,
      expected: expectedTotal,
      activeSets: activeSets.length,
      totalSets: setSummaries.length,
      contestants: contestantCount,
      activeJudges: activeJudges.length,
      conflicts: conflictRows.length,
    },
    groups,
    ungroupedSets,
    manualSets,
    activeRound: activeGroup
      ? { id: activeGroup.id, name: activeGroup.name, carryOver: activeGroup.carryOver }
      : null,
    advancement:
      activeGroup && activeGroup.advanceCount !== null && activeQualifiedIds
        ? buildAdvancement({
            group: activeGroup,
            qualifiedSnapshot: activeQualifiedIds,
            finalRankings,
          })
        : pendingAdvancementGroup && finalRankings
          ? buildAdvancement({
              group: pendingAdvancementGroup,
              qualifiedSnapshot:
                snapshotByGroupId.get(pendingAdvancementGroup.id) ?? null,
              finalRankings,
            })
          : null,
    advancementPreview,
    rankOrder,
    roundScoreMode,
    tieBreak,
    carriedFromRounds: [],
    judges: realJudgeRows.map((judge) => ({
      id: judge.id,
      displayName: judge.displayName,
      isActive: judge.isActive,
      submitted: submittedByJudge.get(judge.id) ?? 0,
      signedIn: signedInJudgeIds.has(judge.id),
      activeSetProgress:
        activeSet && completionCriteriaCount > 0 && activeSetJudgeIds?.has(judge.id)
          ? {
              setId: activeSet.id,
              setName: activeSet.name,
              done: progressByJudge.get(judge.id) ?? 0,
              total: scopedContestants.length,
            }
          : null,
      finalizedActiveSet: finalizedActiveSetJudgeIds.has(judge.id),
    })),
    setColumns,
    setTotals,
    focusSetId,
    focusCriteria,
    judgeColumns,
    judgeMatrix,
    finalRankings,
    tieBreaks: tieBreakRows.map((row) => ({
      id: row.id,
      scope: row.scope,
      contextId: row.contextId,
      tiedContestantIds: row.tiedContestantIds,
      resolvedOrder: row.resolvedOrder,
      method: row.method,
      note: row.note,
      resolvedByName: row.resolvedByName,
    })),
    openTieBreakVotes: openVoteRows.map((vote) => ({
      id: vote.id,
      scope: vote.scope,
      contextId: vote.contextId,
      tiedContestantIds: vote.tiedContestantIds,
      eligibleJudges: vote.eligibleJudgeIds.flatMap((judgeId) => {
        const judge = judgeRows.find((j) => j.id === judgeId);
        return judge ? [{ id: judge.id, displayName: judge.displayName }] : [];
      }),
      votedJudgeIds: vote.votedJudgeIds,
    })),
  };
}

// ── Aggregate result recalculation (server-authoritative) ────────────────────

export async function recalculateAggregateResults(params: {
  database: typeof db;
  eventId: string;
}): Promise<number> {
  const { database, eventId } = params;

  return database.transaction(async (tx) => {
    const [roundRows, criteriaRows, ruleRows, scoreRows] = await Promise.all([
      tx.select({ id: rounds.id }).from(rounds).where(eq(rounds.eventId, eventId)),
      tx
        .select({
          id: criteria.id,
          name: criteria.name,
          roundId: criteria.roundId,
          weight: criteria.weight,
          minValue: criteria.minValue,
          maxValue: criteria.maxValue,
          isRequired: criteria.isRequired,
        })
        .from(criteria)
        .where(eq(criteria.eventId, eventId)),
      tx
        .select({ roundId: scoringRules.roundId, aggregation: scoringRules.aggregation })
        .from(scoringRules)
        .where(eq(scoringRules.eventId, eventId)),
      tx
        .select({
          roundId: scoreRecords.roundId,
          contestantId: scoreRecords.contestantId,
          judgeId: scoreRecords.judgeId,
          criterionId: scoreRecords.criterionId,
          value: scoreRecords.value,
        })
        .from(scoreRecords)
        .where(
          and(eq(scoreRecords.eventId, eventId), eq(scoreRecords.status, "submitted")),
        ),
    ]);

    await tx.delete(aggregateResults).where(eq(aggregateResults.eventId, eventId));

    let written = 0;
    for (const round of roundRows) {
      const aggregationRule = toAggregationRule(
        ruleRows.find((rule) => rule.roundId === round.id)?.aggregation ??
          ruleRows.find((rule) => rule.roundId === null)?.aggregation,
      );
      const criteriaConfigs: CriterionConfig[] = criteriaRows
        .filter((criterion) => criterion.roundId === round.id)
        .map((criterion) => ({
          id: criterion.id,
          name: criterion.name,
          weight: Number(criterion.weight ?? 1),
          minValue: criterion.minValue === null ? undefined : Number(criterion.minValue),
          maxValue: criterion.maxValue === null ? undefined : Number(criterion.maxValue),
          isRequired: criterion.isRequired,
        }));

      const scores: SubmittedScore[] = scoreRows
        .filter((row) => row.roundId === round.id && row.value !== null)
        .map((row) => ({
          contestantId: row.contestantId,
          judgeId: row.judgeId,
          criterionId: row.criterionId,
          value: Number(row.value),
        }));

      if (scores.length === 0) continue;

      const results = calculateContestantResults({
        criteria: criteriaConfigs,
        scores,
        aggregationRule,
      });

      for (const result of results) {
        await tx.insert(aggregateResults).values({
          eventId,
          roundId: round.id,
          contestantId: result.contestantId,
          total: String(result.total),
          rank: result.rank,
          breakdown: { items: result.breakdown, aggregationRule },
        });
        written += 1;
      }
    }

    return written;
  });
}
