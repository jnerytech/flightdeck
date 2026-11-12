/**
 * The tabs' public entry in the app (#1589, #1605): the tab strip and the Ctrl+Tab switcher, and what a tab
 * shows and says. Another domain imports from here, never a file inside.
 */

export { tabKind } from "./tab-badge.ts";
export { TabBar } from "./tab-bar.tsx";
export { tabFacts } from "./tab-facts.ts";
export { switcherHosts } from "./tab-scope.ts";
export { tabIntent } from "./tab-shortcut.ts";
export type { TabOrder } from "./tab-switcher.ts";
export { TabSwitcherHost } from "./tab-switcher.tsx";
export { type Navigation, type Tab, Tabs } from "./tabs.ts";
