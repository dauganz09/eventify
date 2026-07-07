import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { deleteSession, SESSION_COOKIE } from "@/lib/auth/local-session";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await deleteSession(db, token);
  }

  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ message: "Signed out." });
}
