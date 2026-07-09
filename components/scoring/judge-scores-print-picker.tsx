"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PrintButton } from "@/components/scoring/print-button";

export function JudgeScoresPrintToolbar({
  eventId,
  judgeId,
  judges,
  generatedAt,
}: {
  eventId: string;
  judgeId: string | null;
  judges: { id: string; displayName: string }[];
  generatedAt?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onJudgeChange(nextJudgeId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextJudgeId) params.set("judge", nextJudgeId);
    else params.delete("judge");
    router.replace(`/tabulator/${eventId}/print/judge-scores?${params.toString()}`);
  }

  return (
    <div className="rpt-page-toolbar flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link
        href={`/tabulator/${eventId}`}
        className="text-sm text-[#5c6478] hover:text-[#0f1f3d]"
      >
        ← Back to tabulator
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Judge</span>
          <select
            value={judgeId ?? ""}
            onChange={(e) => onJudgeChange(e.target.value)}
            className="h-9 min-w-48 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">Select a judge…</option>
            {judges.map((judge) => (
              <option key={judge.id} value={judge.id}>
                {judge.displayName}
              </option>
            ))}
          </select>
        </label>
        {generatedAt && (
          <span className="text-xs text-[#5c6478]">
            Generated {new Date(generatedAt).toLocaleString()}
          </span>
        )}
        {judgeId && <PrintButton />}
      </div>
    </div>
  );
}
