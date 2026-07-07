export interface PdfReportSummary {
  title: string;
  generatedAt: string;
  lines: string[];
}

export function createPlainTextReport(summary: PdfReportSummary) {
  return [
    summary.title,
    `Generated: ${summary.generatedAt}`,
    "",
    ...summary.lines,
  ].join("\n");
}
