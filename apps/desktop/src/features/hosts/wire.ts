import type { AppKernel } from "../../lib/kernel.ts";
import { APP_VERSION } from "../../lib/version.ts";
import { type HealthCore, HealthSlice } from "./health-store.ts";
import type { HostConnection } from "./host-connection.ts";
import { type HostUpdateCore, HostUpdateSlice, type HostUpdateView } from "./update-store.ts";

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

/**
 * Builds the daemon update's slice from the store's kernel (#1596): `daemon.update.apply` and
 * `.check` on the host's connection, opened if needed. Writing a host's marks, opening a
 * connection and the error's text stay the store's, as named deps.
 */
export function wireHostUpdate(
  kernel: AppKernel<{ hosts: readonly ({ id: string } & HostUpdateView)[] }>,
  deps: {
    patch: HostUpdateCore["patch"];
    open: (hostId: string) => HostConnection;
    describeError: HostUpdateCore["describeError"];
    timeoutMs?: number;
  },
): HostUpdateSlice {
  return new HostUpdateSlice({
    host: (hostId) => kernel.state().hosts.find((h) => h.id === hostId),
    patch: deps.patch,
    connected: (hostId) => kernel.connection(hostId) !== undefined,
    apply: (hostId) => deps.open(hostId).request("daemon.update.apply", { confirm: true }),
    check: (hostId) => deps.open(hostId).request("daemon.update.check", {}),
    describeError: deps.describeError,
    t: () => kernel.t(),
    now: () => kernel.now(),
    timeoutMs: deps.timeoutMs,
  });
}
