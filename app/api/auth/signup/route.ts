import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/db";
import { localCredentials, memberships, organizations, userProfiles } from "@/db/schema";
import {
  createSession,
  hashPassword,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/local-session";

const schema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(6),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const existing = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.email, email))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const userId = randomUUID();
  const displayName = email.split("@")[0] ?? email;
  const passwordHash = await hashPassword(password);
  const orgSlug = `${displayName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${userId.slice(0, 8)}`;

  await db.transaction(async (tx) => {
    await tx.insert(userProfiles).values({ id: userId, email, displayName });
    await tx.insert(localCredentials).values({ userId, passwordHash });

    const [org] = await tx
      .insert(organizations)
      .values({ name: `${displayName}'s Organization`, slug: orgSlug })
      .returning();

    await tx.insert(memberships).values({ organizationId: org.id, userId, role: "owner" });
  });

  const token = await createSession(db, userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions);

  return NextResponse.json({ message: "Account created." });
}
