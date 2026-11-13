/**
 * The hosts' public entry in the app (#1589, #1596): what each host's checks say about its health and
 * its daemon's update, and the pieces other screens show for a host.
 * Another domain imports from here, never a file inside. The page (`page.tsx`) is left out on
 * purpose: `ui/Screens.tsx` loads it as a lazy chunk, and exporting it here would pull it into the
 * main bundle.
 */

export { AllowedFolders } from "./allowed-folders.tsx";
export { awaitedHost } from "./domain/awaited-host.ts";
export { hostDownReason } from "./domain/host-down-reason.ts";
export type { HostNameError } from "./domain/host-name.ts";
export type { RetryState } from "./domain/host-offline.ts";
export { hostInitial, hostRailLabel } from "./domain/host-rail.ts";
export { FirstRun } from "./first-run.tsx";
export { FolderPicker } from "./folder-picker.tsx";
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
export { HostDot } from "./host-dot.tsx";
export { draftFromLink, draftUrl, type HostDraft, HostForm } from "./host-form.tsx";
export { HostOfflineBanner } from "./host-offline-banner.tsx";
export { hostDotView, hostStatusView } from "./host-status.ts";
export { HostTabs } from "./host-tabs.ts";
export { HostVersionTip, hostVersionText } from "./host-version.tsx";
export { HOSTS_KEY, HostConfig, loadHosts, saveHosts } from "./hosts.ts";
export { HostsBanner } from "./hosts-banner.tsx";
export { holdAwake } from "./keep-awake.ts";
export { HostLink, type HostRoutes, type OnlineStep } from "./link.ts";
export { pairingErrorText } from "./pairing-text.ts";
export { RenameHostDialog } from "./rename-host-dialog.tsx";
export { HostRosterSlice } from "./roster-store.ts";
export {
  type HostUpdateCore,
  type HostUpdatePatch,
  HostUpdateSlice,
  type HostUpdateView,
} from "./update-store.ts";
export { useSwitcherHostId, useSwitcherHosts } from "./use-switcher-hosts.ts";
export { wireHealth, wireHostUpdate } from "./wire.ts";
