"use client";

import { Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useScoreDraft } from "@/hooks/use-score-draft";

export function JudgeScorePanel() {
  const draft = useScoreDraft({
    eventId: "00000000-0000-0000-0000-000000000001",
    roundId: "00000000-0000-0000-0000-000000000002",
    contestantId: "00000000-0000-0000-0000-000000000003",
    criterionId: "00000000-0000-0000-0000-000000000004",
    judgeId: "00000000-0000-0000-0000-000000000005",
    initialValue: 8.5,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Presentation</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="grid gap-2 text-sm font-medium">
          Score
          <Input
            inputMode="decimal"
            max={10}
            min={0}
            step={0.25}
            type="number"
            value={draft.value}
            onChange={(event) => draft.setValue(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Comment
          <Textarea
            value={draft.comment}
            onChange={(event) => draft.setComment(event.target.value)}
            placeholder="Optional note for tabulators"
          />
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button className="flex-1" variant="secondary" onClick={draft.saveDraft}>
            <Save className="size-4" />
            Save draft
          </Button>
          <Button className="flex-1" onClick={draft.submitScore}>
            <Send className="size-4" />
            Submit score
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Sync: {draft.syncState} · {draft.isOnline ? "Online" : "Offline"} · Pending{" "}
          {draft.pendingCount}
        </p>
      </CardContent>
    </Card>
  );
}
