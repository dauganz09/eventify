"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Crown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SetColumn {
  id: string;
  name: string;
}

interface SetTotalsRow {
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  photoUrl: string | null;
  cells: { setId: string; total: number | null }[];
  roundTotal: number;
  carriedIn: number;
  overall: number;
  rank: number;
}

function numericCell(value: number | null) {
  return value === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="tabular-nums">{value}</span>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Animated leaderboard. Rows are kept in a stable DOM order keyed by
 * contestant id; when the incoming `setTotals` re-orders them (because a judge
 * submission changed the standings), we FLIP-animate each row from its previous
 * vertical position to its new one using the Web Animations API.
 *
 * "FLIP" = First, Last, Invert, Play: we remember each row's offsetTop before
 * paint (First), read the new offsetTop after the order changes (Last), apply
 * an inverse translateY so it visually stays put (Invert), then animate the
 * transform back to zero (Play).
 */
export function LiveStandings({
  eventId,
  setColumns,
  setTotals,
}: {
  eventId: string;
  setColumns: SetColumn[];
  setTotals: SetTotalsRow[];
}) {
  const [query, setQuery] = useState("");
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const prevTops = useRef(new Map<string, number>());

  const rows = useMemo(() => {
    const sorted = [...setTotals].sort((a, b) => a.rank - b.rank);
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((row) => {
      const haystack = `${row.displayNumber ?? ""} ${row.displayName}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [setTotals, query]);

  // FLIP: after the DOM commits the new row order, animate each row from where
  // it used to be to where it is now.
  useLayoutEffect(() => {
    const tops = new Map<string, number>();
    for (const [id, el] of rowRefs.current) {
      tops.set(id, el.offsetTop);
    }

    for (const [id, el] of rowRefs.current) {
      const prev = prevTops.current.get(id);
      const next = tops.get(id);
      if (prev === undefined || next === undefined) continue;
      const delta = prev - next;
      if (delta === 0) continue;
      el.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
        { duration: 450, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }

    prevTops.current = tops;
  }, [rows]);

  if (setTotals.length === 0) {
    return <p className="text-sm text-muted-foreground">No contestants yet.</p>;
  }

  const colCount = 2 + setColumns.length + 1;

  return (
    <div className="grid gap-3">
      <div className="relative w-full max-w-xs">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contestant…"
          className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="relative max-h-[70vh] w-full overflow-auto rounded-md border border-border">
        <table className="w-full caption-bottom text-base">
          <thead className="sticky top-0 z-20 bg-background [&_th]:bg-background">
            <tr className="border-b border-border">
              <th className="h-12 w-16 px-4 text-left align-middle font-medium text-muted-foreground">
                Rank
              </th>
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                Contestant
              </th>
              {setColumns.map((set) => (
                <th
                  key={set.id}
                  className="h-12 px-4 text-right align-middle font-medium text-muted-foreground"
                >
                  {set.name}
                </th>
              ))}
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                Overall
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="p-6 text-center text-sm text-muted-foreground"
                >
                  No contestants match “{query}”.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.contestantId}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.contestantId, el);
                    else rowRefs.current.delete(row.contestantId);
                  }}
                  className="border-b border-border transition-colors hover:bg-muted/40"
                >
                  <td className="px-4 py-2 align-middle font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      {row.rank <= 3 && (
                        <Crown
                          className={cn(
                            "size-4",
                            row.rank === 1 && "text-amber-500",
                            row.rank === 2 && "text-zinc-400",
                            row.rank === 3 && "text-amber-700",
                          )}
                        />
                      )}
                      {row.rank}
                    </span>
                  </td>
                  <td className="px-4 py-2 align-middle">
                    <Link
                      href={`/tabulator/${eventId}/contestant/${row.contestantId}`}
                      className="flex items-center gap-3 rounded-md transition-colors hover:text-primary"
                      title="View full score breakdown"
                    >
                      <Avatar photoUrl={row.photoUrl} name={row.displayName} />
                      <div className="grid">
                        {row.displayNumber && (
                          <span className="text-sm font-semibold tabular-nums">
                            #{row.displayNumber}
                          </span>
                        )}
                        <span className="text-muted-foreground">{row.displayName}</span>
                      </div>
                    </Link>
                  </td>
                  {setColumns.map((set) => (
                    <td key={set.id} className="px-4 py-2 text-right align-middle">
                      {numericCell(row.cells.find((c) => c.setId === set.id)?.total ?? null)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right align-middle font-medium">
                    {numericCell(row.overall)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Avatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        className="size-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {initials(name) || "?"}
    </span>
  );
}
