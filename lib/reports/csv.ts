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
  let stringValue = value === null || value === undefined ? "" : String(value);

  // Neutralize formula injection: a leading =, +, -, or @ makes Excel/Sheets
  // interpret the cell as a formula when the CSV is opened (a contestant or
  // judge display name is free text and could start with any of these).
  if (/^[=+\-@]/.test(stringValue)) {
    stringValue = `'${stringValue}`;
  }

  if (!/[",\n\r]/.test(stringValue)) return stringValue;

  return `"${stringValue.replaceAll('"', '""')}"`;
}
