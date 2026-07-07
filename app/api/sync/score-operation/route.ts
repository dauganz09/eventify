import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, judgeSetSubmissions } from "@/db/schema";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";
import { getCurrentUser } from "@/lib/auth/session";
import { submitScoreOperation } from "@/lib/scoring/score-service";
import { publishEvent } from "@/lib/realtime/bus";
import { scoreOperationSchema } from "@/lib/validation/domain";

export async function POST(request: Request) {
  const cookieStore = await cookies();

  // Support both regular user sessions and judge sessions
  let actorUserId: string | null = null;
  let organizationId: string | null = null;
  let judgeId: string | null = null;

  const user = await getCurrentUser();

  if (user) {
    actorUserId = user.id;
    organizationId = request.headers.get("x-organization-id");
  } else {
    // Try judge session
    const judgeToken = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;
    if (judgeToken) {
      const judgeSession = await getJudgeSession(db, judgeToken);
      if (judgeSession) {
        judgeId = judgeSession.judgeId;
        // Look up organizationId from the event
        const [event] = await db
          .select({ organizationId: events.organizationId })
          .from(events)
          .where(eq(events.id, judgeSession.eventId))
          .limit(1);
        organizationId = event?.organizationId ?? null;
      }
    }
  }

  if (!organizationId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = scoreOperationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid score operation.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Submit & lock: once a judge has finalized a set, refuse further edits to it.
  if (judgeId) {
    const [locked] = await db
      .select({ id: judgeSetSubmissions.id })
      .from(judgeSetSubmissions)
      .where(
        and(
          eq(judgeSetSubmissions.judgeId, judgeId),
          eq(judgeSetSubmissions.roundId, parsed.data.roundId),
        ),
      )
      .limit(1);
    if (locked) {
      return NextResponse.json(
        {
          error:
            "You have finalized this set. Ask the tabulator to release it if you need to make changes.",
          status: "locked",
        },
        { status: 423 },
      );
    }
  }

  const result = await submitScoreOperation({
    database: db,
    actorUserId,
    organizationId,
    input: parsed.data,
  });

  // Tell the tabulator console to refresh live standings. Skip on conflict —
  // a conflicting write didn't change the persisted scores.
  if (result.status === "synced") {
    publishEvent(parsed.data.eventId, { type: "results.updated" });
  }

  return NextResponse.json(result, {
    status: result.status === "conflict" ? 409 : 200,
  });
}
