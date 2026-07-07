import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, userProfiles } from "@/db/schema";
import { bootstrapUserAccount } from "@/lib/auth/bootstrap";
import {
  assertPermission,
  hasPermission,
  type AppRole,
  type AuthorizationContext,
  type Permission,
} from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

export interface AuthContext {
  userId: string;
  email: string;
  profile: typeof userProfiles.$inferSelect;
  organization: typeof organizations.$inferSelect;
  roles: AppRole[];
  authorization: AuthorizationContext;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  await bootstrapUserAccount(user);

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.id, user.id))
    .limit(1);

  if (!profile) return null;

  const membershipRows = await db
    .select({
      role: memberships.role,
      organizationId: memberships.organizationId,
    })
    .from(memberships)
    .where(eq(memberships.userId, user.id));

  if (membershipRows.length === 0) return null;

  const primaryMembership = membershipRows[0];
  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, primaryMembership.organizationId))
    .limit(1);

  if (!organization) return null;

  const roles = membershipRows.map((row) => row.role);

  return {
    userId: user.id,
    email: user.email ?? profile.email,
    profile,
    organization,
    roles,
    authorization: {
      userId: user.id,
      organizationId: organization.id,
      roles,
    },
  };
}

export async function requireAuthContext(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) redirect("/admin/login");
  return context;
}

export async function requirePermission(permission: Permission) {
  const context = await requireAuthContext();
  assertPermission(context.authorization, permission);
  return context;
}

export function canManageEvents(context: AuthContext) {
  return hasPermission(context.authorization, "event.manage");
}
