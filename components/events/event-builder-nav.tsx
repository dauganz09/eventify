import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export const builderSteps = [
  { slug: "details", label: "Event Details" },
  { slug: "rounds", label: "Rounds" },
  { slug: "contestants", label: "Contestants" },
  { slug: "judges", label: "Judges" },
  { slug: "criteria", label: "Criteria" },
  { slug: "scoring-rules", label: "Scoring Rules" },
  { slug: "readiness", label: "Readiness Check" },
] as const;

export function EventBuilderNav({
  eventId,
  currentStep,
  completedSteps = [],
}: {
  eventId: string;
  currentStep: string;
  completedSteps?: string[];
}) {
  return (
    <nav className="grid gap-1">
      {builderSteps.map((step, index) => {
        const isActive = step.slug === currentStep;
        const isComplete = completedSteps.includes(step.slug);

        return (
          <Link
            key={step.slug}
            href={`/events/${eventId}/builder/${step.slug}`}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-background/20 text-xs font-semibold">
              {index + 1}
            </span>
            <span className="flex-1">{step.label}</span>
            {isComplete ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <Circle className="size-4 shrink-0 opacity-40" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
