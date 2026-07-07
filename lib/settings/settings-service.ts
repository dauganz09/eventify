import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { db } from "@/db";
import {
  localCredentials,
  memberships,
  organizations,
  userProfiles,
} from "@/db/schema";
import type { AppRole } from "@/lib/auth/permissions";
import {
  hashPassword,
  verifyPassword,
} from "@/lib/auth/local-session";
import {
  organizationUpdateSchema,
  passwordChangeSchema,
  profileUpdateSchema,
  staffAccountCreateSchema,
} from "@/lib/validation/domain";

export async function updateProfile(params: {
  database: typeof db;
  userId: string;
  input: unknown;
}) {
  const input = profileUpdateSchema.parse(params.input);

  const [profile] = await params.database
    .update(userProfiles)
    .set({ displayName: input.displayName, updatedAt: new Date() })
    .where(eq(userProfiles.id, params.userId))
    .returning();

  return profile ?? null;
}

export async function updateOrganizationName(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = organizationUpdateSchema.parse(params.input);

  const [organization] = await params.database
    .update(organizations)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(organizations.id, params.organizationId))
    .returning();

  return organization ?? null;
}

/**
 * Verifies the current password before writing a new scrypt hash. Throws a
 * user-facing Error when the current password is wrong so the calling action
 * can surface it via toast.
 */
export async function changePassword(params: {
  database: typeof db;
  userId: string;
  input: unknown;
}) {
  const input = passwordChangeSchema.parse(params.input);

  const [credential] = await params.database
    .select()
    .from(localCredentials)
    .where(eq(localCredentials.userId, params.userId))
    .limit(1);

  if (!credential) {
    throw new Error("No password is set for this account.");
  }

  const valid = await verifyPassword(
    input.currentPassword,
    credential.passwordHash,
  );
  if (!valid) {
    throw new Error("Current password is incorrect.");
  }

  const passwordHash = await hashPassword(input.newPassword);
  await params.database
    .update(localCredentials)
    .set({ passwordHash })
    .where(eq(localCredentials.userId, params.userId));
}

/**
 * Admin-created tabulator/staff account: sets an email + password directly
 * (no invite email — this app has no mailer). The membership is inserted
 * against the calling admin's organization up front, so when the new user
 * first logs in, `bootstrapUserAccount` finds an existing membership and
 * skips its auto-create-a-new-organization path.
 */
export async function createStaffAccount(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = staffAccountCreateSchema.parse(params.input);

  const existing = await params.database
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.email, input.email))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("An account with this email already exists.");
  }

  const userId = randomUUID();
  const displayName = input.displayName?.trim() || input.email.split("@")[0];
  const passwordHash = await hashPassword(input.password);

  await params.database.transaction(async (tx) => {
    await tx.insert(userProfiles).values({ id: userId, email: input.email, displayName });
    await tx.insert(localCredentials).values({ userId, passwordHash });
    await tx.insert(memberships).values({
      organizationId: params.organizationId,
      userId,
      role: "tabulator",
    });
  });

  return { userId, email: input.email, displayName };
}

export interface OrganizationMember {
  userId: string;
  displayName: string | null;
  email: string;
  roles: AppRole[];
}

export async function listOrganizationMembers(params: {
  database: typeof db;
  organizationId: string;
}): Promise<OrganizationMember[]> {
  const rows = await params.database
    .select({
      userId: memberships.userId,
      role: memberships.role,
      displayName: userProfiles.displayName,
      email: userProfiles.email,
    })
    .from(memberships)
    .innerJoin(userProfiles, eq(userProfiles.id, memberships.userId))
    .where(eq(memberships.organizationId, params.organizationId))
    .orderBy(asc(userProfiles.email));

  // Collapse multiple role rows per user into a single member entry.
  const byUser = new Map<string, OrganizationMember>();
  for (const row of rows) {
    const existing = byUser.get(row.userId);
    if (existing) {
      existing.roles.push(row.role);
    } else {
      byUser.set(row.userId, {
        userId: row.userId,
        displayName: row.displayName,
        email: row.email,
        roles: [row.role],
      });
    }
  }

  return [...byUser.values()];
}
