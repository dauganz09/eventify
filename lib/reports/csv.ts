export interface CsvColumn<TItem> {
  header: string;
  getValue: (item: TItem) => string | number | boolean | null | undefined;
}

export function createCsv<TItem>(items: TItem[], columns: CsvColumn<TItem>[]) {
  const rows = [
    columns.map((column) => escapeCsvValue(column.header)),
    ...items.map((item) =>
      columns.map((column) => escapeCsvValue(column.getValue(item))).join(","),
    ),
  ];

  return rows.map((row) => (Array.isArray(row) ? row.join(",") : row)).join("\n");
}

function escapeCsvValue(value: string | number | boolean | null | undefined) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(stringValue)) return stringValue;

  return `"${stringValue.replaceAll('"', '""')}"`;
}
