import type { AppKernel } from "../../lib/kernel.ts";
import { APP_VERSION } from "../../lib/version.ts";
import { type HealthCore, HealthSlice } from "./health-store.ts";
import type { HostUpdateView } from "./update-store.ts";

/** The hosts as a wire file of this domain reads them from the app's state. */
interface HostsState {
  hosts: readonly ({ id: string } & Pick<HostUpdateView, "hostInfo">)[];
}

/** Builds the hosts' health slice from the store's kernel (#1596): `deps.check` and `doctor.run`. */
export function wireHealth(
  kernel: AppKernel<ReturnType<HealthCore["state"]> & HostsState>,
): HealthSlice {
  return new HealthSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    features: (hostId) => kernel.state().hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    deps: (hostId) => kernel.hostRequest(hostId, "deps.check", {}),
    doctor: (hostId) => kernel.hostRequest(hostId, "doctor.run", { appVersion: APP_VERSION }),
    now: () => kernel.now(),
  });
}
