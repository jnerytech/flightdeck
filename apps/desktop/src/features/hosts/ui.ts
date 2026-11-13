/**
 * The hosts' components, the screens' entry (#2451): the pieces other screens show for a host (its
 * dot, banners, version tip, folder picker, form and dialogs). State and checks stay in `index.ts`,
 * so a composition file that imports it does not reach the screens. The page stays out, as in
 * `index.ts`: `app/Screens.tsx` loads it as a lazy chunk.
 */

export { AllowedFolders } from "./allowed-folders.tsx";
export { FirstRun } from "./first-run.tsx";
export { FolderPicker } from "./folder-picker.tsx";
export { HostDot } from "./host-dot.tsx";
export { draftFromLink, draftUrl, HostForm } from "./host-form.tsx";
export { HostOfflineBanner } from "./host-offline-banner.tsx";
export { HostVersionTip, hostVersionText } from "./host-version.tsx";
export { HostsBanner } from "./hosts-banner.tsx";
export { RenameHostDialog } from "./rename-host-dialog.tsx";
