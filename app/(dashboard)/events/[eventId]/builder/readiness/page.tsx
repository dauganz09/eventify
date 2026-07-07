import { CheckCircle2, Circle } from "lucide-react";
import { notFound } from "next/navigation";
import { activateEventFromBuilderAction } from "@/app/(dashboard)/events/[eventId]/builder/actions";
import { ActionButton } from "@/components/events/action-button";
import { ReadinessBadge } from "@/components/events/readiness-badge";
import { ResetScoresDialog } from "@/components/events/reset-scores-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { getEventById } from "@/lib/events/event-service";
import { getEventReadiness } from "@/lib/events/readiness";
import { getEventScoreSummary } from "@/lib/scoring/score-reset-service";
import { cn } from "@/lib/utils";

export default async function EventReadinessStepPage({
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

  const readiness = await getEventReadiness({
    database: db,
    eventId,
    organizationId: context.organization.id,
  });

  const scoreSummary = await getEventScoreSummary({
    database: db,
    eventId,
    organizationId: context.organization.id,
  });

  const canActivate = readiness.isReady && event.status === "draft";

  return (
    <div className="grid gap-6">
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>Readiness check</CardTitle>
          <ReadinessBadge isReady={readiness.isReady} />
        </div>
        <CardDescription>
          Complete all required setup steps before activating the event.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ul className="grid gap-3">
          {readiness.items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border border-border p-4",
                item.passed ? "bg-primary/5" : "bg-muted/20",
              )}
            >
              {item.passed ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
              ) : (
                <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              )}
              <div>
                <p className="font-medium">{item.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        {event.status === "active" ? (
          <div className="rounded-lg border border-border bg-primary/5 p-4 text-sm">
            This event is already active.
          </div>
        ) : (
          <div>
            <ActionButton
              action={activateEventFromBuilderAction.bind(null, eventId)}
              disabled={!canActivate}
              successMessage="Event activated."
            >
              Activate event
            </ActionButton>
            {!readiness.isReady ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Resolve all checklist items before activation.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Initialize event</CardTitle>
        <CardDescription>
          Clear all scores and reset every round to a clean state before the
          event starts. Use this to wipe test runs or start a re-run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryStat label="Score records" value={scoreSummary.scoreRecords} />
          <SummaryStat label="Submitted" value={scoreSummary.submittedScores} />
          <SummaryStat
            label="Judge submissions"
            value={scoreSummary.judgeSubmissions}
          />
        </div>
        <div className="flex flex-col gap-2">
          <ResetScoresDialog
            eventId={eventId}
            scoreRecords={scoreSummary.scoreRecords}
            hasData={scoreSummary.hasData}
          />
          <p className="text-sm text-muted-foreground">
            {scoreSummary.hasData
              ? "This event has recorded scores. Initializing permanently deletes them."
              : "No scores recorded yet — this event is already in a clean state."}
          </p>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
