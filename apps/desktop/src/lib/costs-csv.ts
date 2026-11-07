/** One host's costs export: the host's name and the file the daemon built. */
export interface HostCsv {
  host: string;
  csv: string;
}

/**
 * The exports of several hosts as one file, with the host's name as the first column, so the rows
 * of every host can be told apart. The header is the first file's; an empty file adds nothing.
 */
export function mergeHostCsv(_files: readonly HostCsv[]): string {
  return "";
}
