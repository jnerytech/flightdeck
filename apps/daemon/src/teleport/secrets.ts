/** Issue #100: what the parts of a teleport share: the size limit and the count of secret lines. */
import type { TeleportManifest } from "@flightdeck/protocol";

/** The largest part (a transcript, a code bundle) a teleport takes. */
export const TELEPORT_MAX_BYTES = 64 * 1024 * 1024;

/** Two counts of secret lines as one: the lines add up, the kinds are each named once. */
export function addSecrets(
  a: TeleportManifest["secrets"],
  b: TeleportManifest["secrets"],
): TeleportManifest["secrets"] {
  return { lines: a.lines + b.lines, labels: [...new Set([...a.labels, ...b.labels])] };
}

/**
 * The lines of a text that look like secrets, and the kinds found in the order met. The text is
 * walked line by line, never split into an array: a transcript can be 64 MB.
 */
export function secretLines(
  text: string,
  scan: (text: string) => string[],
): TeleportManifest["secrets"] {
  const labels: string[] = [];
  let lines = 0;
  let start = 0;
  while (start <= text.length) {
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
