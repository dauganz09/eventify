import { and, asc, eq, isNull } from "drizzle-orm";
import type { db } from "@/db";
import {
  contestants,
  criteria,
  events,
  judges,
  rounds,
  scoreRecords,
} from "@/db/schema";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface ConflictFlag {
  setId: string;
  setName: string;
  contestantId: string;
  contestantNumber: string | null;
  contestantName: string;
  criterionId: string;
  criterionName: string;
  judgeId: string;
  judgeName: string;
  value: number;
  panelMean: number;
  /** value − panelMean (signed). */
  deviation: number;
  /** Judge count that scored this contestant-criterion. */
  panelSize: number;
}

export interface JudgeAnalytics {
  judgeId: string;
  judgeName: string;
  scored: number;
  /** Mean signed deviation from the panel mean. +lenient / −harsh. */
  leniency: number;
  /** Mean absolute deviation from panel — lower = more aligned with the panel. */
  agreement: number;
  /** Number of flagged outliers this judge produced. */
  outliers: number;
}

export interface CriterionAnalytics {
  criterionId: string;
  criterionName: string;
  setName: string;
  /** Mean across all judge scores for the criterion. */
  mean: number;
  /** Mean per-contestant spread (max − min across judges). Higher = less consensus. */
  spread: number;
  samples: number;
}

export interface EventInsights {
  event: { id: string; name: string };
  conflicts: ConflictFlag[];
  judges: JudgeAnalytics[];
  criteria: CriterionAnalytics[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Outlier threshold for a criterion: a quarter of its scoring range, floored at 1. */
function thresholdFor(min: number, max: number) {
  const range = Math.max(0, max - min);
  return Math.max(range * 0.25, 1);
}

async function loadEvent(
  database: typeof db,
  organizationId: string,
  eventId: string,
) {
  const [event] = await database
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);
  if (!event) throw new Error("Event not found.");
  return event;
}

// ── Event-wide insights (conflicts + analytics) ───────────────────────────────

export async function getEventInsights(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}): Promise<EventInsights> {
  const { database, organizationId, eventId } = params;
  const event = await loadEvent(database, organizationId, eventId);

  const [roundRows, contestantRows, criteriaRows, judgeRows, scoreRows] =
    await Promise.all([
      database
        .select({ id: rounds.id, name: rounds.name })
        .from(rounds)
        .where(eq(rounds.eventId, eventId)),
      database
        .select({
          id: contestants.id,
          displayName: contestants.displayName,
          displayNumber: contestants.displayNumber,
        })
        .from(contestants)
        .where(and(eq(contestants.eventId, eventId), isNull(contestants.archivedAt))),
      database
        .select({
          id: criteria.id,
          roundId: criteria.roundId,
          name: criteria.name,
          minValue: criteria.minValue,
          maxValue: criteria.maxValue,
        })
        .from(criteria)
        .where(eq(criteria.eventId, eventId)),
      database
        .select({ id: judges.id, displayName: judges.displayName })
        .from(judges)
        .where(eq(judges.eventId, eventId)),
      database
        .select({
          roundId: scoreRecords.roundId,
          contestantId: scoreRecords.contestantId,
          criterionId: scoreRecords.criterionId,
          judgeId: scoreRecords.judgeId,
          value: scoreRecords.value,
        })
        .from(scoreRecords)
        .where(
          and(eq(scoreRecords.eventId, eventId), eq(scoreRecords.status, "submitted")),
        ),
    ]);

  const setName = new Map(roundRows.map((r) => [r.id, r.name]));
  const contestantById = new Map(contestantRows.map((c) => [c.id, c]));
  const criterionById = new Map(criteriaRows.map((c) => [c.id, c]));
  const judgeName = new Map(judgeRows.map((j) => [j.id, j.displayName]));

  // Group judge values per (set, contestant, criterion).
  type Cell = { judgeId: string; value: number };
  const cells = new Map<string, Cell[]>(); // key: set|contestant|criterion
  for (const row of scoreRows) {
    if (row.value === null) continue;
    const key = `${row.roundId}|${row.contestantId}|${row.criterionId}`;
    const bucket = cells.get(key) ?? [];
    bucket.push({ judgeId: row.judgeId, value: Number(row.value) });
    cells.set(key, bucket);
  }

  const conflicts: ConflictFlag[] = [];
  // Accumulators for judge analytics.
  const judgeAcc = new Map<
    string,
    { scored: number; sumDev: number; sumAbsDev: number; outliers: number }
  >();
  // Accumulators for criterion analytics.
  const critAcc = new Map<
    string,
    { sum: number; samples: number; spreadSum: number; groups: number }
  >();

  for (const [key, bucket] of cells) {
    const [setId, contestantId, criterionId] = key.split("|");
    const criterion = criterionById.get(criterionId);
    if (!criterion) continue;
    const values = bucket.map((b) => b.value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const threshold = thresholdFor(
      Number(criterion.minValue ?? 0),
      Number(criterion.maxValue ?? 100),
    );

    // Criterion accumulator.
    const ca = critAcc.get(criterionId) ?? { sum: 0, samples: 0, spreadSum: 0, groups: 0 };
    ca.sum += values.reduce((s, v) => s + v, 0);
    ca.samples += values.length;
    ca.spreadSum += max - min;
    ca.groups += 1;
    critAcc.set(criterionId, ca);

    for (const cell of bucket) {
      const dev = cell.value - mean;
      const ja = judgeAcc.get(cell.judgeId) ?? {
        scored: 0,
        sumDev: 0,
        sumAbsDev: 0,
        outliers: 0,
      };
      ja.scored += 1;
      ja.sumDev += dev;
      ja.sumAbsDev += Math.abs(dev);

      // Only flag when there's a real panel (≥3 judges) and the deviation is large.
      if (bucket.length >= 3 && Math.abs(dev) >= threshold) {
        ja.outliers += 1;
        const contestant = contestantById.get(contestantId);
        conflicts.push({
          setId,
          setName: setName.get(setId) ?? "Set",
          contestantId,
          contestantNumber: contestant?.displayNumber ?? null,
          contestantName: contestant?.displayName ?? "Contestant",
          criterionId,
          criterionName: criterion.name,
          judgeId: cell.judgeId,
          judgeName: judgeName.get(cell.judgeId) ?? "Judge",
          value: round2(cell.value),
          panelMean: round2(mean),
          deviation: round2(dev),
          panelSize: bucket.length,
        });
      }
      judgeAcc.set(cell.judgeId, ja);
    }
  }

  conflicts.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));

  const judgeAnalytics: JudgeAnalytics[] = judgeRows
    .map((j) => {
      const a = judgeAcc.get(j.id);
      return {
        judgeId: j.id,
        judgeName: j.displayName,
        scored: a?.scored ?? 0,
        leniency: a && a.scored ? round2(a.sumDev / a.scored) : 0,
        agreement: a && a.scored ? round2(a.sumAbsDev / a.scored) : 0,
        outliers: a?.outliers ?? 0,
      };
    })
    .filter((j) => j.scored > 0)
    .sort((a, b) => b.scored - a.scored);

  const criterionAnalytics: CriterionAnalytics[] = criteriaRows
    .map((c) => {
      const a = critAcc.get(c.id);
      return {
        criterionId: c.id,
        criterionName: c.name,
        setName: setName.get(c.roundId ?? "") ?? "—",
        mean: a && a.samples ? round2(a.sum / a.samples) : 0,
        spread: a && a.groups ? round2(a.spreadSum / a.groups) : 0,
        samples: a?.samples ?? 0,
      };
    })
    .filter((c) => c.samples > 0)
    .sort((a, b) => b.spread - a.spread);

  return {
    event,
    conflicts,
    judges: judgeAnalytics,
    criteria: criterionAnalytics,
  };
}

// ── Single-contestant breakdown (drill-down) ──────────────────────────────────

export interface ContestantBreakdownCell {
  criterionId: string;
  criterionName: string;
  weight: number;
  /** judgeId -> raw value (null if not scored). */
  byJudge: Record<string, number | null>;
}

export interface ContestantBreakdownSet {
  setId: string;
  setName: string;
  position: number;
  criteria: ContestantBreakdownCell[];
  /** judgeId -> weighted total for the set. */
  judgeTotals: Record<string, number | null>;
  /** Average across judges who scored — the set total used in standings. */
  setTotal: number | null;
}

export interface ContestantBreakdown {
  event: { id: string; name: string };
  contestant: {
    id: string;
    displayName: string;
    displayNumber: string | null;
    photoUrl: string | null;
  };
  judges: { id: string; displayName: string }[];
  sets: ContestantBreakdownSet[];
}

export async function getContestantBreakdown(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  contestantId: string;
}): Promise<ContestantBreakdown> {
  const { database, organizationId, eventId, contestantId } = params;
  const event = await loadEvent(database, organizationId, eventId);

  const [contestant] = await database
    .select({
      id: contestants.id,
      displayName: contestants.displayName,
      displayNumber: contestants.displayNumber,
      photoUrl: contestants.photoUrl,
    })
    .from(contestants)
    .where(and(eq(contestants.id, contestantId), eq(contestants.eventId, eventId)))
    .limit(1);
  if (!contestant) throw new Error("Contestant not found.");

  const [roundRows, criteriaRows, judgeRows, scoreRows] = await Promise.all([
    database
      .select({ id: rounds.id, name: rounds.name, position: rounds.position })
      .from(rounds)
      .where(eq(rounds.eventId, eventId))
      .orderBy(asc(rounds.position)),
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
      .orderBy(asc(criteria.position)),
    database
      .select({ id: judges.id, displayName: judges.displayName })
      .from(judges)
      .where(eq(judges.eventId, eventId))
      .orderBy(asc(judges.displayName)),
    database
      .select({
        roundId: scoreRecords.roundId,
        criterionId: scoreRecords.criterionId,
        judgeId: scoreRecords.judgeId,
        value: scoreRecords.value,
      })
      .from(scoreRecords)
      .where(
        and(
          eq(scoreRecords.eventId, eventId),
          eq(scoreRecords.contestantId, contestantId),
          eq(scoreRecords.status, "submitted"),
        ),
      ),
  ]);

  // value lookup: round|criterion|judge -> value
  const valueOf = new Map<string, number | null>();
  for (const row of scoreRows) {
    valueOf.set(`${row.roundId}|${row.criterionId}|${row.judgeId}`, row.value === null ? null : Number(row.value));
  }

  const sets: ContestantBreakdownSet[] = roundRows.map((round) => {
    const setCriteria = criteriaRows.filter((c) => c.roundId === round.id);
    const cells: ContestantBreakdownCell[] = setCriteria.map((crit) => {
      const byJudge: Record<string, number | null> = {};
      for (const judge of judgeRows) {
        byJudge[judge.id] = valueOf.get(`${round.id}|${crit.id}|${judge.id}`) ?? null;
      }
      return {
        criterionId: crit.id,
        criterionName: crit.name,
        weight: Number(crit.weight ?? 100),
        byJudge,
      };
    });

    // Per-judge weighted totals, then average across judges who scored anything.
    const judgeTotals: Record<string, number | null> = {};
    const totals: number[] = [];
    for (const judge of judgeRows) {
      let sum = 0;
      let any = false;
      for (const crit of setCriteria) {
        const v = valueOf.get(`${round.id}|${crit.id}|${judge.id}`);
        if (v !== undefined && v !== null) {
          sum += v * (Number(crit.weight ?? 100) / 100);
          any = true;
        }
      }
      judgeTotals[judge.id] = any ? round2(sum) : null;
      if (any) totals.push(sum);
    }
    const setTotal =
      totals.length > 0
        ? round2(totals.reduce((s, v) => s + v, 0) / totals.length)
        : null;

    return {
      setId: round.id,
      setName: round.name,
      position: round.position,
      criteria: cells,
      judgeTotals,
      setTotal,
    };
  });

  return {
    event,
    contestant,
    judges: judgeRows,
    sets,
  };
}
