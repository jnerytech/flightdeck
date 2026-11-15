/** The app's frame (shell), public entry (#1589): another folder imports from here, never a file inside. */
export type { Density } from "./density.ts";
export { breadcrumb } from "./domain/crumbs.ts";
export { type TabKind, tabKind } from "./domain/nav-kind.ts";
export { firstTerminalTab, hostsRoute, terminalTabCount } from "./domain/status-bar-summary.ts";
export {
  foldedByDefault,
  liveTone,
  PROJECT_CAP,
  pickedIn,
  projectKey,
  shownProjects,
  TREE_CAP,
  visibleNodes,
} from "./domain/tree-fold.ts";
export type { Orientation } from "./domain/workspace.ts";
export { NAV_ICONS } from "./nav-icons.ts";
export type { ThemeMode } from "./theme.ts";
