import type { AppKernel } from "../../lib/kernel.ts";
import { type InboxCore, InboxSlice } from "./store.ts";

/**
 * Builds the notification inbox's slice from the store's kernel (#1596): its entries in the state
 * and whether a host is online. The storage, the notice preferences and sound, which requests wait
 * for the person, and the platform's notice and badge stay the store's, as deps.
 */
export function wireInbox(
  kernel: AppKernel<{
    inbox: ReturnType<InboxCore["entries"]>;
    hosts: readonly { id: string; status: string }[];
  }>,
  deps: Pick<InboxCore, "storage" | "prefs" | "soundFile" | "waiting" | "show" | "setBadge">,
): InboxSlice {
  return new InboxSlice({
    storage: deps.storage,
    entries: () => kernel.state().inbox,
    setEntries: (entries) => kernel.update({ inbox: entries }),
    prefs: deps.prefs,
    soundFile: deps.soundFile,
    waiting: deps.waiting,
    hostOnline: (hostId) => kernel.state().hosts.find((h) => h.id === hostId)?.status === "online",
    now: () => kernel.now(),
    show: deps.show,
    setBadge: deps.setBadge,
    t: () => kernel.t(),
  });
}
