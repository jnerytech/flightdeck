/**
 * The ROI's public entry in the app (#1589, #1597): the store's slice (#1596). The card's hours
 * field and the board card's return line are components, in ui.ts (#2451). Another domain imports
 * from here, never a file inside. The table, the people list and the settings panel are left out
 * on purpose: only the lazy costs screen uses them (by file path), and exporting them here would
 * pull them into the main bundle.
 */
export { RoiSettingsError } from "./domain/roi-settings.ts";
export { RoiSlice } from "./store.ts";
export { wireRoi } from "./wire.ts";
