/**
 * What a screen still loading shows: a busy region or a skeleton block. The prints wait until
 * nothing matches, so they capture the loaded screen, not its placeholder.
 */
export const PENDING_SELECTOR = '[aria-busy="true"], [data-slot="skeleton"]';
