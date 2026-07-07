import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { and, eq, gt } from "drizzle-orm";
import type { db as DbType } from "@/db";
import { sessions, userProfiles } from "@/db/schema";

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = "session_token";
const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, storedHash] = stored.split(":");
  if (!salt || !storedHash) return false;
  try {
    const hash = (await scryptAsync(password, salt, 64)) as Buffer;
    return timingSafeEqual(hash, Buffer.from(storedHash, "hex"));
  } catch {
    return false;
  }
}

export async function createSession(
  database: typeof DbType,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  await database.insert(sessions).values({ token, userId, expiresAt });
  return token;
}

export async function getSessionUser(
  database: typeof DbType,
  token: string,
): Promise<{ id: string; email: string } | null> {
  const now = new Date();
  const rows = await database
    .select({ id: userProfiles.id, email: userProfiles.email })
    .from(sessions)
    .innerJoin(userProfiles, eq(sessions.userId, userProfiles.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1);

  return rows[0] ?? null;
}

export async function deleteSession(
  database: typeof DbType,
  token: string,
): Promise<void> {
  await database.delete(sessions).where(eq(sessions.token, token));
}
