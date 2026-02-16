/**
 * CSV export utility — converts arrays of objects to CSV and triggers download.
 */

/** Convert an array of objects to a CSV string */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns?: (keyof T)[]): string {
  if (rows.length === 0) return "";

  const keys = columns ?? (Object.keys(rows[0]) as (keyof T)[]);
  const header = keys.map(String).join(",");
  const body = rows.map((row) =>
    keys.map((k) => {
      const val = row[k];
      if (val === null || val === undefined) return "";
      const str = String(val);
      // Escape values containing commas, quotes, or newlines
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(","),
  ).join("\n");

  return `${header}\n${body}`;
}

/** Trigger a CSV file download in the browser */
export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
