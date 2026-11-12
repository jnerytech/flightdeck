/** The app's frame (shell), public entry (#1589): another folder imports from here, never a file inside. */
export { AccountFooter } from "./account-footer.tsx";
export { AppShell, useHeaderSlot } from "./app-shell.tsx";
export { Breadcrumb } from "./breadcrumb.tsx";
export { breadcrumb } from "./crumbs.ts";
export { NAV_ICONS, type NavKey } from "./nav-icons.ts";
export { QuotaBarList } from "./quota-bars.tsx";
export { ScopeMenu } from "./scope-menu.tsx";
export { ShellPrefs } from "./shell-prefs.ts";
export { Sidebar } from "./sidebar.tsx";
export { SidebarFoldController } from "./sidebar-fold.ts";
export { loadFolded, type SidebarGroup, saveFolded } from "./sidebar-groups.ts";
export { StatusBarSlot } from "./status-bar.tsx";
export { firstTerminalTab, hostsRoute, terminalTabCount } from "./status-bar-summary.ts";
export { HistoryButtons, TopBarActions, TopBarHost } from "./top-bar.tsx";
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
