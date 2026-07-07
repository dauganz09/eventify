import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  deleteJudgeSession,
  getJudgeSession,
  JUDGE_SESSION_COOKIE,
} from "@/lib/auth/judge-session";
import { publishEvent } from "@/lib/realtime/bus";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;

  if (token) {
    // Resolve event/judge before deleting so we can notify the tabulator.
    const session = await getJudgeSession(db, token);
    await deleteJudgeSession(db, token);
    if (session) {
      publishEvent(session.eventId, {
        type: "judge.session.changed",
        judgeId: session.judgeId,
        signedIn: false,
      });
    }
  }

  cookieStore.delete(JUDGE_SESSION_COOKIE);
  return NextResponse.json({ message: "Signed out." });
}
