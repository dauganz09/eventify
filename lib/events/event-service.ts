import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { db } from "@/db";
import { events } from "@/db/schema";
import {
  eventStatusUpdateSchema,
  eventUpdateSchema,
  eventUpsertSchema,
} from "@/lib/validation/domain";

export async function createEvent(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = eventUpsertSchema.parse(params.input);

  const [event] = await params.database
    .insert(events)
    .values({
      organizationId: params.organizationId,
      name: input.name,
      description: input.description,
      logoUrl: input.logoUrl || null,
      venue: input.venue,
      timezone: input.timezone,
      contestantDisplayMode: input.contestantDisplayMode,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      resultVisibility: { published: false },
      config: {},
    })
    .returning();

  return event;
}

export async function listEvents(params: {
  database: typeof db;
  organizationId: string;
}) {
  return params.database
    .select()
    .from(events)
    .where(
      and(
        eq(events.organizationId, params.organizationId),
        isNull(events.deletedAt),
      ),
    )
    .orderBy(desc(events.updatedAt));
}

/** Soft-deleted events for the org's "Deleted events" (trash) view. */
export async function listDeletedEvents(params: {
  database: typeof db;
  organizationId: string;
}) {
  return params.database
    .select()
    .from(events)
    .where(
      and(
        eq(events.organizationId, params.organizationId),
        isNotNull(events.deletedAt),
      ),
    )
    .orderBy(desc(events.deletedAt));
}

export async function getEventById(params: {
  database: typeof db;
  eventId: string;
  organizationId: string;
}) {
  const [event] = await params.database
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, params.eventId),
        eq(events.organizationId, params.organizationId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);

  return event ?? null;
}

export async function updateEvent(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = eventUpdateSchema.parse(params.input);

  const [event] = await params.database
    .update(events)
    .set({
      name: input.name,
      description: input.description,
      logoUrl:
        input.logoUrl === undefined ? undefined : input.logoUrl ? input.logoUrl : null,
      venue: input.venue,
      timezone: input.timezone,
      contestantDisplayMode: input.contestantDisplayMode,
      startsAt:
        input.startsAt === undefined
          ? undefined
          : input.startsAt
            ? new Date(input.startsAt)
            : null,
      endsAt:
        input.endsAt === undefined
          ? undefined
          : input.endsAt
            ? new Date(input.endsAt)
            : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(events.id, input.eventId),
        eq(events.organizationId, params.organizationId),
      ),
    )
    .returning();

  return event ?? null;
}

export async function updateEventStatus(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}) {
  const input = eventStatusUpdateSchema.parse(params.input);

  const [event] = await params.database
    .update(events)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(events.id, input.eventId),
        eq(events.organizationId, params.organizationId),
      ),
    )
    .returning();

  return event ?? null;
}

export async function archiveEvent(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}) {
  return updateEventStatus({
    database: params.database,
    organizationId: params.organizationId,
    input: { eventId: params.eventId, status: "archived" },
  });
}

/**
 * Soft-delete an event: stamp `deletedAt` so it (and everything reachable
 * through it) drops out of every active query, while remaining fully intact
 * for restore. Only affects a currently-live event (guards against
 * double-deletes). Returns the row, or null if not found / already deleted.
 */
export async function softDeleteEvent(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}) {
  const [event] = await params.database
    .update(events)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(events.id, params.eventId),
        eq(events.organizationId, params.organizationId),
        isNull(events.deletedAt),
      ),
    )
    .returning();

  return event ?? null;
}

/** Restore a soft-deleted event (clears `deletedAt`). */
export async function restoreEvent(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}) {
  const [event] = await params.database
    .update(events)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(events.id, params.eventId),
        eq(events.organizationId, params.organizationId),
        isNotNull(events.deletedAt),
      ),
    )
    .returning();

  return event ?? null;
}
