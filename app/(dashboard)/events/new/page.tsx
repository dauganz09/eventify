import { notFound } from "next/navigation";
import { createEventAction } from "@/app/(dashboard)/events/actions";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
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

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function NewEventPage() {
  const context = await requireAuthContext();
  if (!hasPermission(context.authorization, "event.manage")) notFound();

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">New event</h1>
        <p className="mt-2 text-muted-foreground">
          Create a draft event and continue setup in the guided builder.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event details</CardTitle>
          <CardDescription>Basic information to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createEventAction} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Event name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="venue">Venue</Label>
              <Input id="venue" name="venue" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input id="timezone" name="timezone" defaultValue="UTC" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contestantDisplayMode">Contestant display mode</Label>
              <select
                className={selectClassName}
                defaultValue="one-at-a-time"
                id="contestantDisplayMode"
                name="contestantDisplayMode"
              >
                <option value="one-at-a-time">One at a time</option>
                <option value="list">List</option>
                <option value="card">Card grid</option>
                <option value="grouped">Grouped</option>
              </select>
            </div>
            <Button type="submit">Create and continue</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
