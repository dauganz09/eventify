import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { judges } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/local-session";
import { publishEvent } from "@/lib/realtime/bus";
import {
  createJudgeSession,
  deleteJudgeSession,
  getActiveJudgeSessionTokens,
  judgeSessionCookieOptions,
  JUDGE_SESSION_COOKIE,
} from "@/lib/auth/judge-session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  const { username, password } = body;

  // Look up judge by username globally — usernames are unique across all judges
  const [judge] = await db
    .select({ id: judges.id, eventId: judges.eventId, passwordHash: judges.passwordHash, isActive: judges.isActive })
    .from(judges)
    .where(eq(judges.username, username.trim()))
    .limit(1);

  if (!judge || !judge.passwordHash) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  if (!judge.isActive) {
    return NextResponse.json({ error: "This judge account is inactive." }, { status: 403 });
  }

  const valid = await verifyPassword(password, judge.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const cookieStore = await cookies();
  const ownToken = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;

  // Single active session per judge (anti-tampering): if this account is
  // already signed in on another device, refuse the new login. The judge's own
  // device (matching the existing cookie) is allowed to re-authenticate.
  const activeTokens = await getActiveJudgeSessionTokens(db, judge.id);
  const otherDeviceTokens = activeTokens.filter((t) => t !== ownToken);
  if (otherDeviceTokens.length > 0) {
    return NextResponse.json(
      {
        error:
          "This account is already signed in on another device. Sign out there first, or ask the tabulator to release the session.",
      },
      { status: 409 },
    );
  }

  // Re-auth from the same device: drop the stale session before issuing a new one.
  if (ownToken) {
    await deleteJudgeSession(db, ownToken);
  }

  const sessionToken = await createJudgeSession(db, judge.id, judge.eventId);
  cookieStore.set(JUDGE_SESSION_COOKIE, sessionToken, judgeSessionCookieOptions);

  // Let the tabulator console update its judge session column live.
  publishEvent(judge.eventId, {
    type: "judge.session.changed",
    judgeId: judge.id,
    signedIn: true,
  });

  return NextResponse.json({ ok: true });
}
