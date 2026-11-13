/**
 * The tabs' public entry in the app (#1589, #1605): the tab strip and the Ctrl+Tab switcher, and what a tab
 * shows and says. Another domain imports from here, never a file inside. The strip and the switcher
 * are components, in ui.ts (#2451).
 */

export { tabFacts } from "./tab-facts.ts";
export { tabIntent } from "./tab-shortcut.ts";
export type { TabOrder } from "./tab-switcher.ts";
