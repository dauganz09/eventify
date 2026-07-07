import type { db } from "@/db";
import { auditLogs } from "@/db/schema";

export async function writeAuditLog(params: {
  database: typeof db;
  organizationId?: string;
  eventId?: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  const [auditLog] = await params.database
    .insert(auditLogs)
    .values({
      organizationId: params.organizationId,
      eventId: params.eventId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata ?? {},
    })
    .returning();

  return auditLog;
}
