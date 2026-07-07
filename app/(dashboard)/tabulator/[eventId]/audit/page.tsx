import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, events, userProfiles } from "@/db/schema";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { verifyScoreEventChain } from "@/lib/scoring/score-chain";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuditLogTable, type AuditRow } from "@/components/scoring/audit-log-table";

export default async function AuditLogPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "score.review")) notFound();

  const { eventId } = await params;

  const [event] = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, context.organization.id)))
    .limit(1);
  if (!event) notFound();

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorName: userProfiles.displayName,
      actorEmail: userProfiles.email,
    })
    .from(auditLogs)
    .leftJoin(userProfiles, eq(userProfiles.id, auditLogs.actorUserId))
    .where(eq(auditLogs.eventId, eventId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(500);

  const integrity = await verifyScoreEventChain({ database: db, eventId });

  const auditRows: AuditRow[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actor: r.actorName ?? r.actorEmail ?? "System",
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href={`/tabulator/${eventId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to tabulator
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">{event.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {integrity.ok ? (
              <ShieldCheck className="size-5 text-green-600 dark:text-green-500" />
            ) : (
              <ShieldAlert className="size-5 text-destructive" />
            )}
            Score history integrity
          </CardTitle>
          <CardDescription>
            Every score entry is chained to the previous one with a cryptographic
            hash — editing or deleting history directly in the database breaks
            the chain. Recomputed on every visit to this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {integrity.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No score history yet — the chain starts with the first score.
            </p>
          ) : integrity.ok ? (
            <p className="text-sm">
              <span className="font-medium text-green-700 dark:text-green-500">
                Chain intact.
              </span>{" "}
              {integrity.verified} of {integrity.total} entries verified
              {integrity.legacy > 0
                ? ` (${integrity.legacy} older entries predate the chain and can't be verified)`
                : ""}
              .
            </p>
          ) : (
            <p className="text-sm font-medium text-destructive">
              Integrity check FAILED at entry #{integrity.brokenAtSeq}: {integrity.reason}{" "}
              The score history has been modified outside the application.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Every score change, round lock, reminder, session release, and export
            for this event. Showing the most recent 500 entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditLogTable rows={auditRows} />
        </CardContent>
      </Card>
    </div>
  );
}
