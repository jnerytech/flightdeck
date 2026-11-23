import type { AccountState } from "@flightdeck/protocol";

/** Nothing was read from the host yet, and nothing went wrong either: the card is still waiting. */
export const isAccountPending = (state: AccountState | undefined): boolean =>
  state === undefined || (state.status === "unknown" && state.readAt === null && !state.error);
