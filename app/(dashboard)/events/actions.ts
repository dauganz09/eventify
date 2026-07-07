"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/context";
import {
  archiveEvent,
  createEvent,
  restoreEvent,
  softDeleteEvent,
  updateEventStatus,
} from "@/lib/events/event-service";

function revalidateEvents(eventId?: string) {
  revalidatePath("/events");
  if (eventId) {
    revalidatePath(`/events/${eventId}/builder/details`);
    revalidatePath(`/events/${eventId}/builder/readiness`);
  }
}

export async function createEventAction(formData: FormData) {
  const context = await requirePermission("event.manage");

  const event = await createEvent({
    database: db,
    organizationId: context.organization.id,
    input: {
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      venue: formData.get("venue") || undefined,
      timezone: formData.get("timezone") || "UTC",
      contestantDisplayMode: formData.get("contestantDisplayMode") || "one-at-a-time",
    },
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId: event.id,
    actorUserId: context.userId,
    action: "event.created",
    entityType: "event",
    entityId: event.id,
    metadata: { name: event.name },
  });

  redirect(`/events/${event.id}/builder/details`);
}

export async function archiveEventAction(eventId: string) {
  const context = await requirePermission("event.manage");

  await archiveEvent({
    database: db,
    organizationId: context.organization.id,
    eventId,
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "event.archived",
    entityType: "event",
    entityId: eventId,
  });

  revalidateEvents(eventId);
}

export async function deleteEventAction(eventId: string) {
  const context = await requirePermission("event.manage");

  const deleted = await softDeleteEvent({
    database: db,
    organizationId: context.organization.id,
    eventId,
  });

  if (!deleted) throw new Error("Event not found or already deleted.");

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "event.deleted",
    entityType: "event",
    entityId: eventId,
    metadata: { name: deleted.name },
  });

  revalidateEvents(eventId);
}

export async function restoreEventAction(eventId: string) {
  const context = await requirePermission("event.manage");

  const restored = await restoreEvent({
    database: db,
    organizationId: context.organization.id,
    eventId,
  });

  if (!restored) throw new Error("Event not found or not deleted.");

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "event.restored",
    entityType: "event",
    entityId: eventId,
    metadata: { name: restored.name },
  });

  revalidateEvents(eventId);
}

export async function activateEventAction(eventId: string) {
  const context = await requirePermission("event.manage");

  await updateEventStatus({
    database: db,
    organizationId: context.organization.id,
    input: { eventId, status: "active" },
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "event.activated",
    entityType: "event",
    entityId: eventId,
  });

  revalidateEvents(eventId);
}
