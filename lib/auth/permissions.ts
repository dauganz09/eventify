import { z } from "zod";
import { roleSchema } from "@/lib/validation/domain";

export type AppRole = z.infer<typeof roleSchema>;

export type Permission =
  | "organization.manage"
  | "member.manage"
  | "event.manage"
  | "event.view"
  | "judge.score"
  | "score.review"
  | "score.adjust"
  | "report.export"
  | "audit.view";

const rolePermissions = {
  owner: [
    "organization.manage",
    "member.manage",
    "event.manage",
    "event.view",
    "score.review",
    "score.adjust",
    "report.export",
    "audit.view",
  ],
  admin: [
    "member.manage",
    "event.manage",
    "event.view",
    "score.review",
    "score.adjust",
    "report.export",
  ],
  // Staff/tabulator accounts: scoring dashboard + reports only. No
  // event.view — they must not see the Events section at all.
  tabulator: ["score.review", "score.adjust", "report.export"],
  judge: ["event.view", "judge.score"],
  viewer: ["event.view"],
  auditor: ["event.view", "audit.view", "report.export"],
} satisfies Record<AppRole, readonly Permission[]>;

export interface AuthorizationContext {
  userId: string;
  organizationId: string;
  roles: AppRole[];
}

export function hasPermission(
  context: AuthorizationContext,
  permission: Permission,
) {
  return context.roles.some((role) =>
    (rolePermissions[role] as readonly Permission[]).includes(permission),
  );
}

export function assertPermission(
  context: AuthorizationContext,
  permission: Permission,
) {
  if (!hasPermission(context, permission)) {
    throw new Error(`Missing required permission: ${permission}`);
  }
}
