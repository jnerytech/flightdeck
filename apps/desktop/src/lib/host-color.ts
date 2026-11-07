/** How many colors the hosts share: the theme's `--host-1` to `--host-8` (issue #644). */
export const HOST_COLORS = 8;

/** The place of a host's color among the eight, the same for the same id on every window. */
export function hostColorIndex(_hostId: string): number {
  return 0;
}

/** The CSS value of a host's color, a token of the theme. */
export function hostColorVar(_hostId: string): string {
  return "var(--host-1)";
}
