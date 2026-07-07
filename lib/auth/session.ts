import { cookies } from "next/headers";
import { db } from "@/db";
import { getSessionUser, SESSION_COOKIE } from "./local-session";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(db, token);
}
