import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listDeletedEvents, listEvents } from "@/lib/events/event-service";
import {
  archiveEventAction,
  deleteEventAction,
  restoreEventAction,
} from "@/app/(dashboard)/events/actions";
import { ActionButton } from "@/components/events/action-button";
import { DataCard, DataCardList, DataCardRow } from "@/components/data-card";
import { EventLogo } from "@/components/events/event-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";

export default async function EventsPage() {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "event.view")) notFound();

  const canManage = hasPermission(context.authorization, "event.manage");

  const [events, deletedEvents] = await Promise.all([
    listEvents({ database: db, organizationId: context.organization.id }),
    canManage
      ? listDeletedEvents({ database: db, organizationId: context.organization.id })
      : Promise.resolve([]),
  ]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Events</h1>
          <p className="mt-2 text-muted-foreground">
            Configure and manage events for {context.organization.name}.
          </p>
        </div>
        <Link href="/events/new">
          <Button>
            <Plus className="size-4" />
            New event
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your events</CardTitle>
          <CardDescription>
            Open an event to continue setup in the guided builder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="font-medium">No events yet</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Create your first event to start configuring contestants, judges, and criteria.
              </p>
              <Link href="/events/new">
                <Button className="mt-4">Create event</Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Venue</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-3">
                            <EventLogo
                              src={event.logoUrl}
                              alt={event.name}
                              className="size-8"
                            />
                            {event.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{event.status}</Badge>
                        </TableCell>
                        <TableCell>{event.venue ?? "—"}</TableCell>
                        <TableCell>
                          {new Date(event.updatedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Link href={`/events/${event.id}/builder/details`}>
                              <Button size="sm" variant="outline">
                                Open
                              </Button>
                            </Link>
                            {event.status !== "archived" ? (
                              <ActionButton
                                action={archiveEventAction.bind(null, event.id)}
                                size="sm"
                                successMessage="Event archived."
                                variant="ghost"
                              >
                                Archive
                              </ActionButton>
                            ) : null}
                            {canManage ? (
                              <ActionButton
                                action={deleteEventAction.bind(null, event.id)}
                                size="sm"
                                confirm={`Delete "${event.name}"? It will move to Deleted events and can be restored later.`}
                                successMessage="Event deleted."
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                              >
                                Delete
                              </ActionButton>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <DataCardList>
                {events.map((event) => (
                  <DataCard
                    key={event.id}
                    title={
                      <div className="flex items-center gap-2">
                        <EventLogo
                          src={event.logoUrl}
                          alt={event.name}
                          className="size-6"
                        />
                        {event.name}
                      </div>
                    }
                    meta={<Badge variant="secondary">{event.status}</Badge>}
                    footer={
                      <>
                        <Link
                          href={`/events/${event.id}/builder/details`}
                          className="flex-1"
                        >
                          <Button size="sm" variant="outline" className="w-full">
                            Open
                          </Button>
                        </Link>
                        {event.status !== "archived" ? (
                          <ActionButton
                            action={archiveEventAction.bind(null, event.id)}
                            size="sm"
                            successMessage="Event archived."
                            variant="ghost"
                          >
                            Archive
                          </ActionButton>
                        ) : null}
                        {canManage ? (
                          <ActionButton
                            action={deleteEventAction.bind(null, event.id)}
                            size="sm"
                            confirm={`Delete "${event.name}"? It will move to Deleted events and can be restored later.`}
                            successMessage="Event deleted."
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                          >
                            Delete
                          </ActionButton>
                        ) : null}
                      </>
                    }
                  >
                    <DataCardRow label="Venue">{event.venue ?? "—"}</DataCardRow>
                    <DataCardRow label="Updated">
                      {new Date(event.updatedAt).toLocaleDateString()}
                    </DataCardRow>
                  </DataCard>
                ))}
              </DataCardList>
            </>
          )}
        </CardContent>
      </Card>

      {canManage && deletedEvents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trash2 className="size-5 text-muted-foreground" />
              Deleted events
            </CardTitle>
            <CardDescription>
              Soft-deleted events and all their data are hidden from the app but
              kept intact. Restore one to bring it — and its rounds, contestants,
              and scores — back.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Venue</TableHead>
                    <TableHead>Deleted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deletedEvents.map((event) => (
                    <TableRow key={event.id} className="text-muted-foreground">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <EventLogo
                            src={event.logoUrl}
                            alt={event.name}
                            className="size-8 opacity-70"
                          />
                          {event.name}
                        </div>
                      </TableCell>
                      <TableCell>{event.venue ?? "—"}</TableCell>
                      <TableCell>
                        {event.deletedAt
                          ? new Date(event.deletedAt).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <ActionButton
                          action={restoreEventAction.bind(null, event.id)}
                          size="sm"
                          successMessage="Event restored."
                          variant="outline"
                        >
                          Restore
                        </ActionButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <DataCardList>
              {deletedEvents.map((event) => (
                <DataCard
                  key={event.id}
                  title={
                    <div className="flex items-center gap-2">
                      <EventLogo
                        src={event.logoUrl}
                        alt={event.name}
                        className="size-6 opacity-70"
                      />
                      {event.name}
                    </div>
                  }
                  footer={
                    <ActionButton
                      action={restoreEventAction.bind(null, event.id)}
                      size="sm"
                      successMessage="Event restored."
                      variant="outline"
                      className="w-full"
                    >
                      Restore
                    </ActionButton>
                  }
                >
                  <DataCardRow label="Venue">{event.venue ?? "—"}</DataCardRow>
                  <DataCardRow label="Deleted">
                    {event.deletedAt
                      ? new Date(event.deletedAt).toLocaleDateString()
                      : "—"}
                  </DataCardRow>
                </DataCard>
              ))}
            </DataCardList>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
