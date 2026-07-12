import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { judgeSetSubmissions } from "@/db/schema";
import { resolveScoreSyncAuth } from "@/lib/scoring/score-sync-auth";
import { submitScoreOperation } from "@/lib/scoring/score-service";
import { publishResultsUpdated } from "@/lib/realtime/bus";
import { scoreOperationSchema } from "@/lib/validation/domain";

export async function POST(request: Request) {
  const auth = await resolveScoreSyncAuth(request);
  if (!auth) {
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

  if (auth.judgeId) {
    const [locked] = await db
      .select({ id: judgeSetSubmissions.id })
      .from(judgeSetSubmissions)
      .where(
        and(
          eq(judgeSetSubmissions.judgeId, auth.judgeId),
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
    actorUserId: auth.actorUserId,
    organizationId: auth.organizationId,
    judgeId: auth.judgeId,
    judgeEventId: auth.judgeEventId,
    input: parsed.data,
  });

  if (result.status === "synced") {
    publishResultsUpdated(parsed.data.eventId);
  }

  return NextResponse.json(result, {
    status: result.status === "conflict" ? 409 : 200,
  });
}
