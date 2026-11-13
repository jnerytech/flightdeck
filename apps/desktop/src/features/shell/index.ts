/** The app's frame (shell), public entry (#1589): another folder imports from here, never a file inside. */
export { breadcrumb } from "./crumbs.ts";
export type { Density } from "./density.ts";
export { NAV_ICONS, type NavKey } from "./nav-icons.ts";
export { loadFolded, type SidebarGroup, saveFolded } from "./sidebar-groups.ts";
export { firstTerminalTab, hostsRoute, terminalTabCount } from "./status-bar-summary.ts";
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
export type { Orientation } from "./workspace.ts";
