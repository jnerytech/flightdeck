/**
 * The hosts' public entry in the app (#1589, #1596): what each host's checks say about its health and
 * its daemon's update, and the pieces other screens show for a host.
 * Another domain imports from here, never a file inside. The page (`page.tsx`) is left out on
 * purpose: `ui/Screens.tsx` loads it as a lazy chunk, and exporting it here would pull it into the
 * main bundle.
 */

export { AllowedFolders } from "./allowed-folders.tsx";
export {
  type HealthAnswer,
  type HealthCore,
  HealthSlice,
  type HealthSliceState,
  initialHealthState,
} from "./health-store.ts";
export { hostNeedsAttention } from "./host-attention.ts";
export { HostDot } from "./host-dot.tsx";
export { hostDownReason } from "./host-down-reason.ts";
export { draftFromLink, draftUrl, type HostDraft, HostForm } from "./host-form.tsx";
export { HostOfflineBanner } from "./host-offline-banner.tsx";
export { HostVersionTip, hostVersionText } from "./host-version.tsx";
export { HostsBanner } from "./hosts-banner.tsx";
export { RenameHostDialog } from "./rename-host-dialog.tsx";
export { HostRosterSlice, type NewHost } from "./roster-store.ts";
export {
  type HostUpdateCore,
  type HostUpdatePatch,
  HostUpdateSlice,
  type HostUpdateView,
} from "./update-store.ts";
export { wireHealth } from "./wire.ts";
