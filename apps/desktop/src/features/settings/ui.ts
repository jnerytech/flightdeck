/**
 * The settings' wiring for a screen (#2451): the functions the settings page gets, one set per store.
 * They read the store, so they stay out of `index.ts`, which the store itself imports.
 */
export { settingsActions } from "./settings-actions.ts";
