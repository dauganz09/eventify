import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, judgeSetSubmissions, rounds, unlockRequests } from "@/db/schema";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";
import { publishEvent } from "@/lib/realtime/bus";

/**
 * A judge requests that their "submit & lock" be released so they can edit
 * scores again. Creates or replaces a pending unlock_request row for this
 * (round, judge). The tabulator sees it in their console and can approve or
 * reject it.
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
  const reason = body && typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;

  if (!roundId) {
    return NextResponse.json({ error: "Missing set." }, { status: 400 });
  }

  // Verify the round belongs to this judge's event.
  const [round] = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.eventId, session.eventId)))
    .limit(1);
  if (!round) {
    return NextResponse.json({ error: "Set not found." }, { status: 404 });
  }

  // Judge must be finalized on this set to request an unlock.
  const [submission] = await db
    .select({ id: judgeSetSubmissions.id })
    .from(judgeSetSubmissions)
    .where(
      and(
        eq(judgeSetSubmissions.roundId, roundId),
        eq(judgeSetSubmissions.judgeId, session.judgeId),
      ),
    )
    .limit(1);
  if (!submission) {
    return NextResponse.json({ error: "You have not locked this set." }, { status: 409 });
  }

  // Upsert: replace any existing request (re-request after a rejection, etc.)
  await db
    .insert(unlockRequests)
    .values({
      eventId: session.eventId,
      roundId,
      judgeId: session.judgeId,
      status: "pending",
      reason: reason || null,
    })
    .onConflictDoUpdate({
      target: [unlockRequests.roundId, unlockRequests.judgeId],
      set: {
        status: "pending",
        reason: reason || null,
        resolvedAt: null,
        resolvedBy: null,
      },
    });

  // Notify the tabulator console via realtime so they see the badge update.
  const [event] = await db
    .select({ organizationId: events.organizationId })
    .from(events)
    .where(eq(events.id, session.eventId))
    .limit(1);

  if (event) {
    publishEvent(session.eventId, {
      type: "judge.unlock_requested",
      judgeId: session.judgeId,
      roundId,
    });
  }

  return NextResponse.json({ ok: true });
}
