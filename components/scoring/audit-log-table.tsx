"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function toneFor(action: string): "success" | "default" | "secondary" | "destructive" {
  if (action.includes("lock") || action.includes("released") || action.includes("revoked"))
    return "destructive";
  if (action.startsWith("score")) return "default";
  if (action.startsWith("round") || action.startsWith("set")) return "success";
  return "secondary";
}

function summarize(metadata: Record<string, unknown>): string {
  const keys = ["message", "status", "judgeId", "carryOverCount", "source"];
  const parts: string[] = [];
  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && value !== "") {
      parts.push(
        `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
      );
    }
  }
  return parts.join(" · ");
}

const columns: ColumnDef<AuditRow, unknown>[] = [
  {
    accessorKey: "createdAt",
    header: "Time",
    size: 180,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {new Date(row.original.createdAt).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "action",
    header: "Action",
    size: 200,
    filterFn: "equals",
    cell: ({ row }) => (
      <Badge variant={toneFor(row.original.action)} className="font-mono text-xs">
        {row.original.action}
      </Badge>
    ),
  },
  {
    accessorKey: "actor",
    header: "Actor",
    size: 160,
    cell: ({ row }) => <span className="text-sm">{row.original.actor}</span>,
  },
  {
    id: "details",
    header: "Details",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {summarize(row.original.metadata) || row.original.entityType}
      </span>
    ),
  },
];

export function AuditLogTable({ rows }: { rows: AuditRow[] }) {
  const actionOptions = useMemo(() => {
    const unique = Array.from(new Set(rows.map((r) => r.action))).sort();
    return unique.map((a) => ({ label: a, value: a }));
  }, [rows]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchColumn="actor"
      searchPlaceholder="Search by actor…"
      filters={[
        {
          columnId: "action",
          label: "All actions",
          options: actionOptions,
        },
      ]}
      pageSize={20}
      emptyMessage="No entries match your filters."
    />
  );
}
