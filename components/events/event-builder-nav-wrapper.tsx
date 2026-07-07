"use client";

import { usePathname } from "next/navigation";
import { EventBuilderNav } from "@/components/events/event-builder-nav";

export function EventBuilderNavWrapper({
  completedSteps,
  eventId,
}: {
  eventId: string;
  completedSteps: string[];
}) {
  const pathname = usePathname();
  const currentStep = pathname.split("/").pop() ?? "details";

  return (
    <EventBuilderNav
      completedSteps={completedSteps}
      currentStep={currentStep}
      eventId={eventId}
    />
  );
}
