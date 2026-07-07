import { notFound } from "next/navigation";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getEventById } from "@/lib/events/event-service";
import { getEventReadiness } from "@/lib/events/readiness";
import { EventBuilderNavWrapper } from "@/components/events/event-builder-nav-wrapper";
import { EventHeader } from "@/components/events/event-header";
import { db } from "@/db";

export default async function BuilderLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "event.view")) notFound();

  const event = await getEventById({
    database: db,
    eventId,
    organizationId: context.organization.id,
  });

  if (!event) notFound();

  const readiness = await getEventReadiness({
    database: db,
    eventId,
    organizationId: context.organization.id,
  });

  const completedSteps = readiness.items
    .filter((item) => item.passed)
    .map((item) => item.id);

  return (
    <div className="grid gap-6">
      <EventHeader event={event} />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-xl border border-border bg-card p-3 lg:sticky lg:top-24 lg:h-fit">
          <EventBuilderNavWrapper
            completedSteps={completedSteps}
            eventId={eventId}
          />
        </aside>
        <div>{children}</div>
      </div>
    </div>
  );
}
