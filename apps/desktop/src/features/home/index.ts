/**
 * Simple mode's app shell, public entry in the app (#1589, #1597): the home, the task and the settings
 * a person who does not work with sessions sees. Another domain imports from here, never a file inside;
 * its components come from `ui.ts` (#2451).
 */

export { HomeCache } from "./home-cache.ts";
export {
  loadChoices,
  type UiMode,
  UiModeSlice,
} from "./simple-mode.ts";
