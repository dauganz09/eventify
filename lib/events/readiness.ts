import type { db } from "@/db";
import { getEventById } from "@/lib/events/event-service";
import { listCriteria } from "@/lib/events/criterion-service";
import { listContestants } from "@/lib/events/contestant-service";
import { listJudgeAssignments, listJudges } from "@/lib/events/judge-service";
import { listRoundGroups } from "@/lib/events/round-group-service";
import { listRounds } from "@/lib/events/round-service";
import { listScoringRules } from "@/lib/events/scoring-rule-service";
import { parseRoundScoreMode } from "@/lib/scoring/ranking";

export interface ReadinessItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export async function getEventReadiness(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  const event = await getEventById(params);
  if (!event) throw new Error("Event not found.");

  const [roundRows, groupRows, contestantRows, judgeRows, assignmentRows, criteriaRows, ruleRows] =
    await Promise.all([
      listRounds(params),
      listRoundGroups(params),
      listContestants(params),
      listJudges(params),
      listJudgeAssignments(params),
      listCriteria(params),
      listScoringRules(params),
    ]);

  const activeJudges = judgeRows.filter((judge) => judge.isActive);
  const roundsWithCriteria = roundRows.filter((round) =>
    criteriaRows.some((criterion) => criterion.roundId === round.id),
  );

  // Per-set judge coverage. A set is "covered" when at least one active,
  // non-system judge is assigned to it — event-wide (both scopes null), by set
  // (roundId), or by its round group (roundGroupId). An uncovered set silently
  // falls back to counting ALL judges in results/breakdowns, so surface it.
  // Manual-entry sets are scored by the system judge and need no assignment.
  const activeRealJudgeIds = new Set(
    judgeRows.filter((j) => j.isActive && !j.isSystem).map((j) => j.id),
  );
  const scoredSets = roundRows.filter((round) => !round.isManualEntry);
  const uncoveredSets = scoredSets.filter(
    (round) =>
      !assignmentRows.some((a) => {
        if (!activeRealJudgeIds.has(a.judgeId)) return false;
        const eventWide = a.roundId === null && a.roundGroupId === null;
        const bySet = a.roundId === round.id;
        const byGroup = a.roundGroupId !== null && a.roundGroupId === round.roundGroupId;
        return eventWide || bySet || byGroup;
      }),
  );

  const items: ReadinessItem[] = [
    {
      id: "details",
      label: "Event details configured",
      passed: Boolean(event.name && event.timezone),
      detail: "Name and timezone are required.",
    },
    {
      id: "rounds",
      label: "At least one round exists",
      passed: roundRows.length > 0,
      detail: `${roundRows.length} round(s) configured.`,
    },
    {
      id: "contestants",
      label: "Contestants added",
      passed: contestantRows.length > 0,
      detail: `${contestantRows.length} contestant(s) active.`,
    },
    {
      id: "judges",
      label: "Active judges assigned",
      passed: activeJudges.length > 0 && assignmentRows.length > 0,
      detail: `${activeJudges.length} active judge(s), ${assignmentRows.length} assignment(s).`,
    },
    {
      id: "judge-coverage",
      label: "Every set has an assigned judge",
      passed: scoredSets.length === 0 || uncoveredSets.length === 0,
      detail:
        uncoveredSets.length === 0
          ? "All sets are covered by at least one judge assignment."
          : `No judge assigned to: ${uncoveredSets
              .map((r) => r.name)
              .join(", ")}. These sets would count ALL judges in results — assign judges to them in the Judges step.`,
    },
    {
      id: "criteria",
      label: "Criteria configured for rounds",
      passed: criteriaRows.length > 0 && roundsWithCriteria.length === roundRows.length,
      detail: `${criteriaRows.length} criteria across ${roundsWithCriteria.length}/${roundRows.length} rounds.`,
    },
    {
      id: "scoring-rules",
      label: "Scoring rules configured",
      passed: ruleRows.length > 0,
      detail: `${ruleRows.length} scoring rule(s).`,
    },
  ];

  // Carry-over weighting: only relevant when one or more rounds carry scores
  // forward. In "average" mode each round's weight is a share of the final
  // score, so the weights must total exactly 100%. In "sum" (points-based)
  // mode every round contributes its full points instead — each carry-over
  // round must be at 100% (full weight), and the total is naturally >100%.
  const roundScoreMode = parseRoundScoreMode(
    (event.config as Record<string, unknown> | null)?.roundScoreMode,
  );
  const carryOverGroups = groupRows.filter((group) => group.carryOverScores);
  if (carryOverGroups.length > 0) {
    if (roundScoreMode === "sum") {
      const offWeight = carryOverGroups.filter((g) => g.carryOverWeight !== 100);
      items.push({
        id: "carry-over-weights",
        label: "Points-based rounds carry full weight",
        passed: offWeight.length === 0,
        detail:
          offWeight.length === 0
            ? `${carryOverGroups.length} carry-over round(s) each carry 100% of their points.`
            : `${offWeight.map((g) => `"${g.name}" (${g.carryOverWeight}%)`).join(", ")} should be set to 100% — in points-based scoring each round contributes its full points.`,
      });
    } else {
      const weightTotal = carryOverGroups.reduce(
        (sum, group) => sum + group.carryOverWeight,
        0,
      );
      items.push({
        id: "carry-over-weights",
        label: "Carry-over round weights total 100%",
        passed: weightTotal === 100,
        detail:
          weightTotal === 100
            ? `${carryOverGroups.length} carry-over round(s) total 100%.`
            : `Carry-over rounds currently total ${weightTotal}% — adjust the weights to total exactly 100%.`,
      });
    }
  }

  return {
    items,
    isReady: items.every((item) => item.passed),
  };
}
