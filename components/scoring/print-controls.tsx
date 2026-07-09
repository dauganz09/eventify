"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import {
  PrintScopeSelector,
  type ScopeOption,
} from "@/components/scoring/print-scope-selector";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Print page header — visible on screen, hidden on paper. The Print button
 * fires the browser's native print dialog; print-specific CSS in the page
 * itself handles layout. The scope selector lets the tabulator print just
 * one section (overall, a round, or a set); the judge-scores switch expands
 * every ranking to show each judge's individual scores.
 */
export function PrintControls({
  backHref,
  generatedAt,
  scope,
  scopeOptions,
  showJudges,
}: {
  backHref: string;
  generatedAt: string;
  scope: string;
  scopeOptions: ScopeOption[];
  showJudges: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function toggleJudges(next: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("judges", "1");
    else params.delete("judges");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="rpt-page-toolbar flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-[#5c6478] hover:text-[#0f1f3d]"
      >
        <ArrowLeft className="size-4" />
        Back to tabulator
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <PrintScopeSelector current={scope} options={scopeOptions} />
        <div className="flex items-center gap-2">
          <Switch
            id="show-judges"
            checked={showJudges}
            onCheckedChange={toggleJudges}
          />
          <Label htmlFor="show-judges" className="text-sm text-[#5c6478]">
            Judge scores
          </Label>
        </div>
        <span className="text-xs text-[#5c6478]">
          Generated {new Date(generatedAt).toLocaleString()}
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Printer className="size-4" />
          Print
        </button>
      </div>
    </div>
  );
}
