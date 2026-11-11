import type { AppKernel } from "../../lib/kernel.ts";
import { type MessagingCore, MessagingSlice } from "./store.ts";

/** Builds the messaging slice from the store's kernel (#1596): a host's `messaging.rules.*`. */
export function wireMessaging(
  kernel: AppKernel<ReturnType<MessagingCore["state"]>>,
  deps: { notify: MessagingCore["notify"] },
): MessagingSlice {
  return new MessagingSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    rules: (hostId) => kernel.hostCommand(hostId, "messaging.rules.get", {}),
    setRules: (hostId, rules) => kernel.hostCommand(hostId, "messaging.rules.set", rules),
    notify: deps.notify,
    t: () => kernel.t(),
  });
}
