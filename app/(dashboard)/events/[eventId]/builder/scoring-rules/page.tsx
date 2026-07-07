import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { getEventById } from "@/lib/events/event-service";
import { listRounds } from "@/lib/events/round-service";
import { listScoringRules } from "@/lib/events/scoring-rule-service";
import {
  parseRoundScoreMode,
  parseTieBreak,
  ROUND_SCORE_MODE_LABELS,
  ROUND_SCORE_MODES,
  TIE_BREAK_LABELS,
  TIE_BREAKS,
} from "@/lib/scoring/ranking";
import {
  setRoundScoreModeAction,
  setTieBreakAction,
} from "@/app/(dashboard)/events/[eventId]/builder/actions";
import { ScoringRulesManager } from "@/components/events/scoring-rules-manager";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function EventScoringRulesStepPage({
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

  const [rules, rounds] = await Promise.all([
    listScoringRules({ database: db, eventId, organizationId: context.organization.id }),
    listRounds({ database: db, eventId, organizationId: context.organization.id }),
  ]);

  const currentTieBreak = parseTieBreak(
    (event.config as Record<string, unknown> | null)?.tieBreak,
  );
  const currentRoundScoreMode = parseRoundScoreMode(
    (event.config as Record<string, unknown> | null)?.roundScoreMode,
  );

  return (
    <div className="grid gap-6">
      <ScoringRulesManager
        eventId={eventId}
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          roundId: r.roundId,
          aggregation: r.aggregation,
        }))}
        rounds={rounds.map((r) => ({ id: r.id, name: r.name }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Round totals</CardTitle>
          <CardDescription>
            How a round&rsquo;s total is built from its sets. Choose
            &ldquo;Sum&rdquo; for points-based events where set points add up
            (e.g. three 10-point sets making a 30-point round).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setRoundScoreModeAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="eventId" value={eventId} />
            <div className="grid gap-1">
              <label htmlFor="roundScoreMode" className="text-sm font-medium">
                Mode
              </label>
              <select
                id="roundScoreMode"
                name="roundScoreMode"
                defaultValue={currentRoundScoreMode}
                className="h-9 w-[22rem] rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ROUND_SCORE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {ROUND_SCORE_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Save
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tie-breaking</CardTitle>
          <CardDescription>
            How to resolve contestants with identical overall scores in the
            standings and printed results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setTieBreakAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="eventId" value={eventId} />
            <div className="grid gap-1">
              <label htmlFor="tieBreak" className="text-sm font-medium">
                Method
              </label>
              <select
                id="tieBreak"
                name="tieBreak"
                defaultValue={currentTieBreak}
                className="h-9 w-[22rem] rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {TIE_BREAKS.map((tb) => (
                  <option key={tb} value={tb}>
                    {TIE_BREAK_LABELS[tb]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Save
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
