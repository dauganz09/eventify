import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { judgeSetSubmissions } from "@/db/schema";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";
import { getCurrentUser } from "@/lib/auth/session";
import type { ScoreOperationInput } from "@/lib/validation/domain";

export interface ScoreSyncAuthContext {
  actorUserId: string | null;
  organizationId: string;
  judgeId: string | null;
}

export async function resolveScoreSyncAuth(
  request: Request,
): Promise<ScoreSyncAuthContext | null> {
  const cookieStore = await cookies();
  const user = await getCurrentUser();

  if (user) {
    const organizationId = request.headers.get("x-organization-id");
    if (!organizationId) return null;
    return { actorUserId: user.id, organizationId, judgeId: null };
  }

  const judgeToken = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;
  if (!judgeToken) return null;

  const judgeSession = await getJudgeSession(db, judgeToken);
  if (!judgeSession) return null;

  return {
    actorUserId: null,
    organizationId: judgeSession.organizationId,
    judgeId: judgeSession.judgeId,
  };
}

/** Refuse writes to sets the judge has already finalized ("submit & lock"). */
export async function findJudgeLockedRoundIds(params: {
  judgeId: string;
  roundIds: string[];
}): Promise<Set<string>> {
  if (params.roundIds.length === 0) return new Set();

  const rows = await db
    .select({ roundId: judgeSetSubmissions.roundId })
    .from(judgeSetSubmissions)
    .where(
      and(
        eq(judgeSetSubmissions.judgeId, params.judgeId),
        inArray(judgeSetSubmissions.roundId, params.roundIds),
      ),
    );

  return new Set(rows.map((row) => row.roundId));
}

export function collectUniqueRoundIds(operations: ScoreOperationInput[]): string[] {
  return [...new Set(operations.map((operation) => operation.roundId))];
}
