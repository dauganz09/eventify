"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ScopeOption {
  /** "all" | "overall" | `round-${id}` | `set-${id}` */
  value: string;
  label: string;
  group: "general" | "rounds" | "sets";
}

/**
 * Choose what to print: everything, overall only, a single round (with its
 * sets + round ranking), or a single set. The selection drives a `?scope=`
 * query param so the URL is shareable/bookmarkable. The server page reads
 * it and renders only the requested section.
 */
export function PrintScopeSelector({
  current,
  options,
}: {
  current: string;
  options: ScopeOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onChange(value: string | null) {
    if (!value) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("scope");
    else params.set("scope", value);
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  const general = options.filter((o) => o.group === "general");
  const rounds = options.filter((o) => o.group === "rounds");
  const sets = options.filter((o) => o.group === "sets");

  // value → label map so the trigger renders the option label, not the raw
  // value (which would otherwise show an internal id like "round-<uuid>").
  const items = Object.fromEntries(options.map((o) => [o.value, o.label]));

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Print scope</span>
      <Select value={current} onValueChange={onChange} items={items}>
        <SelectTrigger className="w-[18rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {general.length > 0 && (
            <SelectGroup>
              <SelectLabel>General</SelectLabel>
              {general.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {rounds.length > 0 && (
            <SelectGroup>
              <SelectLabel>Rounds</SelectLabel>
              {rounds.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {sets.length > 0 && (
            <SelectGroup>
              <SelectLabel>Sets</SelectLabel>
              {sets.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
