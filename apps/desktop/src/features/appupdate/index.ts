/**
 * The app's own update, public entry in the app (#1589, #1596): the check, the download in the
 * background, the install and the one on quit. Another domain imports from here, never a file inside.
 */
export {
  type AppUpdateCore,
  AppUpdateSlice,
  type AppUpdateState,
  initialAppUpdateState,
} from "./store.ts";
export { UpdateBanner } from "./update-banner.tsx";
export { UpdateCard } from "./update-card.tsx";
export { wireAppUpdates } from "./wire.ts";
