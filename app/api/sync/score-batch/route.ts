import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  collectUniqueRoundIds,
  findJudgeLockedRoundIds,
  resolveScoreSyncAuth,
} from "@/lib/scoring/score-sync-auth";
import { submitScoreBatch } from "@/lib/scoring/score-service";
import { publishResultsUpdated } from "@/lib/realtime/bus";
import { scoreBatchSchema } from "@/lib/validation/domain";

export async function POST(request: Request) {
  const auth = await resolveScoreSyncAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = scoreBatchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid score batch.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const operations = parsed.data.operations;

  if (auth.judgeId) {
    const lockedRoundIds = await findJudgeLockedRoundIds({
      judgeId: auth.judgeId,
      roundIds: collectUniqueRoundIds(operations),
    });

    if (lockedRoundIds.size > 0) {
      const blocked = operations.filter((operation) => lockedRoundIds.has(operation.roundId));
      if (blocked.length === operations.length) {
        return NextResponse.json(
          {
            error:
              "You have finalized this set. Ask the tabulator to release it if you need to make changes.",
            status: "locked",
          },
          { status: 423 },
        );
      }

      return NextResponse.json(
        {
          error: "Some scores belong to a finalized set.",
          status: "locked",
          blockedIdempotencyKeys: blocked.map((operation) => operation.idempotencyKey),
        },
        { status: 423 },
      );
    }
  }

  const results = await submitScoreBatch({
    database: db,
    actorUserId: auth.actorUserId,
    organizationId: auth.organizationId,
    inputs: operations,
  });

  const eventId = operations[0]!.eventId;
  if (results.some((result) => result.status === "synced")) {
    publishResultsUpdated(eventId);
  }

  return NextResponse.json({ results });
}
