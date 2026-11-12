import type { AppKernel, HostCommandType } from "../../lib/kernel.ts";
import { type MessagingCore, MessagingSlice } from "./store.ts";

/**
 * Builds the messaging slice from the store's kernel (#1596): a host's `messaging.rules.*`, the
 * relay's call and the peers' sync interval.
 */
export function wireMessaging(
  kernel: AppKernel<ReturnType<MessagingCore["state"]>>,
  deps: {
    notify: MessagingCore["notify"];
    relayHosts: MessagingCore["relay"]["hosts"];
    /** How often the peers' sync runs (5 s when absent). */
    peersSyncMs?: number;
  },
): MessagingSlice {
  return new MessagingSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    rules: (hostId) => kernel.hostCommand(hostId, "messaging.rules.get", {}),
    setRules: (hostId, rules) => kernel.hostCommand(hostId, "messaging.rules.set", rules),
    notify: deps.notify,
    t: () => kernel.t(),
    relay: {
      hosts: deps.relayHosts,
      call: (hostId, type, payload) =>
        kernel.dispatch(hostId, type as HostCommandType, payload as never),
    },
    repeat: (run) => {
      const timer = setInterval(run, deps.peersSyncMs ?? 5000);
      return () => clearInterval(timer);
    },
  });
}
