import type { Card, WatchInfo } from "@flightdeck/protocol";
import { sessionKey } from "@/features/sessions/index.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { type WatchCore, WatchSlice } from "./store.ts";

/** What the watch's wire file reads from the app's state, keyed by `sessionKey`. */
interface WatchState {
  hosts: ReturnType<WatchCore["hosts"]>;
  watches: Record<string, WatchInfo>;
  cards: Record<string, Card>;
}

/**
 * Builds a card's PR watch slice from the store's kernel (#1596): the watch commands, the watches
 * kept in the state by card, and the card itself. The webhook feed and the inbox's notice stay
 * the store's, as deps.
 */
export function wireWatch(
  kernel: AppKernel<WatchState>,
  deps: Pick<WatchCore, "feed" | "notify">,
): WatchSlice {
  return new WatchSlice({
    command: (hostId, type, payload, options) => kernel.hostCommand(hostId, type, payload, options),
    hosts: () => kernel.state().hosts,
    watchOf: (hostId, cardId) => kernel.state().watches[sessionKey(hostId, cardId)],
    keep: (hostId, watch) =>
      kernel.update({
        watches: { ...kernel.state().watches, [sessionKey(hostId, watch.cardId)]: watch },
      }),
    card: (hostId, cardId) => kernel.state().cards[sessionKey(hostId, cardId)],
    feed: deps.feed,
    notify: deps.notify,
    fail: (error, text) => kernel.fail(error, text),
    t: () => kernel.t(),
  });
}
