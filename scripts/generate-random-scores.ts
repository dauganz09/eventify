/**
 * Generates random submitted scores for an event so you can test print reports.
 *
 * Respects each criterion's min/max/step, only assigns scores to judges who are
 * assigned to that set/round (same rules as the tabulator), and skips archived
 * contestants. When a round group has a qualifier snapshot, only those
 * contestants are scored for sets in that group. Generated values are always
 * capped to 1 decimal place, matching this app's criteria (stepValue is 0.1 or
 * 0.5 everywhere), regardless of what a criterion's own step implies.
 *
 * --mimic-tie deliberately forces one pair of contestants to identical scores
 * (chosen near the smallest advancement cutoff, if one is configured, else an
 * arbitrary pair) so the cumulative standings — and the advancement cut, if
 * any — land on a real, un-auto-resolvable tie. It also ties the first two
 * eligible contestants in every rank-order (Q&A-style) set the same way, which
 * produces a 0–0 judges' majority split (also unresolvable automatically).
 * Both are useful for exercising the tabulator's manual "Break tie" feature.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --event-id=<uuid>
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --sets=active
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --keep-existing
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --seed=42
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --mimic-tie
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
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
import { parseRoundScoreMode, rankWithTieBreak } from "@/lib/scoring/ranking";

type Insert = typeof scoreRecords.$inferInsert;

interface CriterionRow {
  id: string;
  roundId: string | null;
  minValue: string | null;
  maxValue: string | null;
  stepValue: string | null;
  isRequired: boolean;
  weight: string | null;
}

interface SetRow {
  id: string;
  name: string;
  roundGroupId: string | null;
  status: string;
  isManualEntry: boolean;
}

interface GroupRow {
  id: string;
  name: string;
  position: number;
  advanceCount: number | null;
  scoringMethod: string;
  qualifiedContestantIds: string[] | null;
}

interface AssignmentRow {
  judgeId: string;
  roundId: string | null;
  roundGroupId: string | null;
}

function parseArgs(argv: string[]) {
  let eventId: string | undefined;
  let sets: "all" | "active" = "all";
  let keepExisting = false;
  let seed: number | undefined;
  let mimicTie = false;

  for (const arg of argv) {
    if (arg.startsWith("--event-id=")) eventId = arg.slice("--event-id=".length);
    else if (arg === "--keep-existing") keepExisting = true;
    else if (arg === "--mimic-tie") mimicTie = true;
    else if (arg.startsWith("--sets=")) {
      const value = arg.slice("--sets=".length);
      if (value === "all" || value === "active") sets = value;
      else throw new Error(`Invalid --sets value: ${value} (use "all" or "active")`);
    } else if (arg.startsWith("--seed=")) {
      seed = Number(arg.slice("--seed=".length));
      if (!Number.isFinite(seed)) throw new Error(`Invalid --seed value: ${arg}`);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npx tsx --env-file=.env scripts/generate-random-scores.ts [options]

Options:
  --event-id=<uuid>   Event to score (default: first active, non-deleted event)
  --sets=all|active   Score all sets or only active ones (default: all)
  --keep-existing     Do not wipe existing scores for this event first
  --seed=<number>     Reproducible random values
  --mimic-tie         Force a real, unresolved tie at the advancement cutoff
                       (if configured) and in every rank-order set, to test
                       the tabulator's manual "Break tie" feature
  --help              Show this help text
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { eventId, sets, keepExisting, seed, mimicTie };
}

function createRng(seed?: number) {
  if (seed === undefined) return Math.random;
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomScore(
  criterion: Pick<CriterionRow, "minValue" | "maxValue" | "stepValue">,
  rng: () => number,
) {
  const min = criterion.minValue != null ? Number(criterion.minValue) : 0;
  const max = criterion.maxValue != null ? Number(criterion.maxValue) : 10;
  const step =
    criterion.stepValue != null && Number(criterion.stepValue) > 0
      ? Number(criterion.stepValue)
      : 1;
  const steps = Math.max(0, Math.floor((max - min) / step + 1e-9));
  const pick = Math.floor(rng() * (steps + 1));
  // Capped to 1 decimal place — every criterion in this app is configured
  // with a stepValue of 0.1 or 0.5, never finer.
  return Math.round((min + pick * step) * 10) / 10;
}

function judgesForSet(
  setRow: SetRow,
  roundRows: SetRow[],
  assignmentRows: AssignmentRow[],
  activeJudgeIds: string[],
  systemJudgeId: string | null,
): string[] {
  if (setRow.isManualEntry && systemJudgeId) return [systemJudgeId];

  const groupId = setRow.roundGroupId;
  const ids = new Set<string>();
  for (const assignment of assignmentRows) {
    const eventWide = assignment.roundId === null && assignment.roundGroupId === null;
    const matchesSet = assignment.roundId === setRow.id;
    const matchesRound =
      assignment.roundGroupId !== null && assignment.roundGroupId === groupId;
    if (eventWide || matchesSet || matchesRound) ids.add(assignment.judgeId);
  }

  if (ids.size === 0) return activeJudgeIds;
  return Array.from(ids).filter((id) => activeJudgeIds.includes(id));
}

function contestantsForSet(
  setRow: SetRow,
  groupRows: GroupRow[],
  contestantIds: string[],
) {
  if (!setRow.roundGroupId) return contestantIds;
  const group = groupRows.find((g) => g.id === setRow.roundGroupId);
  const qualified = group?.qualifiedContestantIds ?? [];
  if (qualified.length === 0) return contestantIds;
  const allowed = new Set(qualified);
  return contestantIds.filter((id) => allowed.has(id));
}

// ── --mimic-tie ──────────────────────────────────────────────────────────────
// Generated values start out in this map (before being flattened to insert
// rows) so a tie can be forced by simply overwriting one contestant's entries
// with another's — guaranteeing byte-identical totals in the real tabulator
// regardless of its weighting/carry-over math, since equal inputs stay equal
// through any linear combination applied identically to both.

type ValueMap = Map<string, number>;

function valueKey(setId: string, contestantId: string, judgeId: string, criterionId: string) {
  return `${setId}::${contestantId}::${judgeId}::${criterionId}`;
}

/** Judge-averaged, weight-adjusted total for one contestant in one set — approximates the tabulator's math closely enough to pick a tie pair. */
function approxSetTotal(
  values: ValueMap,
  setId: string,
  contestantId: string,
  judgeIds: string[],
  setCriteria: CriterionRow[],
): number | null {
  const perJudge: number[] = [];
  for (const judgeId of judgeIds) {
    let sum = 0;
    let any = false;
    for (const criterion of setCriteria) {
      const value = values.get(valueKey(setId, contestantId, judgeId, criterion.id));
      if (value === undefined) continue;
      any = true;
      const weight = criterion.weight != null ? Number(criterion.weight) : 100;
      sum += value * (weight / 100);
    }
    if (any) perJudge.push(sum);
  }
  if (perJudge.length === 0) return null;
  return perJudge.reduce((a, b) => a + b, 0) / perJudge.length;
}

/**
 * Picks the two contestants sitting right at the smallest configured
 * advancement cutoff (rank N and N+1), using the already-generated random
 * values to approximate cumulative standings. Returns null when no round has
 * an advancement count, or there aren't enough contestants to straddle it.
 */
function chooseCutoffTiePair(params: {
  contestantIds: string[];
  groupRows: GroupRow[];
  setRows: SetRow[];
  values: ValueMap;
  judgesBySet: Map<string, string[]>;
  criteriaBySet: Map<string, CriterionRow[]>;
  roundScoreMode: "average" | "sum";
}): { groupId: string; groupName: string; a: string; b: string; priorSetIds: string[] } | null {
  const { contestantIds, groupRows, setRows, values, judgesBySet, criteriaBySet, roundScoreMode } = params;

  // advanceCount describes who advances INTO this group from the prior points
  // rounds' cumulative standings — independent of how this group itself scores.
  const targets = groupRows
    .filter((g) => g.advanceCount !== null)
    .sort((a, b) => (a.advanceCount ?? 0) - (b.advanceCount ?? 0));
  if (targets.length === 0) return null;
  const target = targets[0];
  if (target.advanceCount === null) return null;

  const priorGroupIds = new Set(
    groupRows.filter((g) => g.position < target.position).map((g) => g.id),
  );
  const priorSetIds = setRows
    .filter((s) => s.roundGroupId && priorGroupIds.has(s.roundGroupId))
    .map((s) => s.id);
  if (priorSetIds.length === 0) return null;

  const totals = contestantIds.map((contestantId) => {
    const perSet = priorSetIds
      .map((setId) =>
        approxSetTotal(
          values,
          setId,
          contestantId,
          judgesBySet.get(setId) ?? [],
          criteriaBySet.get(setId) ?? [],
        ),
      )
      .filter((v): v is number => v !== null);
    const total =
      perSet.length === 0
        ? 0
        : roundScoreMode === "sum"
          ? perSet.reduce((a, b) => a + b, 0)
          : perSet.reduce((a, b) => a + b, 0) / perSet.length;
    return { contestantId, total };
  });

  const rankMap = rankWithTieBreak(
    totals.map((t) => ({ id: t.contestantId, primary: t.total, setScoresByRecency: [] })),
    "shared",
  );

  const advanceCount = target.advanceCount;
  const a = totals.find((t) => rankMap.get(t.contestantId) === advanceCount)?.contestantId;
  const b = totals.find((t) => rankMap.get(t.contestantId) === advanceCount + 1)?.contestantId;
  if (!a || !b || a === b) return null;

  return { groupId: target.id, groupName: target.name, a, b, priorSetIds };
}

/** Overwrites `to`'s generated values with `from`'s, for every judge/criterion in one set. */
function tieContestant(
  values: ValueMap,
  setId: string,
  from: string,
  to: string,
  judgeIds: string[],
  setCriteria: CriterionRow[],
) {
  for (const judgeId of judgeIds) {
    for (const criterion of setCriteria) {
      const value = values.get(valueKey(setId, from, judgeId, criterion.id));
      if (value === undefined) continue;
      values.set(valueKey(setId, to, judgeId, criterion.id), value);
    }
  }
}

async function resolveEventId(explicitId?: string) {
  if (explicitId) {
    const [event] = await db
      .select({ id: events.id, name: events.name, status: events.status })
      .from(events)
      .where(and(eq(events.id, explicitId), isNull(events.deletedAt)))
      .limit(1);
    if (!event) throw new Error(`Event not found: ${explicitId}`);
    return event;
  }

  const activeEvents = await db
    .select({ id: events.id, name: events.name, status: events.status })
    .from(events)
    .where(and(eq(events.status, "active"), isNull(events.deletedAt)))
    .orderBy(asc(events.updatedAt));

  if (activeEvents.length === 0) {
    throw new Error(
      'No active event found. Pass --event-id=<uuid> or set an event to "active" in the builder.',
    );
  }

  if (activeEvents.length > 1) {
    console.log(
      `Multiple active events found; using "${activeEvents[0].name}" (${activeEvents[0].id}).`,
    );
    console.log("Pass --event-id=<uuid> to target a specific event.");
  }

  return activeEvents[0];
}

async function main() {
  const { eventId: explicitEventId, sets, keepExisting, seed, mimicTie } = parseArgs(
    process.argv.slice(2),
  );
  const rng = createRng(seed);
  const event = await resolveEventId(explicitEventId);

  const [
    [eventRow],
    groupRows,
    setRows,
    criteriaRows,
    contestantRows,
    judgeRows,
    assignmentRows,
  ] = await Promise.all([
    db
      .select({ organizationId: events.organizationId, config: events.config })
      .from(events)
      .where(eq(events.id, event.id))
      .limit(1),
    db
      .select({
        id: roundGroups.id,
        name: roundGroups.name,
        position: roundGroups.position,
        advanceCount: roundGroups.advanceCount,
        scoringMethod: roundGroups.scoringMethod,
        qualifiedContestantIds: roundGroups.qualifiedContestantIds,
      })
      .from(roundGroups)
      .where(eq(roundGroups.eventId, event.id)),
    db
      .select({
        id: rounds.id,
        name: rounds.name,
        roundGroupId: rounds.roundGroupId,
        status: rounds.status,
        isManualEntry: rounds.isManualEntry,
      })
      .from(rounds)
      .where(eq(rounds.eventId, event.id))
      .orderBy(asc(rounds.position)),
    db
      .select({
        id: criteria.id,
        roundId: criteria.roundId,
        minValue: criteria.minValue,
        maxValue: criteria.maxValue,
        stepValue: criteria.stepValue,
        isRequired: criteria.isRequired,
        weight: criteria.weight,
      })
      .from(criteria)
      .where(eq(criteria.eventId, event.id)),
    db
      .select({
        id: contestants.id,
        displayNumber: contestants.displayNumber,
        displayName: contestants.displayName,
      })
      .from(contestants)
      .where(and(eq(contestants.eventId, event.id), isNull(contestants.archivedAt))),
    db
      .select({
        id: judges.id,
        isActive: judges.isActive,
        isSystem: judges.isSystem,
      })
      .from(judges)
      .where(eq(judges.eventId, event.id)),
    db
      .select({
        judgeId: judgeAssignments.judgeId,
        roundId: judgeAssignments.roundId,
        roundGroupId: judgeAssignments.roundGroupId,
      })
      .from(judgeAssignments)
      .where(eq(judgeAssignments.eventId, event.id)),
  ]);

  if (!eventRow) throw new Error(`Event row missing: ${event.id}`);

  const activeJudgeIds = judgeRows
    .filter((judge) => judge.isActive && !judge.isSystem)
    .map((judge) => judge.id);
  const systemJudgeId = judgeRows.find((judge) => judge.isSystem)?.id ?? null;
  const contestantIds = contestantRows.map((row) => row.id);
  const contestantLabelById = new Map(
    contestantRows.map((c) => [c.id, c.displayNumber ? `#${c.displayNumber} ${c.displayName}` : c.displayName]),
  );

  if (contestantIds.length === 0) {
    throw new Error("Event has no active contestants.");
  }
  if (activeJudgeIds.length === 0 && !systemJudgeId) {
    throw new Error("Event has no active judges.");
  }

  const targetSets = setRows.filter((setRow) => sets === "all" || setRow.status === "active");
  if (targetSets.length === 0) {
    throw new Error(`No ${sets === "active" ? "active " : ""}sets found for this event.`);
  }

  const criteriaBySet = new Map<string, CriterionRow[]>();
  for (const criterion of criteriaRows) {
    if (!criterion.roundId) continue;
    const bucket = criteriaBySet.get(criterion.roundId) ?? [];
    bucket.push(criterion);
    criteriaBySet.set(criterion.roundId, bucket);
  }

  const now = new Date();
  const values: ValueMap = new Map();
  const cells: Array<{ setId: string; contestantId: string; judgeId: string; criterionId: string }> = [];
  const judgesBySet = new Map<string, string[]>();
  const contestantsBySet = new Map<string, string[]>();
  const summary: Array<{ set: string; judges: number; contestants: number; criteria: number }> = [];

  for (const setRow of targetSets) {
    const setCriteria = (criteriaBySet.get(setRow.id) ?? []).filter((c) => c.isRequired);
    if (setCriteria.length === 0) continue;

    const setJudgeIds = judgesForSet(
      setRow,
      setRows,
      assignmentRows,
      activeJudgeIds,
      systemJudgeId,
    );
    if (setJudgeIds.length === 0) {
      console.warn(`Skipping "${setRow.name}": no assigned judges.`);
      continue;
    }

    const setContestantIds = contestantsForSet(setRow, groupRows, contestantIds);
    if (setContestantIds.length === 0) {
      console.warn(`Skipping "${setRow.name}": no eligible contestants.`);
      continue;
    }

    judgesBySet.set(setRow.id, setJudgeIds);
    contestantsBySet.set(setRow.id, setContestantIds);

    for (const judgeId of setJudgeIds) {
      for (const contestantId of setContestantIds) {
        for (const criterion of setCriteria) {
          values.set(
            valueKey(setRow.id, contestantId, judgeId, criterion.id),
            randomScore(criterion, rng),
          );
          cells.push({ setId: setRow.id, contestantId, judgeId, criterionId: criterion.id });
        }
      }
    }

    summary.push({
      set: setRow.name,
      judges: setJudgeIds.length,
      contestants: setContestantIds.length,
      criteria: setCriteria.length,
    });
  }

  if (cells.length === 0) {
    throw new Error("Nothing to insert — check that sets have criteria and judge assignments.");
  }

  const tieNotes: string[] = [];
  if (mimicTie) {
    const roundScoreMode = parseRoundScoreMode(
      (eventRow.config as Record<string, unknown> | null)?.roundScoreMode,
    );

    const cutoffPair = chooseCutoffTiePair({
      contestantIds,
      groupRows,
      setRows: targetSets,
      values,
      judgesBySet,
      criteriaBySet,
      roundScoreMode,
    });
    if (cutoffPair) {
      const priorSetIds = cutoffPair.priorSetIds.filter((id) => judgesBySet.has(id));
      for (const setId of priorSetIds) {
        tieContestant(
          values,
          setId,
          cutoffPair.a,
          cutoffPair.b,
          judgesBySet.get(setId) ?? [],
          (criteriaBySet.get(setId) ?? []).filter((c) => c.isRequired),
        );
      }
      tieNotes.push(
        `Cutoff tie: ${contestantLabelById.get(cutoffPair.a)} and ${contestantLabelById.get(cutoffPair.b)} now ` +
          `have identical cumulative totals feeding the advancement cut into "${cutoffPair.groupName}" ` +
          `(${priorSetIds.length} set(s) tied).`,
      );
    } else {
      tieNotes.push("No advancement-cutoff tie forced (no round has an advancement count configured).");
    }

    for (const group of groupRows.filter((g) => g.scoringMethod === "rank_order")) {
      const groupSetIds = targetSets
        .filter((s) => s.roundGroupId === group.id)
        .map((s) => s.id)
        .filter((id) => contestantsBySet.has(id));
      for (const setId of groupSetIds) {
        const eligible = contestantsBySet.get(setId) ?? [];
        if (eligible.length < 2) continue;
        const [a, b] = eligible;
        tieContestant(
          values,
          setId,
          a,
          b,
          judgesBySet.get(setId) ?? [],
          (criteriaBySet.get(setId) ?? []).filter((c) => c.isRequired),
        );
        const setName = targetSets.find((s) => s.id === setId)?.name ?? setId;
        tieNotes.push(
          `Rank-order tie: ${contestantLabelById.get(a)} and ${contestantLabelById.get(b)} now get identical ` +
            `scores from every judge in "${setName}" (0–0 majority split — needs a manual break).`,
        );
      }
    }
  }

  const rows: Insert[] = cells.map((cell) => ({
    organizationId: eventRow.organizationId,
    eventId: event.id,
    roundId: cell.setId,
    contestantId: cell.contestantId,
    judgeId: cell.judgeId,
    criterionId: cell.criterionId,
    value: values.get(valueKey(cell.setId, cell.contestantId, cell.judgeId, cell.criterionId))!.toString(),
    status: "submitted",
    revision: 1,
    submittedAt: now,
  }));

  await db.transaction(async (tx) => {
    if (!keepExisting) {
      await tx.delete(scoreRecords).where(eq(scoreRecords.eventId, event.id));
    }

    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(scoreRecords).values(rows.slice(i, i + 500));
    }
  });

  console.log(`Generated ${rows.length} random scores for "${event.name}" (${event.id}).`);
  if (!keepExisting) console.log("Existing scores for this event were cleared first.");
  console.log("");
  for (const line of summary) {
    console.log(
      `  ${line.set}: ${line.judges} judge(s) × ${line.contestants} contestant(s) × ${line.criteria} criterion/criteria`,
    );
  }
  if (tieNotes.length > 0) {
    console.log("");
    for (const note of tieNotes) console.log(`  ⚠ ${note}`);
  }
  console.log("");
  console.log("Open the tabulator print view to review reports.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
