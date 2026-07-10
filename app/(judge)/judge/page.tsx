import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestants, criteria, events, judgeAssignments, judges, judgeSetSubmissions, roundGroups, rounds, scoreRecords, unlockRequests } from "@/db/schema";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";
import { getActiveVoteForJudge } from "@/lib/scoring/tie-break-vote-service";
import { JudgeWorkspace } from "@/components/scoring/judge-workspace";
import { JudgeRealtime } from "@/components/scoring/judge-realtime";
import { JudgeStandby } from "@/components/scoring/judge-standby";
import type { JudgeTieBreakVote } from "@/components/scoring/judge-tie-break-dialog";

export default async function JudgePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;
  if (!token) redirect("/judge/login");

  const session = await getJudgeSession(db, token);
  if (!session) redirect("/judge/login?error=expired");

  const { judgeId, eventId } = session;

  // Load event, judge, assignments, and any live tie-break vote awaiting this
  // judge's ballot in parallel. The vote check runs regardless of whether a
  // round is currently active — a cutoff tie is most often broken BETWEEN
  // rounds, right before the next one activates, when the judge is on standby.
  const [event, judge, assignments, activeVote] = await Promise.all([
    db.select().from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1).then((r) => r[0]),
    db.select().from(judges).where(eq(judges.id, judgeId)).limit(1).then((r) => r[0]),
    db
      .select({
        roundId: judgeAssignments.roundId,
        roundGroupId: judgeAssignments.roundGroupId,
      })
      .from(judgeAssignments)
      .where(
        and(eq(judgeAssignments.judgeId, judgeId), eq(judgeAssignments.eventId, eventId)),
      ),
    getActiveVoteForJudge(db, eventId, judgeId),
  ]);

  if (!event || !judge) redirect("/judge/login?error=invalid");

  let activeTieBreakVote: JudgeTieBreakVote | null = null;
  if (activeVote) {
    const tiedContestantRows = await db
      .select({
        id: contestants.id,
        displayNumber: contestants.displayNumber,
        displayName: contestants.displayName,
        photoUrl: contestants.photoUrl,
      })
      .from(contestants)
      .where(inArray(contestants.id, activeVote.tiedContestantIds));
    activeTieBreakVote = {
      id: activeVote.id,
      scope: activeVote.scope,
      rankLabel: activeVote.rankLabel,
      contestants: activeVote.tiedContestantIds.flatMap((id) => {
        const row = tiedContestantRows.find((c) => c.id === id);
        return row ? [row] : [];
      }),
    };
  }

  // Resolve the ACTIVE set the tabulator has opened for scoring. A judge sees a
  // set if they're assigned to it, assigned to its round (roundGroupId), are
  // event-scoped (an assignment with both scopes null), or have no assignments
  // at all. When nothing is active → standby screen.
  const assignedRoundIds = assignments.map((a) => a.roundId);
  const assignedGroupIds = assignments
    .map((a) => a.roundGroupId)
    .filter((id): id is string => id !== null);
  const eventScoped =
    assignments.length === 0 ||
    assignments.some((a) => a.roundId === null && a.roundGroupId === null);

  const activeSets = await db
    .select({ id: rounds.id, name: rounds.name, roundGroupId: rounds.roundGroupId })
    .from(rounds)
    .where(and(eq(rounds.eventId, eventId), eq(rounds.status, "active")))
    .orderBy(asc(rounds.position));

  const round =
    activeSets.find(
      (set) =>
        eventScoped ||
        assignedRoundIds.includes(set.id) ||
        (set.roundGroupId !== null && assignedGroupIds.includes(set.roundGroupId)),
    ) ?? null;

  if (!round) {
    // Distinguish "nothing active yet" from "every round is finished" so the
    // judge doesn't sit on a "waiting for the host" screen once scoring is
    // actually over — they'd otherwise keep expecting a next set to open.
    const allRoundStatuses = await db
      .select({ status: rounds.status })
      .from(rounds)
      .where(eq(rounds.eventId, eventId));
    const scoringComplete =
      allRoundStatuses.length > 0 &&
      allRoundStatuses.every((r) => r.status === "finished");

    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <JudgeRealtime eventId={eventId} judgeId={judgeId} />
        <JudgeStandby
          eventName={event.name}
          judgeName={judge.displayName}
          complete={scoringComplete}
          activeTieBreakVote={activeTieBreakVote}
        />
      </div>
    );
  }

  // Load contestants, criteria, scores, finalize state, and any pending unlock request.
  const [contestantRows, criteriaRows, scoreRows, finalizedRows, unlockRequestRows] = await Promise.all([
    db
      .select({
        id: contestants.id,
        displayNumber: contestants.displayNumber,
        displayName: contestants.displayName,
        category: contestants.category,
        photoUrl: contestants.photoUrl,
      })
      .from(contestants)
      .where(and(eq(contestants.eventId, eventId)))
      // Order by the contestant number (numeric). Non-numeric / empty numbers
      // sort last, then fall back to position and name.
      .orderBy(
        sql`nullif(regexp_replace(${contestants.displayNumber}, '\\D', '', 'g'), '')::int asc nulls last`,
        asc(contestants.position),
        asc(contestants.displayName),
      ),

    db
      .select({
        id: criteria.id,
        name: criteria.name,
        description: criteria.description,
        inputType: criteria.inputType,
        minValue: criteria.minValue,
        maxValue: criteria.maxValue,
        stepValue: criteria.stepValue,
        weight: criteria.weight,
      })
      .from(criteria)
      .where(and(eq(criteria.eventId, eventId), eq(criteria.roundId, round.id)))
      .orderBy(asc(criteria.position), asc(criteria.name)),

    db
      .select({
        contestantId: scoreRecords.contestantId,
        criterionId: scoreRecords.criterionId,
        value: scoreRecords.value,
        status: scoreRecords.status,
      })
      .from(scoreRecords)
      .where(
        and(
          eq(scoreRecords.eventId, eventId),
          eq(scoreRecords.roundId, round.id),
          eq(scoreRecords.judgeId, judgeId),
        ),
      ),

    db
      .select({ id: judgeSetSubmissions.id })
      .from(judgeSetSubmissions)
      .where(
        and(
          eq(judgeSetSubmissions.roundId, round.id),
          eq(judgeSetSubmissions.judgeId, judgeId),
        ),
      )
      .limit(1),

    db
      .select({ id: unlockRequests.id, status: unlockRequests.status })
      .from(unlockRequests)
      .where(
        and(
          eq(unlockRequests.roundId, round.id),
          eq(unlockRequests.judgeId, judgeId),
        ),
      )
      .limit(1),
  ]);

  const finalized = finalizedRows.length > 0;
  const unlockRequest = unlockRequestRows[0] ?? null;

  // Advancement-restricted rounds (e.g. a Final Q&A open only to the top 5)
  // carry a qualifier snapshot taken when the round was activated. Judges see
  // only the qualifiers — by contestant number by default (hiding the current
  // standings), or in rank order when the round is configured that way.
  let judgeContestants = contestantRows;
  if (round.roundGroupId) {
    const [group] = await db
      .select({
        advanceCount: roundGroups.advanceCount,
        advanceDisplayOrder: roundGroups.advanceDisplayOrder,
        qualifiedContestantIds: roundGroups.qualifiedContestantIds,
      })
      .from(roundGroups)
      .where(eq(roundGroups.id, round.roundGroupId))
      .limit(1);

    const qualifiedIds = group?.advanceCount != null ? group.qualifiedContestantIds : null;
    if (qualifiedIds && qualifiedIds.length > 0) {
      const qualifiedSet = new Set(qualifiedIds);
      judgeContestants = contestantRows.filter((c) => qualifiedSet.has(c.id));
      if (group.advanceDisplayOrder === "rank") {
        const rankIndex = new Map(qualifiedIds.map((id, index) => [id, index]));
        judgeContestants = [...judgeContestants].sort(
          (a, b) => (rankIndex.get(a.id) ?? 0) - (rankIndex.get(b.id) ?? 0),
        );
      }
    }
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <JudgeRealtime eventId={eventId} judgeId={judgeId} />
      <JudgeWorkspace
        judgeId={judgeId}
        judgeName={judge.displayName}
        eventId={eventId}
        eventName={event.name}
        eventLogoUrl={event.logoUrl}
        round={round}
        contestants={judgeContestants}
        criteria={criteriaRows.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          inputType: c.inputType,
          minValue: c.minValue,
          maxValue: c.maxValue,
          stepValue: c.stepValue,
          weight: c.weight,
        }))}
        existingScores={scoreRows.map((s) => ({
          contestantId: s.contestantId,
          criterionId: s.criterionId,
          value: s.value,
          status: s.status,
        }))}
        finalized={finalized}
        unlockRequestStatus={unlockRequest?.status ?? null}
        activeTieBreakVote={activeTieBreakVote}
      />
    </div>
  );
}
