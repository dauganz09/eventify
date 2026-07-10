import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { publishEvent, publishResultsUpdated } from "@/lib/realtime/bus";
import { castBallot } from "@/lib/scoring/tie-break-vote-service";
import { castTieBreakVoteSchema } from "@/lib/validation/domain";

/**
 * A judge casts (or changes) their ballot for an open "ask the judges"
 * tie-break vote. Auto-resolves the vote once every eligible judge has voted.
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
  const parsed = castTieBreakVoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ballot." }, { status: 400 });
  }

  let resolved: boolean;
  try {
    ({ resolved } = await castBallot({
      database: db,
      voteId: parsed.data.voteId,
      judgeId: session.judgeId,
      order: parsed.data.order,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cast vote.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // The tabulator's live tally rides the existing results.updated ->
  // snapshot-refresh path (openTieBreakVotes is part of that snapshot) rather
  // than a dedicated event — same debounced, already-safe mechanism any other
  // score change uses.
  publishResultsUpdated(session.eventId);
  if (resolved) {
    publishEvent(session.eventId, { type: "tie_break_vote.resolved", voteId: parsed.data.voteId });
  }

  await writeAuditLog({
    database: db,
    organizationId: session.organizationId,
    eventId: session.eventId,
    action: "ranking.tie_break_vote_cast",
    entityType: "event",
    entityId: session.eventId,
    metadata: {
      source: "judge",
      judgeId: session.judgeId,
      voteId: parsed.data.voteId,
      order: parsed.data.order,
      resolved,
    },
  });

  return NextResponse.json({ ok: true, resolved });
}
