/**
 * Notification preferences, the notify policy and the sound, public entry (#1589): another domain
 * imports from here, never a file inside. The preferences section component is in ui.ts (#2451).
 */
export {
  DEFAULT_NOTIFY_PREFS,
  decide,
  type NotifyEvent,
  NotifyPreferences,
  type NotifyPrefs,
  type NotifySource,
} from "./notify-policy.ts";
export { browserSound, playNotifySound } from "./notify-sound.ts";
