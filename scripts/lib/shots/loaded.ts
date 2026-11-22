/**
 * What a screen still loading shows: a busy region or a skeleton block. The prints wait until
 * nothing matches, so they capture the loaded screen, not its placeholder.
 */
export const PENDING_SELECTOR = '[aria-busy="true"], [data-slot="skeleton"]';

/**
 * What the print of `shot` waits out. A cleanup held in progress is busy on purpose (#4001): its
 * button keeps `aria-busy`, while every other busy region and skeleton is still waited for.
 */
export function pendingSelectorFor(shot: { maintenance?: { holdClean?: boolean } }): string {
  return shot.maintenance?.holdClean === true
    ? '[aria-busy="true"]:not(button), [data-slot="skeleton"]'
    : PENDING_SELECTOR;
}
