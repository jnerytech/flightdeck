/**
 * What a screen still loading shows: a busy region or a skeleton block. The prints wait until
 * nothing matches, so they capture the loaded screen, not its placeholder.
 */
import type { WireRule } from "./wire.ts";

export const PENDING_SELECTOR = '[aria-busy="true"], [data-slot="skeleton"]';

/**
 * What the print of `shot` waits out. A cleanup held in progress is busy on purpose (#4001): its
 * button keeps `aria-busy`, while every other busy region and skeleton is still waited for. A list
 * whose answer is held on purpose (#4190) is the print of the loading state: its status region and
 * skeletons stay, and any other busy region is still waited for.
 */
export function pendingSelectorFor(shot: {
  maintenance?: { holdClean?: boolean };
  wire?: WireRule[];
}): string {
  if (shot.wire?.some((rule) => "hold" in rule)) return '[aria-busy="true"]:not([role="status"])';
  return shot.maintenance?.holdClean === true
    ? '[aria-busy="true"]:not(button), [data-slot="skeleton"]'
    : PENDING_SELECTOR;
}
