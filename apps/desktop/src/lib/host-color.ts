/** How many colors the hosts share: the theme's `--host-1` to `--host-8` (issue #644). */
export const HOST_COLORS = 8;

/** The place of a host's color among the eight, the same for the same id on every window. */
export function hostColorIndex(hostId: string): number {
  // FNV-1a over the id's UTF-16 units: stable, cheap, and it spreads short ids well.
  let hash = 0x811c9dc5;
  for (let i = 0; i < hostId.length; i++) {
    hash = Math.imul(hash ^ hostId.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0) % HOST_COLORS;
}

/** The CSS value of a host's color, a token of the theme. */
export function hostColorVar(hostId: string): string {
  return `var(--host-${hostColorIndex(hostId) + 1})`;
}
