import { createHash } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/db";
import {
  contestants,
  criteria,
  events,
  judgeAssignments,
  judges,
  roundGroups,
  rounds,
  scoreRecords,
} from "@/db/schema";
import {
  computeRankOrder,
  parseRoundScoreMode,
  parseTieBreak,
  rankWithTieBreak,
  type RoundScoreMode,
} from "@/lib/scoring/ranking";
import type { SubmittedScore } from "@/lib/scoring/types";

type Lifecycle = "idle" | "active" | "finished";

export interface RankedRow {
  rank: number;
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  /** Score in this context (set total, round average, or event average). */
  value: number;
  /** How many sets contributed to `value` — relevant for round/event rows. */
  scoredCount: number;
  /**
   * Per-judge breakdown behind `value` (judgeId -> this judge's total in the
   * same context; combined across sets the same way `value` is). Powers the
   * optional "show individual judge scores" detail view. Absent judges did not
   * score this contestant here.
   */
  scoresByJudge: Record<string, number>;
}

export interface SetReport {
  id: string;
  name: string;
  position: number;
  status: Lifecycle;
  carryOver: boolean;
  ranking: RankedRow[];
  /** Judges assigned to (i.e. responsible for) this set. */
  judges: JudgeReport[];
}

export interface RankOrderReportRow {
  placement: number;
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  /** judgeId -> rank that judge's totals give this contestant (1 = best). */
  ranksByJudge: Record<string, number>;
  /** judgeId -> the score behind that judge's rank (null = not scored). */
  scoresByJudge: Record<string, number | null>;
  rankSum: number;
}

export interface RoundReport {
  id: string;
  name: string;
  position: number;
  status: Lifecycle;
  sets: SetReport[];
  /** Per-contestant ranking by their scored set totals in this round
   *  (mean, or sum in points-based events). */
  ranking: RankedRow[];
  /**
   * True when this round is scored by the rank-order method. Such a round's
   * result is the `rankOrder` table below; its averaged `ranking` and per-set
   * tables are not meaningful and are omitted from the printed report.
   */
  isRankOrder: boolean;
  /**
   * Rank-order result for rounds configured with scoringMethod "rank_order":
   * each judge's totals become ranks, summed across judges, LOWEST wins.
   */
  rankOrder: {
    judges: JudgeReport[];
    rows: RankOrderReportRow[];
  } | null;
  /** Judges assigned to this round (union across its sets) — for signatures. */
  judges: JudgeReport[];
}

export interface JudgeReport {
  id: string;
  displayName: string;
}

export interface ResultsReport {
  event: { id: string; name: string; status: string; logoUrl: string | null };
  contestants: number;
  generatedAt: string;
  rounds: RoundReport[];
  /** Sets in no round_group. */
  ungroupedSets: SetReport[];
  /** Cumulative ranking across the point/carry-over rounds (rank-order rounds
   *  are excluded — they decide their own result). This is the "who advances"
   *  standings before any rank-order final. */
  overall: RankedRow[];
  /**
   * Advancement cutoff applied to the cumulative `overall` standings: a later
   * round is configured to admit only the top N contestants. Drives the
   * "advances to the final" indicator on the printed overall ranking. Null when
   * no round limits its field.
   */
  advancement: {
    /** How many contestants advance (the round's `advanceCount`). */
    count: number;
    /** Name of the round they advance into. */
    roundName: string;
    /**
     * The contestant ids that advance, best-first. Prefers the round's
     * activation-time qualifier snapshot; otherwise the top `count` of the
     * current cumulative standings.
     */
    contestantIds: string[];
  } | null;
  /** How set totals combine into round/overall totals. */
  roundScoreMode: RoundScoreMode;
  /**
   * Deterministic checksum of the standings (overall + per-round rankings +
   * rank-order results). Printed on the report; re-running the report against
   * unchanged scores produces the same code, so an altered paper copy can be
   * checked against the system.
   */
  verificationCode: string;
  /** Active judges — used to render signature lines on the printed report. */
  judges: JudgeReport[];
}

/** Dense competition rank — ties share a rank. */
function rankDesc<T>(rows: T[], valueOf: (row: T) => number): { row: T; rank: number; value: number }[] {
  const sorted = [...rows]
    .map((row) => ({ row, value: valueOf(row) }))
    .sort((a, b) => b.value - a.value);
  let prevValue: number | null = null;
  let prevRank = 0;
  return sorted.map((entry, index) => {
    const rank = prevValue === entry.value ? prevRank : index + 1;
    prevValue = entry.value;
    prevRank = rank;
    return { row: entry.row, rank, value: entry.value };
  });
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Computes a printable results report for an event:
 *
 * - Per-set rankings (each set's contestants ranked by their per-set total).
 * - Per-round rankings (avg of each contestant's scored set totals in that round).
 * - Event-wide overall ranking (avg of each contestant's scored set totals
 *   across the entire event).
 *
 * Reads scores fresh from `score_records` so it reflects the latest state.
 * Per-set totals match the tabulator's main view: weighted per-judge totals
 * averaged across the judges who scored that contestant.
 */
export async function getEventResultsReport(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}): Promise<ResultsReport> {
  const { database, organizationId, eventId } = params;

  const [eventRow] = await database
    .select({
      id: events.id,
      name: events.name,
      status: events.status,
      logoUrl: events.logoUrl,
      config: events.config,
    })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);
  if (!eventRow) throw new Error("Event not found.");

  const tieBreak = parseTieBreak(
    (eventRow.config as Record<string, unknown> | null)?.tieBreak,
  );
  const roundScoreMode = parseRoundScoreMode(
    (eventRow.config as Record<string, unknown> | null)?.roundScoreMode,
  );

  const [groupRows, roundRows, contestantRows, criteriaRows, judgeRows, assignmentRows] =
    await Promise.all([
      database
        .select({
          id: roundGroups.id,
          name: roundGroups.name,
          position: roundGroups.position,
          status: roundGroups.status,
          carryOverScores: roundGroups.carryOverScores,
          carryOverWeight: roundGroups.carryOverWeight,
          scoringMethod: roundGroups.scoringMethod,
          advanceCount: roundGroups.advanceCount,
          qualifiedContestantIds: roundGroups.qualifiedContestantIds,
        })
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
          displayName: contestants.displayName,
          displayNumber: contestants.displayNumber,
        })
        .from(contestants)
        .where(eq(contestants.eventId, eventId))
        .orderBy(asc(contestants.displayName)),
      database
        .select({
          id: criteria.id,
          roundId: criteria.roundId,
          weight: criteria.weight,
          isRequired: criteria.isRequired,
        })
        .from(criteria)
        .where(eq(criteria.eventId, eventId)),
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
    ]);

  const activeJudgeIds = judgeRows.filter((j) => j.isActive && !j.isSystem).map((j) => j.id);
  const systemJudge = judgeRows.find((j) => j.isSystem) ?? null;

  function judgesForSet(setId: string): string[] {
    const setRow = roundRows.find((r) => r.id === setId);
    if (setRow?.isManualEntry && systemJudge) return [systemJudge.id];
    // Assignment scopes: a specific set, a whole round (roundGroupId), or
    // event-wide (both null).
    const groupId = setRow?.roundGroupId ?? null;
    const ids = new Set<string>();
    for (const a of assignmentRows) {
      const eventWide = a.roundId === null && a.roundGroupId === null;
      const matchesRound = a.roundGroupId !== null && a.roundGroupId === groupId;
      if (eventWide || a.roundId === setId || matchesRound) ids.add(a.judgeId);
    }
    if (ids.size === 0) return activeJudgeIds;
    return Array.from(ids).filter((id) => activeJudgeIds.includes(id));
  }

  function weightFor(criterionId: string, setId: string): number {
    const c = criteriaRows.find((x) => x.id === criterionId && x.roundId === setId);
    return Number(c?.weight ?? 100);
  }

  // Submitted scores (one pass, group in JS — same shape the tabulator uses).
  const scoreRows = await database
    .select({
      roundId: scoreRecords.roundId,
      contestantId: scoreRecords.contestantId,
      judgeId: scoreRecords.judgeId,
      criterionId: scoreRecords.criterionId,
      value: scoreRecords.value,
    })
    .from(scoreRecords)
    .where(and(eq(scoreRecords.eventId, eventId), eq(scoreRecords.status, "submitted")));

  const scoresBySet = new Map<string, SubmittedScore[]>();
  for (const row of scoreRows) {
    if (row.value === null) continue;
    const bucket = scoresBySet.get(row.roundId) ?? [];
    bucket.push({
      contestantId: row.contestantId,
      judgeId: row.judgeId,
      criterionId: row.criterionId,
      value: Number(row.value),
    });
    scoresBySet.set(row.roundId, bucket);
  }

  // Per-set totals: contestant -> weighted-avg-across-scoring-judges.
  const totalsBySet = new Map<string, Map<string, number>>();
  // Per-set, per-contestant, per-judge weighted totals — the breakdown behind
  // each averaged set total, kept for the "individual judge scores" view.
  const judgeTotalsBySet = new Map<string, Map<string, Map<string, number>>>();
  for (const round of roundRows) {
    const judgesForThis = new Set(judgesForSet(round.id));
    const perJudge = new Map<string, Map<string, number>>();
    for (const score of scoresBySet.get(round.id) ?? []) {
      if (!judgesForThis.has(score.judgeId)) continue;
      const weighted = score.value * (weightFor(score.criterionId, round.id) / 100);
      const byJudge = perJudge.get(score.contestantId) ?? new Map<string, number>();
      byJudge.set(score.judgeId, (byJudge.get(score.judgeId) ?? 0) + weighted);
      perJudge.set(score.contestantId, byJudge);
    }
    const avgs = new Map<string, number>();
    for (const [contestantId, byJudge] of perJudge.entries()) {
      for (const [judgeId, total] of byJudge.entries()) {
        byJudge.set(judgeId, round4(total));
      }
      const totals = Array.from(byJudge.values());
      const avg = totals.reduce((s, v) => s + v, 0) / totals.length;
      avgs.set(contestantId, round4(avg));
    }
    totalsBySet.set(round.id, avgs);
    judgeTotalsBySet.set(round.id, perJudge);
  }

  /**
   * Combines a contestant's per-judge set totals across `setIds` the same way
   * the aggregate value combines set averages: summed in points mode, meaned
   * otherwise (per judge, over the sets that judge actually scored).
   */
  function judgeTotalsAcrossSets(
    setIds: string[],
    contestantId: string,
  ): Record<string, number> {
    const acc = new Map<string, { sum: number; count: number }>();
    for (const setId of setIds) {
      const byJudge = judgeTotalsBySet.get(setId)?.get(contestantId);
      if (!byJudge) continue;
      for (const [judgeId, total] of byJudge.entries()) {
        const cur = acc.get(judgeId) ?? { sum: 0, count: 0 };
        cur.sum += total;
        cur.count += 1;
        acc.set(judgeId, cur);
      }
    }
    const out: Record<string, number> = {};
    for (const [judgeId, { sum, count }] of acc.entries()) {
      out[judgeId] = round4(roundScoreMode === "sum" ? sum : sum / count);
    }
    return out;
  }

  // ── Build per-set rankings ────────────────────────────────────────────────
  function rankSet(setId: string): RankedRow[] {
    const totals = totalsBySet.get(setId) ?? new Map<string, number>();
    const entries = contestantRows
      .map((c) => ({ c, value: totals.get(c.id) }))
      .filter((e): e is { c: (typeof contestantRows)[number]; value: number } => e.value !== undefined);

    return rankDesc(entries, (e) => e.value).map((r) => ({
      rank: r.rank,
      contestantId: r.row.c.id,
      displayNumber: r.row.c.displayNumber,
      displayName: r.row.c.displayName,
      value: r.value,
      scoredCount: 1,
      scoresByJudge: judgeTotalsAcrossSets([setId], r.row.c.id),
    }));
  }

  function rankAcrossSets(setIds: string[]): RankedRow[] {
    if (setIds.length === 0) return [];
    const rows = contestantRows.map((c) => {
      let sum = 0;
      let scoredCount = 0;
      // Set scores ordered last set → first (for countback tie-break).
      const setScoresByRecency: number[] = [];
      for (const id of setIds) {
        const v = totalsBySet.get(id)?.get(c.id);
        if (v !== undefined) {
          sum += v;
          scoredCount += 1;
        }
        setScoresByRecency.unshift(v ?? 0);
      }
      const value =
        scoredCount === 0
          ? 0
          : round4(roundScoreMode === "sum" ? sum : sum / scoredCount);
      return { c, value, scoredCount, setScoresByRecency };
    });
    const scored = rows.filter((r) => r.scoredCount > 0);
    const rankMap = rankWithTieBreak(
      scored.map((r) => ({
        id: r.c.id,
        primary: r.value,
        setScoresByRecency: r.setScoresByRecency,
      })),
      tieBreak,
    );
    return scored
      .map((r) => ({
        rank: rankMap.get(r.c.id) ?? 0,
        contestantId: r.c.id,
        displayNumber: r.c.displayNumber,
        displayName: r.c.displayName,
        value: r.value,
        scoredCount: r.scoredCount,
        scoresByJudge: judgeTotalsAcrossSets(setIds, r.c.id),
      }))
      .sort((a, b) => a.rank - b.rank || b.value - a.value);
  }

  /**
   * Overall ranking across all rounds, applying each round group's
   * `carryOverWeight` to its per-set average. Mirrors the tabulator formula so
   * printed rankings match the live console.
   */
  function rankAcrossRoundsWeighted(
    groups: { id: string; setIds: string[]; weight: number }[],
  ): RankedRow[] {
    if (groups.length === 0) return [];
    const rows = contestantRows.map((c) => {
      let total = 0;
      let scoredCount = 0;
      const setScoresByRecency: number[] = [];
      for (const group of groups) {
        const scored = group.setIds.filter((id) => totalsBySet.get(id)?.has(c.id));
        if (scored.length > 0) {
          const sum = scored.reduce(
            (s, id) => s + (totalsBySet.get(id)?.get(c.id) ?? 0),
            0,
          );
          const roundScore = roundScoreMode === "sum" ? sum : sum / scored.length;
          total += roundScore * (group.weight / 100);
          scoredCount += 1;
        }
        // For countback: push set scores (last set first within each group)
        for (const id of [...group.setIds].reverse()) {
          setScoresByRecency.push(totalsBySet.get(id)?.get(c.id) ?? 0);
        }
      }
      return { c, value: round4(total), scoredCount, setScoresByRecency };
    });
    const scored = rows.filter((r) => r.scoredCount > 0);
    const rankMap = rankWithTieBreak(
      scored.map((r) => ({
        id: r.c.id,
        primary: r.value,
        setScoresByRecency: r.setScoresByRecency,
      })),
      tieBreak,
    );
    return scored
      .map((r) => ({
        rank: rankMap.get(r.c.id) ?? 0,
        contestantId: r.c.id,
        displayNumber: r.c.displayNumber,
        displayName: r.c.displayName,
        value: r.value,
        scoredCount: r.scoredCount,
        // Each judge's cumulative = their round total per group, weighted the
        // same way the overall value is.
        scoresByJudge: judgeTotalsAcrossGroupsWeighted(groups, r.c.id),
      }))
      .sort((a, b) => a.rank - b.rank || b.value - a.value);
  }

  /** Per-judge weighted cumulative across carry-over groups (mirrors value). */
  function judgeTotalsAcrossGroupsWeighted(
    groups: { id: string; setIds: string[]; weight: number }[],
    contestantId: string,
  ): Record<string, number> {
    const acc = new Map<string, number>();
    for (const group of groups) {
      const perJudgeRound = judgeTotalsAcrossSets(group.setIds, contestantId);
      for (const [judgeId, roundScore] of Object.entries(perJudgeRound)) {
        acc.set(judgeId, (acc.get(judgeId) ?? 0) + roundScore * (group.weight / 100));
      }
    }
    const out: Record<string, number> = {};
    for (const [judgeId, total] of acc.entries()) out[judgeId] = round4(total);
    return out;
  }

  // ── Assemble rounds + ungrouped sets ──────────────────────────────────────
  const setByGroup = new Map<string | null, typeof roundRows>();
  for (const r of roundRows) {
    const key = r.roundGroupId ?? null;
    const bucket = setByGroup.get(key) ?? [];
    bucket.push(r);
    setByGroup.set(key, bucket);
  }

  // Map a set of judge ids to sorted JudgeReports (active, non-system).
  function judgeReportsFor(ids: Iterable<string>): JudgeReport[] {
    const idSet = new Set(ids);
    return judgeRows
      .filter((j) => idSet.has(j.id) && j.isActive && !j.isSystem)
      .map((j) => ({ id: j.id, displayName: j.displayName }));
  }

  function buildSetReport(round: (typeof roundRows)[number]): SetReport {
    return {
      id: round.id,
      name: round.name,
      position: round.position,
      status: round.status as Lifecycle,
      carryOver: round.carryOverScores,
      ranking: rankSet(round.id),
      judges: judgeReportsFor(judgesForSet(round.id)),
    };
  }

  /**
   * Rank-order result for a round group: per judge, combine the group's set
   * totals (sum or mean, matching the round-score mode), convert to ranks, sum
   * across judges — LOWEST rank-sum wins, judges'-majority tie-break. Scoped to
   * the round's qualifier snapshot when advancement is configured.
   */
  function buildRankOrder(group: (typeof groupRows)[number]): RoundReport["rankOrder"] {
    if (group.scoringMethod !== "rank_order") return null;
    const groupSets = (setByGroup.get(group.id) ?? []).map((r) => r.id);
    const eligible =
      group.advanceCount !== null && (group.qualifiedContestantIds?.length ?? 0) > 0
        ? new Set(group.qualifiedContestantIds!)
        : null;

    // judgeId -> contestantId -> combined total across the group's sets.
    const sums = new Map<string, Map<string, number>>();
    const counts = new Map<string, Map<string, number>>();
    for (const setId of groupSets) {
      const judgesForThis = new Set(judgesForSet(setId));
      // contestantId+judgeId -> per-set weighted total.
      const perSet = new Map<string, number>();
      for (const score of scoresBySet.get(setId) ?? []) {
        if (!judgesForThis.has(score.judgeId)) continue;
        if (eligible && !eligible.has(score.contestantId)) continue;
        const key = `${score.judgeId}::${score.contestantId}`;
        const weighted = score.value * (weightFor(score.criterionId, setId) / 100);
        perSet.set(key, (perSet.get(key) ?? 0) + weighted);
      }
      for (const [key, total] of perSet.entries()) {
        const [judgeId, contestantId] = key.split("::");
        const judgeSums = sums.get(judgeId) ?? new Map<string, number>();
        const judgeCounts = counts.get(judgeId) ?? new Map<string, number>();
        judgeSums.set(contestantId, (judgeSums.get(contestantId) ?? 0) + total);
        judgeCounts.set(contestantId, (judgeCounts.get(contestantId) ?? 0) + 1);
        sums.set(judgeId, judgeSums);
        counts.set(judgeId, judgeCounts);
      }
    }
    if (sums.size === 0) return { judges: [], rows: [] };

    const perJudgeTotals = new Map<string, Map<string, number>>();
    for (const [judgeId, judgeSums] of sums.entries()) {
      const totals = new Map<string, number>();
      for (const [contestantId, sum] of judgeSums.entries()) {
        const count = counts.get(judgeId)?.get(contestantId) ?? 1;
        totals.set(contestantId, roundScoreMode === "sum" ? sum : sum / count);
      }
      perJudgeTotals.set(judgeId, totals);
    }

    const contestantById = new Map(contestantRows.map((c) => [c.id, c]));
    const rows: RankOrderReportRow[] = computeRankOrder(perJudgeTotals)
      .flatMap((result) => {
        const contestant = contestantById.get(result.contestantId);
        if (!contestant) return [];
        return [
          {
            placement: result.placement,
            contestantId: result.contestantId,
            displayNumber: contestant.displayNumber,
            displayName: contestant.displayName,
            ranksByJudge: result.ranksByJudge,
            scoresByJudge: result.scoresByJudge,
            rankSum: result.rankSum,
          },
        ];
      })
      .sort((a, b) => a.placement - b.placement || a.rankSum - b.rankSum);

    return {
      judges: judgeRows
        .filter((j) => perJudgeTotals.has(j.id))
        .map((j) => ({ id: j.id, displayName: j.displayName })),
      rows,
    };
  }

  const rounds_: RoundReport[] = groupRows.map((g) => {
    const sets = (setByGroup.get(g.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(buildSetReport);
    return {
      id: g.id,
      name: g.name,
      position: g.position,
      status: g.status as Lifecycle,
      sets,
      ranking: rankAcrossSets(sets.map((s) => s.id)),
      isRankOrder: g.scoringMethod === "rank_order",
      rankOrder: buildRankOrder(g),
      judges: judgeReportsFor(sets.flatMap((s) => s.judges.map((j) => j.id))),
    };
  });

  const ungroupedSets: SetReport[] = (setByGroup.get(null) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(buildSetReport);

  // The cumulative "overall" shows who advances by accumulated score. A
  // rank-order round decides its own result with non-comparable scores, so
  // exclude rank-order groups from the cumulative — the standings then reflect
  // exactly the point/carry-over rounds that precede the rank-order final.
  const rankOrderGroupIds = new Set(
    groupRows.filter((g) => g.scoringMethod === "rank_order").map((g) => g.id),
  );

  // Build group → set mapping for the weighted overall ranking.
  // Only groups with carryOverScores=true contribute, and only their
  // carry-over-selected sets (rounds.carryOverScores=true as stamped by the
  // finish-round dialog).
  const carryOverGroupInput = groupRows
    .filter((g) => g.carryOverScores && !rankOrderGroupIds.has(g.id))
    .map((g) => ({
      id: g.id,
      setIds: (setByGroup.get(g.id) ?? [])
        .filter((r) => r.carryOverScores)
        .sort((a, b) => a.position - b.position)
        .map((r) => r.id),
      weight: g.carryOverWeight,
    }))
    .filter((g) => g.setIds.length > 0);

  // Fall back to simple average across all sets when no carry-over is configured
  // (still excluding any rank-order round's sets).
  const overall =
    carryOverGroupInput.length > 0
      ? rankAcrossRoundsWeighted(carryOverGroupInput)
      : rankAcrossSets(
          roundRows
            .filter((r) => r.roundGroupId === null || !rankOrderGroupIds.has(r.roundGroupId))
            .map((r) => r.id),
        );

  // Advancement cutoff: a later round configured to admit only its top N
  // contestants. Its qualifier snapshot (or, lacking one, the top N of the
  // cumulative standings) marks who advances on the printed overall ranking.
  // When several rounds cap their field, the last (by run order) is the final.
  const advancingGroup = groupRows
    .filter((g) => g.advanceCount !== null && g.advanceCount > 0)
    .sort((a, b) => b.position - a.position)[0];
  const advancement = advancingGroup
    ? {
        count: advancingGroup.advanceCount!,
        roundName: advancingGroup.name,
        contestantIds:
          advancingGroup.qualifiedContestantIds &&
          advancingGroup.qualifiedContestantIds.length > 0
            ? advancingGroup.qualifiedContestantIds.slice(0, advancingGroup.advanceCount!)
            : overall.slice(0, advancingGroup.advanceCount!).map((r) => r.contestantId),
      }
    : null;

  // Checksum over everything that constitutes "the result" — rankings and
  // rank-order placements — but NOT the generation timestamp, so re-running
  // the report against unchanged scores yields the same code.
  const verificationCode = createHash("sha256")
    .update(
      JSON.stringify([
        eventRow.id,
        overall.map((r) => [r.contestantId, r.rank, r.value]),
        rounds_.map((round) => [
          round.id,
          round.ranking.map((r) => [r.contestantId, r.rank, r.value]),
          round.sets.map((set) => [
            set.id,
            set.ranking.map((r) => [r.contestantId, r.rank, r.value]),
          ]),
          round.rankOrder?.rows.map((r) => [r.contestantId, r.placement, r.rankSum]) ??
            null,
        ]),
      ]),
    )
    .digest("hex")
    .slice(0, 12)
    .toUpperCase()
    .replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3");

  return {
    event: {
      id: eventRow.id,
      name: eventRow.name,
      status: eventRow.status,
      logoUrl: eventRow.logoUrl,
    },
    contestants: contestantRows.length,
    generatedAt: new Date().toISOString(),
    rounds: rounds_,
    ungroupedSets,
    overall,
    advancement,
    roundScoreMode,
    verificationCode,
    judges: judgeRows
      .filter((j) => j.isActive)
      .map((j) => ({ id: j.id, displayName: j.displayName })),
  };
}
