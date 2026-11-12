/**
 * The messaging's public entry in the app (#1589, #1596): the messages between sessions; for now,
 * the loops a host paused and the relay between hosts' daemons. Another domain imports from here,
 * never a file inside.
 */
export { type RelayDeps, relayMessage, relayUpdate, syncPeers } from "./relay.ts";
export {
  initialMessagingState,
  type LoopAlert,
  loopPairKey,
  type MessagingCore,
  MessagingSlice,
  type MessagingSliceState,
} from "./store.ts";
export { wireMessaging } from "./wire.ts";
