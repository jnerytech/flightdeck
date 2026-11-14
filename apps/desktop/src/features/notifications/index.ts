/**
 * Notification preferences, the notify policy and the sound, public entry (#1589): another domain
 * imports from here, never a file inside. The preferences section component is in ui.ts (#2451).
 */

export { browserSound } from "./browser-sound.ts";
export {
  DEFAULT_NOTIFY_PREFS,
  decide,
  type NotifyEvent,
  type NotifyPrefs,
  type NotifySource,
} from "./domain/notify-policy.ts";
export { playNotifySound } from "./domain/notify-sound.ts";
export { NotifyPreferences } from "./notify-preferences.ts";
