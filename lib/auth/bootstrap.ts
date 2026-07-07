import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, userProfiles } from "@/db/schema";

function createOrganizationSlug(email: string, userId: string) {
  const localPart = email.split("@")[0]?.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const suffix = userId.slice(0, 8);
  return `${localPart || "org"}-${suffix}`;
}

export async function bootstrapUserAccount(user: { id: string; email: string }) {
  const displayName = user.email.split("@")[0] ?? user.email;

  await db
    .insert(userProfiles)
    .values({ id: user.id, email: user.email, displayName })
    .onConflictDoUpdate({
      target: userProfiles.id,
      set: { email: user.email, updatedAt: new Date() },
    });

  const existingMembership = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);

  if (existingMembership.length > 0) {
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, existingMembership[0].organizationId))
      .limit(1);
    return organization ?? null;
  }

  const [organization] = await db
    .insert(organizations)
    .values({
      name: `${displayName}'s Organization`,
      slug: createOrganizationSlug(user.email, user.id),
    })
    .returning();

  await db.insert(memberships).values({
    organizationId: organization.id,
    userId: user.id,
    role: "owner",
  });

  return organization;
}
