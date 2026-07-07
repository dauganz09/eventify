import { randomBytes } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import type { db as DbType } from "@/db";
import { judgeSessions } from "@/db/schema";

export const JUDGE_SESSION_COOKIE = "judge_session";
const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const judgeSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
};

export interface JudgeSessionData {
  judgeId: string;
  eventId: string;
}

export async function createJudgeSession(
  database: typeof DbType,
  judgeId: string,
  eventId: string,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  await database.insert(judgeSessions).values({ token, judgeId, eventId, expiresAt });
  return token;
}

export async function getJudgeSession(
  database: typeof DbType,
  token: string,
): Promise<JudgeSessionData | null> {
  const now = new Date();
  const [row] = await database
    .select({ judgeId: judgeSessions.judgeId, eventId: judgeSessions.eventId })
    .from(judgeSessions)
    .where(and(eq(judgeSessions.token, token), gt(judgeSessions.expiresAt, now)))
    .limit(1);

  return row ?? null;
}

export async function deleteJudgeSession(
  database: typeof DbType,
  token: string,
): Promise<void> {
  await database.delete(judgeSessions).where(eq(judgeSessions.token, token));
}

/**
 * Returns the tokens of all currently-active (non-expired) sessions for a judge.
 * Used to enforce a single concurrent session: a judge may only be signed in on
 * one device at a time, which prevents a second party from operating the same
 * judge account and tampering with scores.
 */
export async function getActiveJudgeSessionTokens(
  database: typeof DbType,
  judgeId: string,
): Promise<string[]> {
  const now = new Date();
  const rows = await database
    .select({ token: judgeSessions.token })
    .from(judgeSessions)
    .where(and(eq(judgeSessions.judgeId, judgeId), gt(judgeSessions.expiresAt, now)));
  return rows.map((r) => r.token);
}

/**
 * Force-release every session for a judge (active or expired). Used by the
 * tabulator/admin "Release session" control when a judge is locked out (e.g.
 * their device died with a live session) so they can sign in fresh.
 */
export async function deleteAllJudgeSessions(
  database: typeof DbType,
  judgeId: string,
): Promise<void> {
  await database.delete(judgeSessions).where(eq(judgeSessions.judgeId, judgeId));
}
