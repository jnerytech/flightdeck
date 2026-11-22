import type { WireRule } from "./wire.ts";

/**
 * What a screen still loading shows: a busy region or a skeleton block. The prints wait until
 * nothing matches, so they capture the loaded screen, not its placeholder.
 */
export const PENDING_SELECTOR = '[aria-busy="true"], [data-slot="skeleton"]';

/**
 * What the print of `shot` waits out. A cleanup held in progress is busy on purpose (#4001): its
 * button keeps `aria-busy`, as does the button of an answer left on its way (#4203), while every
 * other busy region and skeleton is still waited for. A list whose answer is held on purpose (#4190)
 * is the print of the loading state: its status region and skeletons stay, and any other busy region
 * is still waited for.
 */
export function pendingSelectorFor(shot: {
  maintenance?: { holdClean?: boolean };
  wire?: WireRule[];
}): string {
  if (shot.wire?.some((rule) => "hold" in rule)) return '[aria-busy="true"]:not([role="status"])';
  // #4203: a command the print leaves unanswered (`stall`) keeps its button busy too.
  const stalled = shot.wire?.some((rule) => "stall" in rule) === true;
  return shot.maintenance?.holdClean === true || stalled
    ? '[aria-busy="true"]:not(button), [data-slot="skeleton"]'
    : PENDING_SELECTOR;
}
