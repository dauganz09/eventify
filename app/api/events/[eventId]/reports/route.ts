import { NextResponse } from "next/server";
import { createCsv } from "@/lib/reports/csv";
import { createPlainTextReport } from "@/lib/reports/pdf";

const sampleRows = [
  { rank: 1, contestant: "Avery Santos", total: 28.75 },
  { rank: 2, contestant: "Mika Tan", total: 27.95 },
  { rank: 3, contestant: "Rin Alvarez", total: 27.5 },
];

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";

  if (format === "pdf") {
    const report = createPlainTextReport({
      title: `Event ${eventId} Final Rankings`,
      generatedAt: new Date().toISOString(),
      lines: sampleRows.map(
        (row) => `${row.rank}. ${row.contestant} - ${row.total.toFixed(2)}`,
      ),
    });

    return new Response(report, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="event-${eventId}-report.txt"`,
      },
    });
  }

  const csv = createCsv(sampleRows, [
    { header: "Rank", getValue: (row) => row.rank },
    { header: "Contestant", getValue: (row) => row.contestant },
    { header: "Total", getValue: (row) => row.total },
  ]);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="event-${eventId}-rankings.csv"`,
    },
  });
}

export async function POST() {
  return NextResponse.json({
    status: "queued",
    reportId: crypto.randomUUID(),
  });
}
