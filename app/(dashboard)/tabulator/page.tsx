import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listEvents } from "@/lib/events/event-service";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const statusVariant: Record<string, "default" | "secondary" | "success" | "warning"> = {
  active: "success",
  published: "default",
  draft: "secondary",
  archived: "warning",
};

export default async function TabulatorIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const context = await requireAuthContext();
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  if (!hasPermission(context.authorization, "score.review")) {
    return (
      <div className="grid gap-6">
        <Heading />
        <Card>
          <CardHeader>
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>
              You need the tabulator or admin role to monitor scoring.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const allEvents = await listEvents({
    database: db,
    organizationId: context.organization.id,
  });

  // Archived events are hidden by default; a filter reveals them.
  const archivedCount = allEvents.filter((e) => e.status === "archived").length;
  const events = showArchived
    ? allEvents
    : allEvents.filter((e) => e.status !== "archived");

  return (
    <div className="grid gap-6">
      <Heading />

      {(archivedCount > 0 || showArchived) && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {showArchived
              ? `Showing all events, including ${archivedCount} archived.`
              : `${archivedCount} archived event${archivedCount === 1 ? "" : "s"} hidden.`}
          </span>
          <Link
            href={showArchived ? "/tabulator" : "/tabulator?archived=1"}
            className="font-medium text-primary hover:underline"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </div>
      )}

      {events.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No events yet</CardTitle>
            <CardDescription>
              Create an event and collect scores to monitor progress here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((event) => (
            <Link key={event.id} href={`/tabulator/${event.id}`} className="group">
              <Card className="transition-colors group-hover:border-primary">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <CardTitle>{event.name}</CardTitle>
                      <CardDescription>
                        {event.venue ?? "No venue set"}
                      </CardDescription>
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardHeader>
                <CardContent>
                  <Badge variant={statusVariant[event.status] ?? "secondary"}>
                    {event.status}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Heading() {
  return (
    <div>
      <Badge variant="secondary">Realtime operations</Badge>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Tabulator</h1>
      <p className="mt-2 text-muted-foreground">
        Pick an event to monitor scoring progress, rounds, sets, and judges.
      </p>
    </div>
  );
}
