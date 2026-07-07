import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestants, criteria, judgeSetSubmissions, roundGroups, rounds, scoreRecords } from "@/db/schema";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";
import { publishEvent } from "@/lib/realtime/bus";

/**
 * A judge certifies they're done scoring a set ("submit & lock"). Inserts a
 * judge_set_submissions row (idempotent on the unique (round, judge) index).
 * Once finalized, the judge cannot edit that set's scores — only a tabulator
 * can release the lock. Publishes a realtime event so the tabulator updates.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const session = await getJudgeSession(db, token);
  if (!session) {
    return NextResponse.json({ error: "Session expired." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const roundId = body && typeof body.roundId === "string" ? body.roundId : null;
  if (!roundId) {
    return NextResponse.json({ error: "Missing set." }, { status: 400 });
  }

  // The set must belong to this judge's event and be the active one.
  const [round] = await db
    .select({ id: rounds.id, status: rounds.status, roundGroupId: rounds.roundGroupId })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.eventId, session.eventId)))
    .limit(1);
  if (!round) {
    return NextResponse.json({ error: "Set not found." }, { status: 404 });
  }
  if (round.status !== "active") {
    return NextResponse.json(
      { error: "This set is not open for scoring." },
      { status: 409 },
    );
  }

  // Advancement-restricted rounds (e.g. a top-5 final) only field the
  // snapshotted qualifiers — the judge never sees anyone else, so the
  // completeness guard must count only them.
  let qualifiedIds: string[] | null = null;
  if (round.roundGroupId) {
    const [group] = await db
      .select({
        advanceCount: roundGroups.advanceCount,
        qualifiedContestantIds: roundGroups.qualifiedContestantIds,
      })
      .from(roundGroups)
      .where(eq(roundGroups.id, round.roundGroupId))
      .limit(1);
    if (group?.advanceCount != null && (group.qualifiedContestantIds?.length ?? 0) > 0) {
      qualifiedIds = group.qualifiedContestantIds!;
    }
  }

  // Fairness guard: a judge can only lock a set after scoring EVERY contestant
  // on EVERY criterion for that set.
  const [allContestantRows, criteriaRows, scoreRows] = await Promise.all([
    db
      .select({ id: contestants.id })
      .from(contestants)
      .where(eq(contestants.eventId, session.eventId)),
    db
      .select({ id: criteria.id })
      .from(criteria)
      .where(and(eq(criteria.eventId, session.eventId), eq(criteria.roundId, roundId))),
    db
      .select({
        contestantId: scoreRecords.contestantId,
        criterionId: scoreRecords.criterionId,
        value: scoreRecords.value,
      })
      .from(scoreRecords)
      .where(
        and(
          eq(scoreRecords.eventId, session.eventId),
          eq(scoreRecords.roundId, roundId),
          eq(scoreRecords.judgeId, session.judgeId),
          eq(scoreRecords.status, "submitted"),
        ),
      ),
  ]);

  const contestantRows = qualifiedIds
    ? allContestantRows.filter((c) => qualifiedIds.includes(c.id))
    : allContestantRows;

  if (criteriaRows.length > 0 && contestantRows.length > 0) {
    const criterionIds = criteriaRows.map((c) => c.id);
    const scoredByContestant = new Map<string, Set<string>>();
    for (const row of scoreRows) {
      if (row.value === null) continue;
      const set = scoredByContestant.get(row.contestantId) ?? new Set<string>();
      set.add(row.criterionId);
      scoredByContestant.set(row.contestantId, set);
    }
    const incomplete = contestantRows.filter((c) => {
      const scored = scoredByContestant.get(c.id);
      return !scored || criterionIds.some((id) => !scored.has(id));
    }).length;

    if (incomplete > 0) {
      return NextResponse.json(
        {
          error: `You still have ${incomplete} contestant${
            incomplete === 1 ? "" : "s"
          } left to score. Score everyone before locking.`,
        },
        { status: 409 },
      );
    }
  }

  await db
    .insert(judgeSetSubmissions)
    .values({ eventId: session.eventId, roundId, judgeId: session.judgeId })
    .onConflictDoNothing();

  publishEvent(session.eventId, {
    type: "judge.finalized",
    judgeId: session.judgeId,
    roundId,
    finalized: true,
  });

  return NextResponse.json({ ok: true });
}
