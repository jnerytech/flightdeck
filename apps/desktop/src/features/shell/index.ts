/** The app's frame (shell), public entry (#1589): another folder imports from here, never a file inside. */
export type { Density } from "./density.ts";
export { breadcrumb } from "./domain/crumbs.ts";
export { firstTerminalTab, hostsRoute, terminalTabCount } from "./domain/status-bar-summary.ts";
export type { Orientation } from "./domain/workspace.ts";
export { NAV_ICONS, type NavKey } from "./nav-icons.ts";
export { loadFolded, type SidebarGroup, saveFolded } from "./sidebar-groups.ts";
export type { ThemeMode } from "./theme.ts";
export {
  foldedByDefault,
  liveTone,
  loadTreeFolded,
  loadTreeOpened,
  loadTreePinned,
  PROJECT_CAP,
  pickedIn,
  projectKey,
  saveTreeFolded,
  saveTreeOpened,
  saveTreePinned,
  shownProjects,
  TREE_CAP,
  visibleNodes,
} from "./tree-fold.ts";
