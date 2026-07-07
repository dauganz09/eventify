import { cn } from "@/lib/utils";

/** Small event logo thumbnail. Renders nothing when the event has no logo. */
export function EventLogo({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={cn(
        "shrink-0 rounded-md border border-border bg-card object-contain",
        className,
      )}
    />
  );
}
