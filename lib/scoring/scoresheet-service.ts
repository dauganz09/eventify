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

// ── Shapes ─────────────────────────────────────────────────────────────────

export interface JudgeScoreCell {
  judgeId: string;
  judgeName: string;
  /** Raw score as submitted. */
  raw: number | null;
  /** raw × (weight / 100) */
  weighted: number | null;
}

export interface ContestantCriterionRow {
  contestantId: string;
  contestantName: string;
  contestantNumber: string | null;
  cells: JudgeScoreCell[];
  /** Mean of raw scores across judges that scored this contestant. */
  rawMean: number | null;
  /** Mean of weighted scores across judges that scored this contestant. */
  weightedMean: number | null;
}

export interface CriterionBlock {
  criterionId: string;
  criterionName: string;
  /** Weight as a percentage (0–100). */
  weight: number;
  rows: ContestantCriterionRow[];
}

export interface ContestantSetSummary {
  contestantId: string;
  contestantName: string;
  contestantNumber: string | null;
  /** Per-criterion weighted means keyed by criterionId */
  bycriterion: Record<string, number | null>;
  /** Sum of weighted means across all criteria. */
  total: number;
  rank: number;
}

export interface SetScoresheet {
  setId: string;
  setName: string;
  /** Judges that have submitted scores for at least one contestant in this set. */
  judges: { id: string; name: string }[];
  criteria: CriterionBlock[];
  summary: ContestantSetSummary[];
}

export interface RoundScoresheet {
  roundId: string;
  roundName: string;
  sets: SetScoresheet[];
}

export interface DetailedScoreReport {
  event: { id: string; name: string; logoUrl: string | null };
  generatedAt: string;
  /** All active judges for signature block. */
  allJudges: { id: string; name: string }[];
  rounds: RoundScoresheet[];
  ungroupedSets: SetScoresheet[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length + Number.EPSILON) * 100) / 100;
}

function rankDesc(
  items: { contestantId: string; total: number }[],
): Map<string, number> {
  const sorted = [...items].sort((a, b) => b.total - a.total);
  const map = new Map<string, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].total < sorted[i - 1].total) rank = i + 1;
    map.set(sorted[i].contestantId, rank);
  }
  return map;
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function getDetailedScoreReport(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}): Promise<DetailedScoreReport> {
  const { database, organizationId, eventId } = params;

  const [eventRow] = await database
    .select({ id: events.id, name: events.name, logoUrl: events.logoUrl })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);
  if (!eventRow) throw new Error("Event not found.");

  const [groupRows, roundRows, contestantRows, criteriaRows, judgeRows, assignmentRows, scoreRows] =
    await Promise.all([
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
          displayName: contestants.displayName,
          displayNumber: contestants.displayNumber,
        })
        .from(contestants)
        .where(eq(contestants.eventId, eventId))
        .orderBy(
          asc(contestants.position),
          asc(contestants.displayName),
        ),

      database
        .select({
          id: criteria.id,
          roundId: criteria.roundId,
          name: criteria.name,
          weight: criteria.weight,
          position: criteria.position,
        })
        .from(criteria)
        .where(eq(criteria.eventId, eventId))
        .orderBy(asc(criteria.position), asc(criteria.name)),

      database
        .select({ id: judges.id, displayName: judges.displayName, isActive: judges.isActive, isSystem: judges.isSystem })
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
        .select({
          roundId: scoreRecords.roundId,
          contestantId: scoreRecords.contestantId,
          judgeId: scoreRecords.judgeId,
          criterionId: scoreRecords.criterionId,
          value: scoreRecords.value,
        })
        .from(scoreRecords)
        .where(and(eq(scoreRecords.eventId, eventId), eq(scoreRecords.status, "submitted"))),
    ]);

  const activeJudgeIds = new Set(judgeRows.filter((j) => j.isActive && !j.isSystem).map((j) => j.id));
  const systemJudge = judgeRows.find((j) => j.isSystem) ?? null;
  const judgeById = new Map(judgeRows.map((j) => [j.id, j.displayName]));

  function judgesForSet(setId: string): string[] {
    const setRow = roundRows.find((r) => r.id === setId);
    if (setRow?.isManualEntry && systemJudge) return [systemJudge.id];
    // Assignment scopes: a specific set, a whole round (roundGroupId), or
    // event-wide (both null).
    const groupId = setRow?.roundGroupId ?? null;
    const assigned = new Set<string>();
    for (const a of assignmentRows) {
      const eventWide = a.roundId === null && a.roundGroupId === null;
      const matchesRound = a.roundGroupId !== null && a.roundGroupId === groupId;
      if (eventWide || a.roundId === setId || matchesRound) assigned.add(a.judgeId);
    }
    const pool = assigned.size === 0 ? activeJudgeIds : assigned;
    return Array.from(pool).filter((id) => activeJudgeIds.has(id));
  }

  // Index scores: setId → contestantId → judgeId → criterionId → value
  type ScoreIndex = Map<string, Map<string, Map<string, Map<string, number>>>>;
  const index: ScoreIndex = new Map();
  for (const row of scoreRows) {
    if (row.value === null) continue;
    if (!index.has(row.roundId)) index.set(row.roundId, new Map());
    const byContestant = index.get(row.roundId)!;
    if (!byContestant.has(row.contestantId)) byContestant.set(row.contestantId, new Map());
    const byJudge = byContestant.get(row.contestantId)!;
    if (!byJudge.has(row.judgeId)) byJudge.set(row.judgeId, new Map());
    byJudge.get(row.judgeId)!.set(row.criterionId, Number(row.value));
  }

  function buildSetScoresheet(setRow: (typeof roundRows)[number]): SetScoresheet {
    const setId = setRow.id;
    const setJudgeIds = judgesForSet(setId);
    const setCriteria = criteriaRows.filter((c) => c.roundId === setId);

    // Judges that actually submitted at least one score for this set.
    const scoringJudgeIds = setJudgeIds.filter((jid) => {
      const byContestant = index.get(setId);
      if (!byContestant) return false;
      for (const byJudge of byContestant.values()) {
        if (byJudge.has(jid)) return true;
      }
      return false;
    });

    const criterionBlocks: CriterionBlock[] = setCriteria.map((crit) => {
      const weight = Number(crit.weight);

      const rows: ContestantCriterionRow[] = contestantRows.map((contestant) => {
        const cells: JudgeScoreCell[] = scoringJudgeIds.map((jid) => {
          const raw =
            index.get(setId)?.get(contestant.id)?.get(jid)?.get(crit.id) ?? null;
          const weighted = raw !== null ? Math.round(raw * (weight / 100) * 100) / 100 : null;
          return { judgeId: jid, judgeName: judgeById.get(jid) ?? jid, raw, weighted };
        });

        const rawValues = cells.filter((c) => c.raw !== null).map((c) => c.raw as number);
        const weightedValues = cells.filter((c) => c.weighted !== null).map((c) => c.weighted as number);

        return {
          contestantId: contestant.id,
          contestantName: contestant.displayName,
          contestantNumber: contestant.displayNumber,
          cells,
          rawMean: mean(rawValues),
          weightedMean: mean(weightedValues),
        };
      }).filter((r) => r.cells.some((c) => c.raw !== null));

      return {
        criterionId: crit.id,
        criterionName: crit.name,
        weight,
        rows,
      };
    });

    // Summary: per-contestant total weighted mean across all criteria.
    const summaryMap = new Map<string, Record<string, number | null>>();
    for (const contestant of contestantRows) {
      summaryMap.set(contestant.id, {});
    }
    for (const block of criterionBlocks) {
      for (const row of block.rows) {
        const entry = summaryMap.get(row.contestantId);
        if (entry) entry[block.criterionId] = row.weightedMean;
      }
    }

    const summaryItems = contestantRows.flatMap((contestant) => {
      const bycriterion = summaryMap.get(contestant.id) ?? {};
      const values = Object.values(bycriterion).filter((v): v is number => v !== null);
      if (values.length === 0) return [];
      const total = Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
      return [{ contestantId: contestant.id, contestantName: contestant.displayName, contestantNumber: contestant.displayNumber, bycriterion, total }];
    });

    const rankMap = rankDesc(summaryItems);
    const summary: ContestantSetSummary[] = summaryItems
      .map((s) => ({ ...s, rank: rankMap.get(s.contestantId) ?? 0 }))
      .sort((a, b) => a.rank - b.rank || b.total - a.total);

    return {
      setId,
      setName: setRow.name,
      judges: scoringJudgeIds.map((jid) => ({ id: jid, name: judgeById.get(jid) ?? jid })),
      criteria: criterionBlocks,
      summary,
    };
  }

  // Assemble rounds + ungrouped sets
  const setByGroup = new Map<string | null, typeof roundRows>();
  for (const r of roundRows) {
    const key = r.roundGroupId ?? null;
    const bucket = setByGroup.get(key) ?? [];
    bucket.push(r);
    setByGroup.set(key, bucket);
  }

  const roundScoresheets: RoundScoresheet[] = groupRows.map((g) => ({
    roundId: g.id,
    roundName: g.name,
    sets: (setByGroup.get(g.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(buildSetScoresheet),
  }));

  const ungroupedSets: SetScoresheet[] = (setByGroup.get(null) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(buildSetScoresheet);

  return {
    event: { id: eventRow.id, name: eventRow.name, logoUrl: eventRow.logoUrl },
    generatedAt: new Date().toISOString(),
    allJudges: judgeRows
      .filter((j) => j.isActive)
      .map((j) => ({ id: j.id, name: j.displayName })),
    rounds: roundScoresheets,
    ungroupedSets,
  };
}
