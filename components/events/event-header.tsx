import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EventLogo } from "@/components/events/event-logo";

export function EventHeader({
  event,
}: {
  event: {
    id: string;
    name: string;
    status: string;
    venue?: string | null;
    logoUrl?: string | null;
  };
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-6">
      <Link
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        href="/events"
      >
        <ArrowLeft className="size-4" />
        Back to events
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <EventLogo src={event.logoUrl} alt={event.name} className="size-10" />
        <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
        <Badge variant="secondary">{event.status}</Badge>
      </div>
      {event.venue ? (
        <p className="text-sm text-muted-foreground">{event.venue}</p>
      ) : null}
    </div>
  );
}
