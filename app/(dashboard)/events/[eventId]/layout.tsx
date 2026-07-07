import { notFound } from "next/navigation";
import { requireAuthContext } from "@/lib/auth/context";
import { getEventById } from "@/lib/events/event-service";
import { db } from "@/db";

export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const context = await requireAuthContext();
  const event = await getEventById({
    database: db,
    eventId,
    organizationId: context.organization.id,
  });

  if (!event) notFound();

  return children;
}
