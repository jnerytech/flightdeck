/** Issue #100: what the parts of a teleport share: the size limit and the count of secret lines. */

import type { TeleportManifest } from "@flightdeck/protocol";

/** The largest part (a transcript, a code bundle) a teleport takes. */
export { TELEPORT_PART_MAX_BYTES as TELEPORT_MAX_BYTES } from "@flightdeck/protocol";

/** Two counts of secret lines as one: the lines add up, the kinds are each named once. */
export function addSecrets(
  a: TeleportManifest["secrets"],
  b: TeleportManifest["secrets"],
): TeleportManifest["secrets"] {
  return { lines: a.lines + b.lines, labels: [...new Set([...a.labels, ...b.labels])] };
}

/** How often the scan gives the event loop back, and how. */
const DEFAULT_PACE = {
  every: 256 * 1024,
  pause: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
};

/**
 * The lines of a text that look like secrets, and the kinds found in the order met. The text is
 * walked line by line, never split into an array: a transcript can be 64 MB.
 */
export async function secretLines(
  text: string,
  scan: (text: string) => string[],
  pace: { every: number; pause(): Promise<void> } = DEFAULT_PACE,
): Promise<TeleportManifest["secrets"]> {
  const labels: string[] = [];
  let lines = 0;
  let start = 0;
  let mark = 0;
  while (start <= text.length) {
    // The scan runs about 20 patterns per line: every slice of text gives the event loop back.
    if (start - mark >= pace.every) {
      mark = start;
      await pace.pause(); // NOSONAR: the pause is the point: it gives the event loop back between slices
    }
    const end = text.indexOf("\n", start);
    const line = text.slice(start, end === -1 ? text.length : end);
    start = end === -1 ? text.length + 1 : end + 1;
    const found = line ? scan(line) : [];
    if (found.length === 0) continue;
    lines++;
    for (const label of found) if (!labels.includes(label)) labels.push(label);
  }
  return { lines, labels };
}
