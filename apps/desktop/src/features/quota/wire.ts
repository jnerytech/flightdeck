import type { AppKernel } from "../../lib/kernel.ts";
import { type QuotaCore, QuotaSlice } from "./store.ts";

/** The hosts as the quota reads them from the app's state: each one's name. */
interface HostsState {
  hosts: readonly { id: string; name: string }[];
}

/** Builds the plan quota's slice from the store's kernel (#1596): a host's `quota.get` and `quota.setPauseAt`. */
export function wireQuota(
  kernel: AppKernel<ReturnType<QuotaCore["state"]> & HostsState>,
  deps: { notify: QuotaCore["notify"] },
): QuotaSlice {
  return new QuotaSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    onlineHosts: () => kernel.onlineHosts(),
    hostName: (hostId) => kernel.state().hosts.find((h) => h.id === hostId)?.name,
    read: (hostId) => kernel.hostCommand(hostId, "quota.get", {}),
    setPauseAt: (hostId, pauseAt) => kernel.hostCommand(hostId, "quota.setPauseAt", { pauseAt }),
    notify: deps.notify,
    t: () => kernel.t(),
    now: () => kernel.now(),
  });
}
