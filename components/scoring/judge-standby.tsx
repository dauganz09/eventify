"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, RadioTower, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { JudgeTieBreakDialog, type JudgeTieBreakVote } from "@/components/scoring/judge-tie-break-dialog";

/**
 * Shown to a judge when no round/set is active for them. The page re-renders
 * (via JudgeRealtime → router.refresh) the moment the tabulator activates one,
 * so this screen swaps to the live workspace on its own — no manual reload.
 *
 * `complete` distinguishes "every round has already finished" from the
 * ordinary between-rounds wait, so a judge doesn't keep expecting a next set
 * once scoring for the whole event is actually over.
 */
export function JudgeStandby({
  eventName,
  judgeName,
  complete = false,
  activeTieBreakVote = null,
}: {
  eventName: string;
  judgeName: string;
  complete?: boolean;
  activeTieBreakVote?: JudgeTieBreakVote | null;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/judge-logout", { method: "POST" });
      router.push("/judge/login");
      router.refresh();
    } catch {
      toast.error("Failed to sign out.");
      setSigningOut(false);
    }
  }

  const judgeInitials = judgeName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-8">
      {activeTieBreakVote && <JudgeTieBreakDialog vote={activeTieBreakVote} />}
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 shadow-sm">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
            {judgeInitials}
          </span>
          <span className="text-muted-foreground">
            Judging as{" "}
            <span className="font-semibold text-foreground">{judgeName}</span>
          </span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle size="icon-sm" />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        {complete ? (
          <div className="relative flex w-full flex-col items-center overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.08] via-emerald-500/[0.02] to-transparent px-6 py-16 sm:py-24">
            {/* Ambient glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,rgba(16,185,129,0.22),transparent_60%)]"
            />

            {/* Floating sparkles */}
            <Sparkles
              aria-hidden
              className="absolute left-[16%] top-[22%] size-5 animate-pulse text-emerald-400/50 [animation-duration:2.4s]"
            />
            <Sparkles
              aria-hidden
              className="absolute right-[18%] top-[15%] size-4 animate-pulse text-emerald-400/40 [animation-delay:.8s] [animation-duration:3s]"
            />
            <Sparkles
              aria-hidden
              className="absolute bottom-[26%] left-[24%] size-3.5 animate-pulse text-emerald-400/35 [animation-delay:1.4s] [animation-duration:2.8s]"
            />
            <Sparkles
              aria-hidden
              className="absolute bottom-[30%] right-[22%] size-5 animate-pulse text-emerald-400/45 [animation-delay:.4s] [animation-duration:2.2s]"
            />

            {/* Trophy medallion */}
            <div className="relative flex size-32 items-center justify-center sm:size-36">
              <span className="absolute size-full rounded-full border border-emerald-400/30 [animation-duration:3.2s] motion-safe:animate-ping" />
              <span className="absolute size-[80%] rounded-full bg-emerald-400/15" />
              <div className="relative flex size-22 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-xl shadow-emerald-500/40 ring-4 ring-emerald-500/20 sm:size-24">
                <Trophy className="size-10 text-white drop-shadow sm:size-11" />
              </div>
            </div>

            <div className="relative mt-10 flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-1.5 backdrop-blur-sm">
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-600 dark:text-emerald-400">
                Scoring complete
              </span>
            </div>

            <h1 className="relative mt-4 max-w-3xl font-display text-5xl font-bold tracking-tight sm:text-6xl">
              {eventName}
            </h1>
            <p className="relative mt-6 text-2xl font-semibold text-foreground">
              That&rsquo;s a wrap! 🎉
            </p>
            <p className="relative mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
              Every round has been scored, sealed, and handed to the tabulator.
              Your part is done — thank you for judging with such care.
            </p>

            <Button
              variant="outline"
              size="lg"
              className="relative mt-10 gap-2 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              Sign out &amp; take a bow
            </Button>
          </div>
        ) : (
          <div className="relative flex w-full flex-col items-center overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-b from-primary/[0.06] via-primary/[0.02] to-transparent px-6 py-16 sm:py-24">
            {/* Ambient glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_60%)]"
            />

            {/* Radar beacon */}
            <div className="relative flex size-32 items-center justify-center sm:size-36">
              <span className="absolute size-full rounded-full border border-primary/25 [animation-duration:3s] motion-safe:animate-ping" />
              <span className="absolute size-[78%] rounded-full border border-primary/30 [animation-delay:.75s] [animation-duration:3s] motion-safe:animate-ping" />
              <span className="absolute size-[58%] rounded-full bg-primary/10" />
              <div className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/75 shadow-lg shadow-primary/30 ring-4 ring-primary/15 sm:size-22">
                <RadioTower className="size-9 text-primary-foreground" />
              </div>
            </div>

            <div className="relative mt-10 flex items-center gap-2.5 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 backdrop-blur-sm">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary">
                On standby
              </span>
            </div>

            <h1 className="relative mt-4 max-w-3xl font-display text-5xl font-bold tracking-tight sm:text-6xl">
              {eventName}
            </h1>
            <p className="relative mt-6 text-2xl font-semibold text-foreground">
              The stage is set.
            </p>
            <p className="relative mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
              We&rsquo;re keeping your seat warm while the host lines up the
              next round. The moment it opens, your scoring panel appears right
              here — no refresh needed.
            </p>

            {/* Waiting dots */}
            <div aria-hidden className="relative mt-9 flex items-center gap-1.5">
              <span className="size-1.5 animate-bounce rounded-full bg-primary/60" />
              <span className="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:.3s]" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
