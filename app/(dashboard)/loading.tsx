import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading state for the dashboard. Renders inside the app shell
 * (the layout stays mounted) while a page's server data streams in, giving an
 * instant, branded loading experience instead of a blank screen.
 */
export default function DashboardLoading() {
  return (
    <div className="grid gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>

      {/* Content blocks */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 w-full rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}
