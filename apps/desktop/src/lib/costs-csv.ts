/** One host's costs export: the host's name and the file the daemon built. */
export interface HostCsv {
  host: string;
  csv: string;
}

/** A spreadsheet reads a field that starts with one of these as a formula. */
const FORMULA = /^[=+\-@\t\r]/;

/** A CSV field: marked when it would read as a formula, quoted when it holds a comma, quote or break. */
function field(value: string): string {
  const text = value.replace(FORMULA, "'$&");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The records of a CSV file; a line break inside quotes stays in its record. */
function records(csv: string): string[] {
  const found: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of csv) {
    // A doubled quote inside a quoted field flips twice, so it leaves the state as it was.
    if (char === '"') quoted = !quoted;
    if (char === "\n" && !quoted) {
      found.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") found.push(current);
  return found;
}

/**
 * The exports of several hosts as one file, with the host's name as the first column, so the rows
 * of every host can be told apart. The header is the first file's; an empty file adds nothing.
 */
export function mergeHostCsv(files: readonly HostCsv[]): string {
  const parts = files.map((file) => ({ host: file.host, rows: records(file.csv) }));
  const header = parts.find((part) => part.rows.length > 0)?.rows[0];
  if (header === undefined) return "";
  const lines = [`host,${header}`];
  for (const part of parts) {
    for (const row of part.rows.slice(1)) lines.push(`${field(part.host)},${row}`);
  }
  return `${lines.join("\n")}\n`;
}
