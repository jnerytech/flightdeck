/**
 * The hosts' public entry in the app (#1589, #1596): what each host's checks say about its health and
 * its daemon's update, and the pieces other screens show for a host.
 * Another domain imports from here, never a file inside; the components come from `ui.ts` (#2451). The page (`page.tsx`) is left out on
 * purpose: `ui/Screens.tsx` loads it as a lazy chunk, and exporting it here would pull it into the
 * main bundle.
 */

export { awaitedHost } from "./domain/awaited-host.ts";
export { hostDownReason } from "./domain/host-down-reason.ts";
export type { HostNameError } from "./domain/host-name.ts";
export type { RetryState } from "./domain/host-offline.ts";
export { hostInitial, hostRailLabel } from "./domain/host-rail.ts";
export { type GithubHost, githubSignedIn } from "./github-session.ts";
export {
  type HealthAnswer,
  type HealthCore,
  HealthSlice,
  type HealthSliceState,
  initialHealthState,
} from "./health-store.ts";
export { hostNeedsAttention } from "./host-attention.ts";
export { hostColorVar } from "./host-color.ts";
export {
  type ConnectionStatus,
  HostConnection,
  RequestError,
  statusLine,
} from "./host-connection.ts";
export type { HostDraft } from "./host-form.tsx";
export { hostDotView, hostStatusView } from "./host-status.ts";
export { HostTabs } from "./host-tabs.ts";
export { HOSTS_KEY, HostConfig, loadHosts, saveHosts } from "./hosts.ts";
export { holdAwake } from "./keep-awake.ts";
export { HostLink, type HostRoutes, type OnlineStep } from "./link.ts";
export { pairingErrorText } from "./pairing-text.ts";
export { HostRosterSlice } from "./roster-store.ts";
export {
  type HostUpdateCore,
  type HostUpdatePatch,
  HostUpdateSlice,
  type HostUpdateView,
} from "./update-store.ts";
export { useSwitcherHostId, useSwitcherHosts } from "./use-switcher-hosts.ts";
export { wireHealth, wireHostUpdate } from "./wire.ts";
