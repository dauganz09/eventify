import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { judgeSetSubmissions, memberships } from "@/db/schema";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";
import { hasPermission, type AppRole } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import type { ScoreOperationInput } from "@/lib/validation/domain";

export interface ScoreSyncAuthContext {
  actorUserId: string | null;
  organizationId: string;
  judgeId: string | null;
  /**
   * The single event a judge session is bound to (null for a dashboard-user
   * actor, who isn't scoped to one event). Every operation in the request
   * must target this event — enforced by the caller.
   */
  judgeEventId: string | null;
}

/**
 * Resolves who's allowed to submit scores and what they're allowed to submit
 * as. Two actor types:
 *  - A dashboard user (owner/admin/tabulator) must actually belong to the
 *    claimed organization with a role that carries "score.adjust" — the
 *    org id is client-supplied (a header), so it cannot be trusted on its own.
 *  - A judge is fully scoped server-side from their session token: which
 *    judge, which event, which org — none of that is client-supplied.
 */
export async function resolveScoreSyncAuth(
  request: Request,
): Promise<ScoreSyncAuthContext | null> {
  const cookieStore = await cookies();
  const user = await getCurrentUser();

  if (user) {
    const organizationId = request.headers.get("x-organization-id");
    if (!organizationId) return null;

    const membershipRows = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.organizationId, organizationId)));
    if (membershipRows.length === 0) return null;

    const roles = membershipRows.map((row) => row.role as AppRole);
    const authorized = roles.some((role) =>
      hasPermission({ userId: user.id, organizationId, roles: [role] }, "score.adjust"),
    );
    if (!authorized) return null;

    return { actorUserId: user.id, organizationId, judgeId: null, judgeEventId: null };
  }

  const judgeToken = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;
  if (!judgeToken) return null;

  const judgeSession = await getJudgeSession(db, judgeToken);
  if (!judgeSession) return null;

  return {
    actorUserId: null,
    organizationId: judgeSession.organizationId,
    judgeId: judgeSession.judgeId,
    judgeEventId: judgeSession.eventId,
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
