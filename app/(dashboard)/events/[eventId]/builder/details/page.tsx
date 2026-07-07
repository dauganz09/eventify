import { notFound } from "next/navigation";
import { updateEventDetailsAction } from "@/app/(dashboard)/events/[eventId]/builder/actions";
import { ActionForm } from "@/components/events/action-form";
import { DateTimeLocalInput } from "@/components/events/datetime-local-input";
import { EventLogoField } from "@/components/events/event-logo-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { getEventById } from "@/lib/events/event-service";
import { nativeSelectClassName } from "@/lib/events/format";

export default async function EventDetailsStepPage({
  params,
}: {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event details</CardTitle>
        <CardDescription>
          Core information and schedule for this event.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm
          key={String(event.updatedAt)}
          action={updateEventDetailsAction.bind(null, eventId)}
          className="grid gap-4"
          successMessage="Event details saved."
        >
          <div className="grid gap-2">
            <Label htmlFor="name">Event name</Label>
            <Input defaultValue={event.name} id="name" name="name" required />
          </div>
          <EventLogoField defaultValue={event.logoUrl ?? ""} name="logoUrl" />
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              defaultValue={event.description ?? ""}
              id="description"
              name="description"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="venue">Venue</Label>
            <Input defaultValue={event.venue ?? ""} id="venue" name="venue" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              defaultValue={event.timezone}
              id="timezone"
              name="timezone"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="startsAt">Starts at</Label>
              <DateTimeLocalInput
                id="startsAt"
                name="startsAt"
                iso={event.startsAt ? new Date(event.startsAt).toISOString() : ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="endsAt">Ends at</Label>
              <DateTimeLocalInput
                id="endsAt"
                name="endsAt"
                iso={event.endsAt ? new Date(event.endsAt).toISOString() : ""}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contestantDisplayMode">Contestant display mode</Label>
            <select
              className={nativeSelectClassName}
              defaultValue={event.contestantDisplayMode}
              id="contestantDisplayMode"
              name="contestantDisplayMode"
            >
              <option value="one-at-a-time">One at a time</option>
              <option value="list">List</option>
              <option value="card">Card grid</option>
              <option value="grouped">Grouped</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <p className="text-sm font-medium">Current status</p>
              <p className="text-sm text-muted-foreground capitalize">
                {event.status}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Activate the event from the readiness check once setup is complete.
            </p>
          </div>
          <Button type="submit">Save details</Button>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
