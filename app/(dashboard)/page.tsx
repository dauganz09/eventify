import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarClock,
  ClipboardList,
  LockOpen,
  Plus,
  Trophy,
  Users,
} from "lucide-react";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getDashboardOverview } from "@/lib/dashboard/dashboard-service";
import { DataCard, DataCardList, DataCardRow } from "@/components/data-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const statusVariant: Record<
  string,
  "default" | "secondary" | "success" | "warning"
> = {
  active: "success",
  published: "default",
  draft: "secondary",
  archived: "warning",
  completed: "default",
};

export default async function Page() {
  const context = await requireAuthContext();
  const canReview = hasPermission(context.authorization, "score.review");
  const canViewEvents = hasPermission(context.authorization, "event.view");
  const canManageEvents = hasPermission(context.authorization, "event.manage");

  const overview = await getDashboardOverview({
    database: db,
    organizationId: context.organization.id,
  });

  const { stats } = overview;
  const firstName =
    context.profile.displayName?.split(" ")[0] ??
    context.email.split("@")[0];
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {today}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Here&rsquo;s what&rsquo;s happening across {context.organization.name}.
          </p>
        </div>
        {canManageEvents && (
          <Link href="/events/new">
            <Button>
              <Plus className="size-4" />
              New event
            </Button>
          </Link>
        )}
      </div>

      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<ClipboardList className="size-5" />}
          label="Events"
          value={stats.totalEvents}
          detail={
            stats.totalEvents === 0
              ? "No events yet"
              : `${stats.activeEvents} active · ${stats.draftEvents} draft`
          }
          href={canViewEvents ? "/events" : undefined}
        />
        <StatCard
          icon={<Trophy className="size-5" />}
          label="Contestants"
          value={stats.contestants}
          detail="Across all events"
        />
        <StatCard
          icon={<Users className="size-5" />}
          label="Judges"
          value={stats.judges}
          detail="Active judge accounts"
        />
        <StatCard
          icon={<LockOpen className="size-5" />}
          label="Unlock requests"
          value={stats.pendingUnlockRequests}
          detail={
            stats.pendingUnlockRequests > 0
              ? "Awaiting your review"
              : "Nothing pending"
          }
          emphasize={stats.pendingUnlockRequests > 0}
        />
      </section>

      {/* Now scoring */}
      {canReview && overview.activeEvents.length > 0 && (
        <section className="grid gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <h2 className="text-lg font-semibold tracking-tight">Now scoring</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {overview.activeEvents.map((event) => (
              <Link
                key={event.id}
                href={`/tabulator/${event.id}`}
                className="group"
              >
                <Card className="h-full transition-colors group-hover:border-primary">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <CardTitle>{event.name}</CardTitle>
                        <CardDescription>
                          {event.activeRoundName ?? "Active round"}
                        </CardDescription>
                      </div>
                      <BarChart3 className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="grid gap-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Scoring progress
                        </span>
                        <span className="font-medium tabular-nums">
                          {event.submitted}/{event.expected} · {event.progressPct}%
                        </span>
                      </div>
                      <Progress value={event.progressPct} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Trophy className="size-4" />
                        {event.contestants} contestants
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-4" />
                        {event.activeJudges} judges online
                      </span>
                      {event.conflicts > 0 && (
                        <Badge variant="warning">
                          {event.conflicts} conflicts
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className={canViewEvents ? "grid gap-6 lg:grid-cols-3" : "grid gap-6"}>
        {/* Recent events */}
        {canViewEvents && (
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="grid gap-1.5">
              <CardTitle>Recent events</CardTitle>
              <CardDescription>
                Jump back into setup or open the tabulator.
              </CardDescription>
            </div>
            <Link href="/events">
              <Button size="sm" variant="ghost">
                View all
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {overview.recentEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <p className="font-medium">No events yet</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Create your first event to start configuring contestants,
                  judges, and criteria.
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
                        <TableHead>Updated</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.recentEvents.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="font-medium">{event.name}</TableCell>
                          <TableCell>
                            <Badge variant={statusVariant[event.status] ?? "secondary"}>
                              {event.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(event.updatedAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Link href={`/events/${event.id}/builder/details`}>
                                <Button size="sm" variant="outline">
                                  Open
                                </Button>
                              </Link>
                              {canReview && (
                                <Link href={`/tabulator/${event.id}`}>
                                  <Button size="sm" variant="ghost">
                                    Monitor
                                  </Button>
                                </Link>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile cards */}
                <DataCardList>
                  {overview.recentEvents.map((event) => (
                    <DataCard
                      key={event.id}
                      title={event.name}
                      meta={
                        <Badge variant={statusVariant[event.status] ?? "secondary"}>
                          {event.status}
                        </Badge>
                      }
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
                          {canReview && (
                            <Link
                              href={`/tabulator/${event.id}`}
                              className="flex-1"
                            >
                              <Button size="sm" variant="ghost" className="w-full">
                                Monitor
                              </Button>
                            </Link>
                          )}
                        </>
                      }
                    >
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
        )}

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Activity
            </CardTitle>
            <CardDescription>Latest changes across the org.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activity recorded yet.
              </p>
            ) : (
              <ol className="grid gap-4">
                {overview.recentActivity.map((item) => (
                  <li key={item.id} className="flex gap-3 text-sm">
                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <CalendarClock className="size-3.5" />
                    </div>
                    <div className="grid gap-0.5">
                      <p className="font-medium leading-tight">
                        {formatAction(item.action)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.actorName ? `${item.actorName} · ` : ""}
                        {timeAgo(item.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  href,
  emphasize,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  href?: string;
  emphasize?: boolean;
}) {
  const card = (
    <Card
      className={`h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        emphasize
          ? "border-amber-300 dark:border-amber-600"
          : "hover:border-primary/30"
      }`}
    >
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs font-medium uppercase tracking-wider">
          {label}
        </CardDescription>
        <div
          className={`flex size-9 items-center justify-center rounded-lg ${
            emphasize
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
              : "bg-primary/10 text-primary"
          }`}
        >
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-display text-4xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {card}
      </Link>
    );
  }
  return card;
}

function formatAction(action: string) {
  const text = action.replace(/[._]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function timeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}
