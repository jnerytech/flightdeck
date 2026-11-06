/**
 * The lines of a log a stand-in program wrote: trimmed, blank ones dropped. A Windows `.cmd` ends
 * each line in CRLF and leaves the space before its `>>`, so `az --version \r` is `az --version`.
 */
export function logLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
