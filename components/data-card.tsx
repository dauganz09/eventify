import { cn } from "@/lib/utils";

/**
 * Mobile card representation of a data-table row. Used alongside a desktop
 * `<Table>` (wrapped in `hidden md:block`) so list-style tables collapse into
 * readable stacked cards on small screens instead of horizontal scroll.
 *
 *   <div className="hidden md:block"><Table>…</Table></div>
 *   <DataCardList>
 *     {rows.map((r) => (
 *       <DataCard key={r.id} title={r.name} meta={<Badge>…</Badge>} footer={…}>
 *         <DataCardRow label="Updated">{r.date}</DataCardRow>
 *       </DataCard>
 *     ))}
 *   </DataCardList>
 */
export function DataCardList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-3 md:hidden", className)}>{children}</div>
  );
}

export function DataCard({
  title,
  meta,
  footer,
  children,
}: {
  title: React.ReactNode;
  /** Secondary line under the title (badge, email, etc.). */
  meta?: React.ReactNode;
  /** Action row pinned to the bottom of the card. */
  footer?: React.ReactNode;
  /** `DataCardRow`s describing the remaining columns. */
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="grid min-w-0 gap-1">
        {/* A div, not a <p>: callers pass block content as the title (e.g. an
            event row wraps its logo + name in a flex container), and a <div>
            inside a <p> is invalid HTML that breaks hydration. */}
        <div className="truncate font-medium">{title}</div>
        {meta ? <div className="min-w-0 text-sm">{meta}</div> : null}
      </div>
      {children ? (
        <dl className="mt-3 grid gap-1.5 text-sm">{children}</dl>
      ) : null}
      {footer ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function DataCardRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
