/**
 * What a screen still loading shows: a busy region or a skeleton block. The prints wait until
 * nothing matches, so they capture the loaded screen, not its placeholder.
 */
export const PENDING_SELECTOR = '[aria-busy="true"], [data-slot="skeleton"]';

/** What the print of `shot` waits out: a task held in progress is busy on purpose, so its busy region stays (#4001). */
export function pendingSelectorFor(shot: { busy?: boolean }): string {
  return shot.busy === true ? '[data-slot="skeleton"]' : PENDING_SELECTOR;
}
