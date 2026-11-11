/**
 * The settings' public entry in the app (#1589, #1596): the person's own choices on this machine
 * (tray, autostart, global shortcut, update and preview switches). Another domain imports from
 * here, never a file inside.
 */
export {
  AUTO_UPDATE_KEY,
  CLOSE_TO_TRAY_KEY,
  initialSettingsState,
  NOTIFY_UPDATES_KEY,
  type Settings,
  type SettingsCore,
  type SettingsPlatform,
  SettingsSlice,
  type SettingsSliceState,
  TELEPORT_PREVIEW_KEY,
} from "./store.ts";
export { wireSettings } from "./wire.ts";
