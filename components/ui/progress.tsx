import { cn } from "@/lib/utils";

export interface ProgressProps {
  value: number;
  className?: string;
}

export function Progress({ className, value }: ProgressProps) {
  const normalizedValue = Math.max(0, Math.min(100, value));

  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${normalizedValue}%` }}
      />
    </div>
  );
}
