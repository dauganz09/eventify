import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";

export default async function JudgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Allow the login page to render without a session
  // (Next.js layouts can't conditionally skip — we rely on the page to redirect
  //  when no session exists, but we still need to protect the workspace pages)
  const cookieStore = await cookies();
  const token = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;

  if (!token) {
    redirect("/judge/login");
  }

  const session = await getJudgeSession(db, token);

  if (!session) {
    redirect("/judge/login?error=expired");
  }

  return <>{children}</>;
}
