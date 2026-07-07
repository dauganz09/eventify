import { notFound } from "next/navigation";
import {
  copyCriteriaAction,
} from "@/app/(dashboard)/events/[eventId]/builder/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { listCriteria } from "@/lib/events/criterion-service";
import { getEventById } from "@/lib/events/event-service";
import { nativeSelectClassName } from "@/lib/events/format";
import { listRoundGroups } from "@/lib/events/round-group-service";
import { listRoundsWithGroups } from "@/lib/events/round-service";
import {
  CriteriaAccordion,
  type CriteriaSection,
} from "@/components/events/criteria-accordion";
import { CriterionFormDialog } from "@/components/events/criterion-form-dialog";
import { PlusIcon } from "lucide-react";

export default async function EventCriteriaStepPage({
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

  const [allCriteria, roundGroups, roundsWithGroups] = await Promise.all([
    listCriteria({ database: db, eventId, organizationId: context.organization.id }),
    listRoundGroups({ database: db, eventId, organizationId: context.organization.id }),
    listRoundsWithGroups({ database: db, eventId, organizationId: context.organization.id }),
  ]);

  // Index criteria by roundId (null = event-wide)
  const criteriaByRound = new Map<string | null, typeof allCriteria>();
  for (const c of allCriteria) {
    const key = c.roundId ?? null;
    const bucket = criteriaByRound.get(key) ?? [];
    bucket.push(c);
    criteriaByRound.set(key, bucket);
  }

  // Rounds grouped by roundGroupId
  const roundsByGroup = new Map<string | null, typeof roundsWithGroups>();
  for (const row of roundsWithGroups) {
    const key = row.round.roundGroupId ?? null;
    const bucket = roundsByGroup.get(key) ?? [];
    bucket.push(row);
    roundsByGroup.set(key, bucket);
  }

  const ungroupedRounds = roundsByGroup.get(null) ?? [];
  const allRounds = roundsWithGroups.map((r) => ({
    id: r.round.id,
    name: r.round.name,
    roundGroupId: r.round.roundGroupId,
  }));

  // Build flat sections list for the accordion (groups → ungrouped → event-wide)
  const sections: CriteriaSection[] = [];

  for (const group of roundGroups) {
    const groupRounds = roundsByGroup.get(group.id) ?? [];
    for (const { round } of groupRounds) {
      sections.push({
        roundId: round.id,
        dbRoundId: round.id,
        roundName: round.name,
        groupName: group.name,
        criteria: (criteriaByRound.get(round.id) ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          inputType: c.inputType,
          minValue: c.minValue,
          maxValue: c.maxValue,
          stepValue: c.stepValue,
          weight: c.weight,
          position: c.position,
          isRequired: c.isRequired,
          roundId: c.roundId,
        })),
      });
    }
  }

  for (const { round } of ungroupedRounds) {
    sections.push({
      roundId: round.id,
      dbRoundId: round.id,
      roundName: round.name,
      groupName: undefined,
      criteria: (criteriaByRound.get(round.id) ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        inputType: c.inputType,
        minValue: c.minValue,
        maxValue: c.maxValue,
        stepValue: c.stepValue,
        weight: c.weight,
        position: c.position,
        isRequired: c.isRequired,
        roundId: c.roundId,
      })),
    });
  }

  const eventWideCriteria = criteriaByRound.get(null) ?? [];
  if (eventWideCriteria.length > 0) {
    sections.push({
      roundId: "__event_wide__",
      dbRoundId: null,
      roundName: "Event-wide criteria",
      groupName: undefined,
      criteria: eventWideCriteria.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        inputType: c.inputType,
        minValue: c.minValue,
        maxValue: c.maxValue,
        stepValue: c.stepValue,
        weight: c.weight,
        position: c.position,
        isRequired: c.isRequired,
        roundId: c.roundId,
      })),
    });
  }

  return (
    <div className="grid gap-6">
      {/* Page header with global Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Criteria</h2>
          <p className="text-sm text-muted-foreground">
            Define scoring criteria for each set.
          </p>
        </div>
        <CriterionFormDialog
          eventId={eventId}
          roundGroups={roundGroups}
          rounds={allRounds}
          totalCriteria={allCriteria.length}
          trigger={
            <Button>
              <PlusIcon className="size-4" />
              Add criterion
            </Button>
          }
        />
      </div>

      {/* ── Collapsible criteria view ── */}
      <CriteriaAccordion
        eventId={eventId}
        sections={sections}
        roundGroups={roundGroups}
        rounds={allRounds}
        totalCriteria={allCriteria.length}
      />

      {/* ── Copy criteria ── */}
      {allRounds.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Copy criteria from another set</CardTitle>
            <CardDescription>
              Duplicate all criteria from one set into another so you don&apos;t have to
              re-enter them manually.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={copyCriteriaAction.bind(null, eventId)}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="grid gap-2">
                <Label htmlFor="sourceRoundId">Copy FROM</Label>
                <RoundSelect
                  id="sourceRoundId"
                  name="sourceRoundId"
                  roundGroups={roundGroups}
                  roundsByGroup={roundsByGroup}
                  ungroupedRounds={ungroupedRounds}
                  includeEventWide
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="targetRoundId">Copy TO</Label>
                <RoundSelect
                  id="targetRoundId"
                  name="targetRoundId"
                  roundGroups={roundGroups}
                  roundsByGroup={roundsByGroup}
                  ungroupedRounds={ungroupedRounds}
                  includeEventWide
                />
              </div>
              <div className="sm:col-span-2">
                <p className="mb-3 text-xs text-muted-foreground">
                  Copies all criteria from the source into the target. Existing criteria in the
                  target are kept — nothing is overwritten or deleted.
                </p>
                <Button type="submit" variant="secondary">
                  Copy criteria
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Shared select component ──────────────────────────────────────────────────

type RoundRow = { round: { id: string; name: string; roundGroupId: string | null } };
type GroupRow = { id: string; name: string };

function RoundSelect({
  id,
  name,
  roundGroups,
  roundsByGroup,
  ungroupedRounds,
  includeEventWide,
}: {
  id: string;
  name: string;
  roundGroups: GroupRow[];
  roundsByGroup: Map<string | null, RoundRow[]>;
  ungroupedRounds: RoundRow[];
  includeEventWide: boolean;
}) {
  return (
    <select className={nativeSelectClassName} id={id} name={name}>
      {includeEventWide && <option value="">Event-wide criteria</option>}

      {roundGroups.map((group) => {
        const groupRounds = roundsByGroup.get(group.id) ?? [];
        return (
          <optgroup key={group.id} label={group.name}>
            {groupRounds.map(({ round }) => (
              <option key={round.id} value={round.id}>
                {round.name}
              </option>
            ))}
          </optgroup>
        );
      })}

      {ungroupedRounds.length > 0 && (
        <optgroup label="Ungrouped sets">
          {ungroupedRounds.map(({ round }) => (
            <option key={round.id} value={round.id}>
              {round.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
