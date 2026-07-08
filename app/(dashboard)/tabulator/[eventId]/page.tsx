import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Layers,
  LockOpen,
  Printer,
  Projector,
  RefreshCw,
  ScrollText,
  Trophy,
  Users,
} from "lucide-react";
import { EventLogo } from "@/components/events/event-logo";
import { JudgesReminderTable } from "@/components/scoring/judges-reminder-table";
import { NewTabLink } from "@/components/scoring/new-tab-link";
import { ManualScorePanel } from "@/components/scoring/manual-score-panel";
import { db } from "@/db";
import { judges, rounds, unlockRequests } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { PRESENT_FEATURE_ENABLED } from "@/lib/feature-flags";
import { getEventTabulatorDetail } from "@/lib/scoring/tabulator-service";
import {
  approveUnlockRequestAction,
  recalculateResultsAction,
  rejectUnlockRequestAction,
} from "@/app/(dashboard)/tabulator/actions";
import { TabulatorScores } from "@/components/scoring/tabulator-scores";
import { TabulatorRealtime } from "@/components/scoring/tabulator-realtime";
import { TabulatorLiveProvider } from "@/components/scoring/tabulator-live-context";
import { TabulatorRoundsSection } from "@/components/scoring/tabulator-rounds-section";
import { toTabulatorLiveSnapshot } from "@/lib/scoring/tabulator-snapshot-service";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
export default async function TabulatorEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ set?: string }>;
}) {
  const context = await requireAuthContext();

  if (!hasPermission(context.authorization, "score.review")) {
    notFound();
  }
  const canAdjust = hasPermission(context.authorization, "score.adjust");

  const { eventId } = await params;
  const { set } = await searchParams;

  let detail;
  try {
    detail = await getEventTabulatorDetail({
      database: db,
      organizationId: context.organization.id,
      eventId,
      focusSetId: set ?? null,
    });
  } catch {
    notFound();
  }

  // Single-active invariants drive which "Activate" buttons are enabled.
  const activeGroupId = detail.activeRound?.id ?? null;
  const anyRoundActive = activeGroupId !== null;
  const anySetActive =
    detail.groups.some((g) => g.sets.some((s) => s.isActive)) ||
    detail.ungroupedSets.some((s) => s.isActive);
  const activeSet =
    detail.groups.flatMap((g) => g.sets).find((s) => s.isActive) ??
    detail.ungroupedSets.find((s) => s.isActive) ??
    null;
  const activeSetId = activeSet?.id ?? null;

  // Pending unlock requests for this event.
  const pendingUnlockRequests = await db
    .select({
      id: unlockRequests.id,
      judgeId: unlockRequests.judgeId,
      judgeName: judges.displayName,
      roundId: unlockRequests.roundId,
      roundName: rounds.name,
      reason: unlockRequests.reason,
      createdAt: unlockRequests.createdAt,
    })
    .from(unlockRequests)
    .innerJoin(judges, eq(judges.id, unlockRequests.judgeId))
    .innerJoin(rounds, eq(rounds.id, unlockRequests.roundId))
    .where(
      and(
        eq(unlockRequests.eventId, eventId),
        eq(unlockRequests.status, "pending"),
      ),
    );

  return (
    <>
      {/* Outside the provider so snapshot state updates never recreate SSE. */}
      <TabulatorRealtime eventId={eventId} />
      <TabulatorLiveProvider
        eventId={eventId}
        focusSetId={detail.focusSetId}
        initialSnapshot={toTabulatorLiveSnapshot(detail)}
      >
      <div className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link
            href="/tabulator"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All events
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <EventLogo
              src={detail.event.logoUrl}
              alt={detail.event.name}
              className="size-9"
            />
            <h1 className="text-3xl font-semibold tracking-tight">
              {detail.event.name}
            </h1>
          </div>
          <div className="mt-2 flex items-center gap-2 text-muted-foreground">
            <Badge variant="secondary">{detail.event.status}</Badge>
            <span className="text-sm">{detail.widgets.contestants} contestants</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/tabulator/${eventId}/insights`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <BarChart3 className="size-4" />
            Insights
          </Link>
          <Link
            href={`/tabulator/${eventId}/audit`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ScrollText className="size-4" />
            Audit log
          </Link>
          {PRESENT_FEATURE_ENABLED && (
            <NewTabLink
              href={`/tabulator/${eventId}/present`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Projector className="size-4" />
              Present
            </NewTabLink>
          )}
          <NewTabLink
            href={`/tabulator/${eventId}/print`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Printer className="size-4" />
            Print results
          </NewTabLink>
          <NewTabLink
            href={`/tabulator/${eventId}/print/scoresheet`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Printer className="size-4" />
            Score breakdown
          </NewTabLink>
          <form action={recalculateResultsAction}>
            <input type="hidden" name="eventId" value={eventId} />
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <RefreshCw className="size-4" />
              Recalculate results
            </button>
          </form>
        </div>
      </div>

      {/* Sticky quick-nav: keeps live context + section jumps in view while
          the operator scrolls a long event. Sits just below the app header. */}
      <nav className="sticky top-16 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {anyRoundActive || activeSet ? (
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
            ) : (
              <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
            )}
            <span className="truncate font-medium">
              {detail.activeRound?.name ?? activeSet?.name ?? "No active set"}
              {detail.activeRound && activeSet ? (
                <span className="text-muted-foreground"> · {activeSet.name}</span>
              ) : null}
            </span>
          </div>
          <div className="flex items-center gap-0.5 text-sm font-medium">
            <a
              href="#scores"
              className="rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Scores
            </a>
            <a
              href="#rounds"
              className="rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Rounds
            </a>
            {detail.manualSets.length > 0 && (
              <a
                href="#manual"
                className="rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Manual
              </a>
            )}
            {pendingUnlockRequests.length > 0 && (
              <a
                href="#requests"
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-amber-600 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-950/40"
              >
                Requests
                <span className="inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">
                  {pendingUnlockRequests.length}
                </span>
              </a>
            )}
            <a
              href="#judges"
              className="rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Judges
            </a>
          </div>
        </div>
      </nav>

      {/* Status bar */}
      <section className="grid gap-3 sm:grid-cols-3">
        {/* Current round & set */}
        <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-5 text-primary-foreground shadow-md sm:col-span-1">
          <div className="absolute -right-4 -top-4 size-24 rounded-full bg-white/10" />
          <div className="absolute -bottom-6 -left-2 size-20 rounded-full bg-white/5" />
          <p className="relative text-xs font-semibold uppercase tracking-widest text-primary-foreground/70">
            Now scoring
          </p>
          {detail.activeRound || activeSet ? (
            <>
              {detail.activeRound && (
                <p className="relative mt-1 text-2xl font-bold leading-tight tracking-tight">
                  {detail.activeRound.name}
                </p>
              )}
              {activeSet && (
                <div className="relative mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-0.5 text-sm font-medium">
                  <Layers className="size-3.5" />
                  {activeSet.name}
                </div>
              )}
            </>
          ) : (
            <p className="relative mt-1 text-lg font-semibold text-primary-foreground/60">
              No active set
            </p>
          )}
        </div>

        {/* Candidates */}
        <div className="flex items-center gap-5 rounded-2xl border bg-card px-6 py-5 shadow-sm">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/40">
            <Trophy className="size-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <p className="text-3xl font-bold tabular-nums leading-none">
              {detail.widgets.contestants}
            </p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">Candidates</p>
          </div>
        </div>

        {/* Judges */}
        <div className="flex items-center gap-5 rounded-2xl border bg-card px-6 py-5 shadow-sm">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/40">
            <Users className="size-6 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <p className="text-3xl font-bold tabular-nums leading-none">
              {detail.judges.length}
            </p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              Judges
              {detail.widgets.activeJudges > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-400">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  {detail.widgets.activeJudges} online
                </span>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Scores — the most important view, kept near the top */}
      <Card id="scores" className="scroll-mt-32">
        <CardHeader>
          <CardTitle>Contestant scores</CardTitle>
          <CardDescription>
            Totals per set and a per-judge, per-criteria breakdown — calculated
            server-side from submitted scores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TabulatorScores
            eventId={eventId}
            setColumns={detail.setColumns}
            setTotals={detail.setTotals}
            focusCriteria={detail.focusCriteria}
            judgeColumns={detail.judgeColumns}
            judgeMatrix={detail.judgeMatrix}
            focusSetId={detail.focusSetId}
            activeRound={detail.activeRound}
            carriedFromRounds={detail.carriedFromRounds}
            finalRankings={detail.finalRankings}
            advancement={detail.advancement}
            rankOrder={detail.rankOrder}
            tieBreak={detail.tieBreak}
          />
        </CardContent>
      </Card>

      {/* Manual-entry (pre-event) categories */}
      {detail.manualSets.length === 1 && (
        <section id="manual" className="scroll-mt-32">
          <ManualScorePanel
            eventId={eventId}
            set={detail.manualSets[0]}
            canAdjust={canAdjust}
          />
        </section>
      )}
      {detail.manualSets.length > 1 && (
        <Card id="manual" className="scroll-mt-32">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Manual scores
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {detail.manualSets.length} categories
              </span>
            </CardTitle>
            <CardDescription>
              Pre-event categories entered manually. Switch tabs to edit each
              category.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={detail.manualSets[0].id}>
              <TabsList variant="line" className="mb-4 w-full justify-start">
                {detail.manualSets.map((s) => (
                  <TabsTrigger key={s.id} value={s.id}>
                    {s.name}
                    {s.completionPct < 100 && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        {s.completionPct}%
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              {detail.manualSets.map((s) => (
                <TabsContent key={s.id} value={s.id}>
                  <ManualScorePanel
                    eventId={eventId}
                    set={s}
                    canAdjust={canAdjust}
                    noCard
                  />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Rounds & sets */}
      <Card id="rounds" className="scroll-mt-32">
        <CardHeader>
          <CardTitle>Rounds &amp; sets</CardTitle>
          <CardDescription>
            Activate the round groups and sets judges should be scoring now.
            Deactivating locks a set read-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <TabulatorRoundsSection
            groups={detail.groups}
            ungroupedSets={detail.ungroupedSets}
            canAdjust={canAdjust}
            anyRoundActive={anyRoundActive}
            anySetActive={anySetActive}
            activeGroupId={activeGroupId}
          />
        </CardContent>
      </Card>

      {/* Unlock requests */}
      {pendingUnlockRequests.length > 0 && (
        <Card id="requests" className="scroll-mt-32 border-amber-300 dark:border-amber-600">
          <CardHeader>
            <div className="flex items-center gap-2">
              <LockOpen className="size-5 text-amber-600" />
              <CardTitle>
                Unlock requests
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                  {pendingUnlockRequests.length}
                </span>
              </CardTitle>
            </div>
            <CardDescription>
              Judges requesting to edit their locked scores. Review and approve or decline each request.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingUnlockRequests.map((req) => (
              <div
                key={req.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/30"
              >
                <div className="flex-1 space-y-0.5">
                  <p className="font-semibold">{req.judgeName}</p>
                  <p className="text-sm text-muted-foreground">Set: {req.roundName}</p>
                  {req.reason && (
                    <p className="text-sm italic text-muted-foreground">&ldquo;{req.reason}&rdquo;</p>
                  )}
                </div>
                {canAdjust && (
                  <div className="flex items-center gap-2">
                    <form
                      action={approveUnlockRequestAction.bind(null, {
                        eventId,
                        judgeId: req.judgeId,
                        roundId: req.roundId,
                        requestId: req.id,
                      })}
                    >
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                      >
                        <LockOpen className="size-4" />
                        Approve
                      </button>
                    </form>
                    <form
                      action={rejectUnlockRequestAction.bind(null, {
                        eventId,
                        judgeId: req.judgeId,
                        roundId: req.roundId,
                        requestId: req.id,
                      })}
                    >
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent"
                      >
                        Decline
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Judges */}
      <Card id="judges" className="scroll-mt-32">
        <CardHeader>
          <CardTitle>Judges</CardTitle>
          <CardDescription>
            Submitted score counts per judge across the event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JudgesReminderTable
            eventId={eventId}
            judges={detail.judges}
            canAdjust={canAdjust}
            activeSetId={activeSetId}
          />
        </CardContent>
      </Card>
    </div>
      </TabulatorLiveProvider>
    </>
  );
}
