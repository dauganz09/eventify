import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { db } from "@/db";
import {
  auditLogs,
  contestants,
  events,
  judges,
  roundGroups,
  unlockRequests,
  userProfiles,
} from "@/db/schema";
import { getEventTabulatorDetail } from "@/lib/scoring/tabulator-service";

export interface DashboardEvent {
  id: string;
  name: string;
  status: string;
  venue: string | null;
  updatedAt: Date;
}

export interface ActiveEventCard {
  id: string;
  name: string;
  activeRoundName: string | null;
  progressPct: number;
  submitted: number;
  expected: number;
  contestants: number;
  activeJudges: number;
  conflicts: number;
}

export interface DashboardActivity {
  id: string;
  action: string;
  entityType: string;
  actorName: string | null;
  eventId: string | null;
  createdAt: Date;
}

export interface DashboardOverview {
  stats: {
    totalEvents: number;
    activeEvents: number;
    draftEvents: number;
    contestants: number;
    judges: number;
    pendingUnlockRequests: number;
  };
  activeEvents: ActiveEventCard[];
  recentEvents: DashboardEvent[];
  recentActivity: DashboardActivity[];
}

/**
 * Aggregates an organization-wide snapshot for the dashboard landing page.
 * Stat counts are single aggregate queries; per-event scoring progress is
 * resolved only for events that currently have an active round group, so the
 * heavier tabulator loader runs at most a handful of times.
 */
export async function getDashboardOverview(params: {
  database: typeof db;
  organizationId: string;
}): Promise<DashboardOverview> {
  const { database, organizationId } = params;

  const allEvents = await database
    .select({
      id: events.id,
      name: events.name,
      status: events.status,
      venue: events.venue,
      updatedAt: events.updatedAt,
    })
    .from(events)
    .where(and(eq(events.organizationId, organizationId), isNull(events.deletedAt)))
    .orderBy(desc(events.updatedAt));

  const eventIds = allEvents.map((e) => e.id);

  const stats = {
    totalEvents: allEvents.length,
    activeEvents: allEvents.filter((e) => e.status === "active").length,
    draftEvents: allEvents.filter((e) => e.status === "draft").length,
    contestants: 0,
    judges: 0,
    pendingUnlockRequests: 0,
  };

  if (eventIds.length === 0) {
    return { stats, activeEvents: [], recentEvents: [], recentActivity: [] };
  }

  const [
    [contestantCount],
    [judgeCount],
    [unlockCount],
    activeGroups,
    activityRows,
  ] = await Promise.all([
    database
      .select({ value: count() })
      .from(contestants)
      .where(
        and(
          inArray(contestants.eventId, eventIds),
          isNull(contestants.archivedAt),
        ),
      ),
    database
      .select({ value: count() })
      .from(judges)
      .where(
        and(inArray(judges.eventId, eventIds), eq(judges.isActive, true)),
      ),
    database
      .select({ value: count() })
      .from(unlockRequests)
      .where(
        and(
          inArray(unlockRequests.eventId, eventIds),
          eq(unlockRequests.status, "pending"),
        ),
      ),
    database
      .selectDistinct({ eventId: roundGroups.eventId })
      .from(roundGroups)
      .where(
        and(
          inArray(roundGroups.eventId, eventIds),
          eq(roundGroups.status, "active"),
        ),
      ),
    database
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        eventId: auditLogs.eventId,
        actorName: userProfiles.displayName,
        actorEmail: userProfiles.email,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(userProfiles, eq(userProfiles.id, auditLogs.actorUserId))
      .where(eq(auditLogs.organizationId, organizationId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(8),
  ]);

  stats.contestants = contestantCount?.value ?? 0;
  stats.judges = judgeCount?.value ?? 0;
  stats.pendingUnlockRequests = unlockCount?.value ?? 0;

  // Resolve scoring progress for events with an active round group.
  const activeEventIds = activeGroups.map((g) => g.eventId);
  const activeEvents = (
    await Promise.all(
      activeEventIds.map(async (eventId) => {
        try {
          const detail = await getEventTabulatorDetail({
            database,
            organizationId,
            eventId,
            focusSetId: null,
          });
          return {
            id: detail.event.id,
            name: detail.event.name,
            activeRoundName: detail.activeRound?.name ?? null,
            progressPct: detail.widgets.progressPct,
            submitted: detail.widgets.submitted,
            expected: detail.widgets.expected,
            contestants: detail.widgets.contestants,
            activeJudges: detail.widgets.activeJudges,
            conflicts: detail.widgets.conflicts,
          } satisfies ActiveEventCard;
        } catch {
          return null;
        }
      }),
    )
  ).filter((e): e is ActiveEventCard => e !== null);

  const recentActivity: DashboardActivity[] = activityRows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    actorName: row.actorName ?? row.actorEmail ?? null,
    eventId: row.eventId,
    createdAt: row.createdAt,
  }));

  return {
    stats,
    activeEvents,
    recentEvents: allEvents.slice(0, 6),
    recentActivity,
  };
}
