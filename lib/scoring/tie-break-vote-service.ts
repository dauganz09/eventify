import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { judgeAssignments, judges, roundGroups, rounds, tieBreakBallots, tieBreakVotes } from "@/db/schema";
import { resolveBallots, tieKeyFor } from "@/lib/scoring/ranking";
import { saveTieBreak, type TieBreakScope } from "@/lib/scoring/tie-break-service";

export type TieBreakVoteStatus = "open" | "resolved" | "cancelled";

export interface OpenVoteSummary {
  id: string;
  scope: TieBreakScope;
  contextId: string | null;
  tiedContestantIds: string[];
  rankLabel: string;
  eligibleJudgeIds: string[];
  votedJudgeIds: string[];
  openedAt: Date;
}

/**
 * Judges assigned to a round group — same scoping rules as the tabulator's
 * scoring matrix (`judgesForSet`-style logic in tabulator-service.ts /
 * scripts/generate-random-scores.ts): a judge is in scope if they're assigned
 * to this specific round group, to one of its sets, or event-wide (both
 * null). When there are no assignment rows at all, every active judge scores
 * everything, so fall back to all active judges.
 */
async function judgeIdsForRoundGroup(
  database: typeof db,
  eventId: string,
  groupId: string,
): Promise<string[]> {
  const [setRows, assignmentRows, judgeRows] = await Promise.all([
    database
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.eventId, eventId), eq(rounds.roundGroupId, groupId))),
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

  const setIds = new Set(setRows.map((s) => s.id));
  const activeJudgeIds = new Set(
    judgeRows.filter((j) => j.isActive && !j.isSystem).map((j) => j.id),
  );

  const ids = new Set<string>();
  for (const assignment of assignmentRows) {
    const eventWide = assignment.roundId === null && assignment.roundGroupId === null;
    const matchesGroup = assignment.roundGroupId === groupId;
    const matchesSet = assignment.roundId !== null && setIds.has(assignment.roundId);
    if ((eventWide || matchesGroup || matchesSet) && activeJudgeIds.has(assignment.judgeId)) {
      ids.add(assignment.judgeId);
    }
  }

  if (ids.size === 0) return [...activeJudgeIds];
  return [...ids];
}

/**
 * Who's eligible to vote on a given tie: judges assigned to the rank-order
 * round itself ("rank_order"), to the rounds that produced the tie
 * ("advancement" — every group positioned before the target group), or to
 * every finished round ("standings" — the event's final result).
 */
export async function resolveEligibleJudges(
  database: typeof db,
  eventId: string,
  scope: TieBreakScope,
  contextId: string | null,
): Promise<string[]> {
  const groupRows = await database
    .select({ id: roundGroups.id, position: roundGroups.position, status: roundGroups.status })
    .from(roundGroups)
    .where(eq(roundGroups.eventId, eventId));

  let targetGroupIds: string[];
  if (scope === "rank_order") {
    if (!contextId) return [];
    targetGroupIds = [contextId];
  } else if (scope === "advancement") {
    if (!contextId) return [];
    const target = groupRows.find((g) => g.id === contextId);
    if (!target) return [];
    targetGroupIds = groupRows.filter((g) => g.position < target.position).map((g) => g.id);
  } else {
    targetGroupIds = groupRows.filter((g) => g.status === "finished").map((g) => g.id);
  }
  if (targetGroupIds.length === 0) return [];

  const judgeIdSets = await Promise.all(
    targetGroupIds.map((id) => judgeIdsForRoundGroup(database, eventId, id)),
  );
  return [...new Set(judgeIdSets.flat())];
}

/**
 * Opens a live vote for one tied cluster. Any other open vote for the exact
 * same (eventId, scope, contextId, tied contestant set) is cancelled first —
 * only one live vote per tie decision at a time. A different cluster tied in
 * the same round (e.g. a separate pair fighting for a different rank) keeps
 * its own open vote untouched.
 */
export async function openVote(params: {
  database: typeof db;
  eventId: string;
  scope: TieBreakScope;
  contextId: string | null;
  tiedContestantIds: string[];
  /** e.g. "rank 5" or "rank sum 8" — shown to judges so they know what they're voting on. */
  rankLabel: string;
  actorUserId: string | null;
}): Promise<{ id: string; eligibleJudgeIds: string[] }> {
  const { database, eventId, scope, contextId, tiedContestantIds, rankLabel, actorUserId } = params;

  if (tiedContestantIds.length < 2) {
    throw new Error("A tie-break vote needs at least two tied contestants.");
  }

  const eligibleJudgeIds = await resolveEligibleJudges(database, eventId, scope, contextId);
  if (eligibleJudgeIds.length === 0) {
    throw new Error("No judges are assigned to this round to vote.");
  }

  return database.transaction(async (tx) => {
    const openRows = await tx
      .select({
        id: tieBreakVotes.id,
        contextId: tieBreakVotes.contextId,
        tiedContestantIds: tieBreakVotes.tiedContestantIds,
      })
      .from(tieBreakVotes)
      .where(
        and(
          eq(tieBreakVotes.eventId, eventId),
          eq(tieBreakVotes.scope, scope),
          eq(tieBreakVotes.status, "open"),
        ),
      );
    const key = tieKeyFor(tiedContestantIds);
    const staleIds = openRows
      .filter((row) => row.contextId === contextId && tieKeyFor(row.tiedContestantIds) === key)
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await tx
        .update(tieBreakVotes)
        .set({ status: "cancelled", resolvedAt: new Date() })
        .where(inArray(tieBreakVotes.id, staleIds));
    }

    const [created] = await tx
      .insert(tieBreakVotes)
      .values({
        eventId,
        scope,
        contextId,
        tiedContestantIds,
        rankLabel,
        eligibleJudgeIds,
        openedByUserId: actorUserId,
      })
      .returning({ id: tieBreakVotes.id });

    return { id: created.id, eligibleJudgeIds };
  });
}

/**
 * Records one judge's ballot (upserted — a judge can change their mind any
 * time before the vote resolves). Auto-resolves once every eligible judge has
 * voted.
 */
export async function castBallot(params: {
  database: typeof db;
  voteId: string;
  judgeId: string;
  order: string[];
}): Promise<{ resolved: boolean }> {
  const { database, voteId, judgeId, order } = params;

  const [vote] = await database
    .select()
    .from(tieBreakVotes)
    .where(eq(tieBreakVotes.id, voteId))
    .limit(1);
  if (!vote) throw new Error("Vote not found.");
  if (vote.status !== "open") throw new Error("This vote is no longer open.");
  if (!vote.eligibleJudgeIds.includes(judgeId)) {
    throw new Error("You are not eligible to vote on this tie.");
  }

  const isExactPermutation =
    order.length === vote.tiedContestantIds.length &&
    new Set(order).size === order.length &&
    vote.tiedContestantIds.every((id) => order.includes(id));
  if (!isExactPermutation) {
    throw new Error("Your ranking must include exactly the tied contestants, once each.");
  }

  await database
    .insert(tieBreakBallots)
    .values({ voteId, judgeId, orderedContestantIds: order })
    .onConflictDoUpdate({
      target: [tieBreakBallots.voteId, tieBreakBallots.judgeId],
      set: { orderedContestantIds: order, submittedAt: new Date() },
    });

  const ballotRows = await database
    .select({ judgeId: tieBreakBallots.judgeId })
    .from(tieBreakBallots)
    .where(eq(tieBreakBallots.voteId, voteId));
  const allVoted = vote.eligibleJudgeIds.every((id) => ballotRows.some((b) => b.judgeId === id));

  if (allVoted) {
    await resolveVote({ database, voteId, actorUserId: null });
    return { resolved: true };
  }
  return { resolved: false };
}

/**
 * Resolves a vote with whatever ballots exist right now — called
 * automatically once every eligible judge has voted, or by the tabulator's
 * "resolve now" escape hatch for a partial result. Writes into `tie_breaks`
 * with `method: "judge_vote"` on a clean majority; an evenly-split aggregate
 * marks the vote resolved but leaves no override — the tie stays open for a
 * manual break.
 */
export async function resolveVote(params: {
  database: typeof db;
  voteId: string;
  actorUserId: string | null;
}): Promise<{ order: string[] | null }> {
  const { database, voteId, actorUserId } = params;

  const [vote] = await database
    .select()
    .from(tieBreakVotes)
    .where(eq(tieBreakVotes.id, voteId))
    .limit(1);
  if (!vote) throw new Error("Vote not found.");
  if (vote.status !== "open") return { order: null };

  const ballots = await database
    .select({ orderedContestantIds: tieBreakBallots.orderedContestantIds })
    .from(tieBreakBallots)
    .where(eq(tieBreakBallots.voteId, voteId));
  const { order } = resolveBallots(vote.tiedContestantIds, ballots);

  await database
    .update(tieBreakVotes)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(tieBreakVotes.id, voteId));

  if (order) {
    await saveTieBreak({
      database,
      eventId: vote.eventId,
      scope: vote.scope as TieBreakScope,
      contextId: vote.contextId,
      tiedContestantIds: vote.tiedContestantIds,
      order,
      method: "judge_vote",
      note: `Judge vote — ${ballots.length} of ${vote.eligibleJudgeIds.length} judge(s) cast a ballot.`,
      actorUserId,
    });
  }

  return { order };
}

/** Cancels an open vote outright — no `tie_breaks` write. */
export async function cancelVote(params: { database: typeof db; voteId: string }): Promise<void> {
  await params.database
    .update(tieBreakVotes)
    .set({ status: "cancelled", resolvedAt: new Date() })
    .where(and(eq(tieBreakVotes.id, params.voteId), eq(tieBreakVotes.status, "open")));
}

/** All of an event's currently-open votes, with live ballot counts for the tabulator's tally UI. */
export async function listOpenVotes(database: typeof db, eventId: string): Promise<OpenVoteSummary[]> {
  const voteRows = await database
    .select()
    .from(tieBreakVotes)
    .where(and(eq(tieBreakVotes.eventId, eventId), eq(tieBreakVotes.status, "open")));
  if (voteRows.length === 0) return [];

  const voteIds = voteRows.map((v) => v.id);
  const ballotRows = await database
    .select({ voteId: tieBreakBallots.voteId, judgeId: tieBreakBallots.judgeId })
    .from(tieBreakBallots)
    .where(inArray(tieBreakBallots.voteId, voteIds));

  const votedByVote = new Map<string, string[]>();
  for (const ballot of ballotRows) {
    const arr = votedByVote.get(ballot.voteId) ?? [];
    arr.push(ballot.judgeId);
    votedByVote.set(ballot.voteId, arr);
  }

  return voteRows.map((v) => ({
    id: v.id,
    scope: v.scope as TieBreakScope,
    contextId: v.contextId,
    tiedContestantIds: v.tiedContestantIds,
    rankLabel: v.rankLabel,
    eligibleJudgeIds: v.eligibleJudgeIds,
    votedJudgeIds: votedByVote.get(v.id) ?? [],
    openedAt: v.openedAt,
  }));
}

/** The one open vote (if any) a judge is eligible for and hasn't voted on yet. */
export async function getActiveVoteForJudge(
  database: typeof db,
  eventId: string,
  judgeId: string,
): Promise<{
  id: string;
  scope: TieBreakScope;
  contextId: string | null;
  tiedContestantIds: string[];
  rankLabel: string;
} | null> {
  const voteRows = await database
    .select({
      id: tieBreakVotes.id,
      scope: tieBreakVotes.scope,
      contextId: tieBreakVotes.contextId,
      tiedContestantIds: tieBreakVotes.tiedContestantIds,
      rankLabel: tieBreakVotes.rankLabel,
      eligibleJudgeIds: tieBreakVotes.eligibleJudgeIds,
    })
    .from(tieBreakVotes)
    .where(and(eq(tieBreakVotes.eventId, eventId), eq(tieBreakVotes.status, "open")));

  const eligible = voteRows.find((v) => v.eligibleJudgeIds.includes(judgeId));
  if (!eligible) return null;

  const [existingBallot] = await database
    .select({ id: tieBreakBallots.id })
    .from(tieBreakBallots)
    .where(and(eq(tieBreakBallots.voteId, eligible.id), eq(tieBreakBallots.judgeId, judgeId)))
    .limit(1);
  if (existingBallot) return null;

  return {
    id: eligible.id,
    scope: eligible.scope as TieBreakScope,
    contextId: eligible.contextId,
    tiedContestantIds: eligible.tiedContestantIds,
    rankLabel: eligible.rankLabel,
  };
}
