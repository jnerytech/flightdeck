/**
 * The ROI's public entry in the app (#1589, #1597): the card's hours field, the board card's
 * return line and the store's slice (#1596). Another domain imports from here, never a file
 * inside. The table, the people list and the settings panel are left out on purpose: only the lazy
 * costs screen uses them (by file path), and exporting them here would pull them into the main
 * bundle.
 */
export { CardHours } from "./card-hours.tsx";
export { RoiCard } from "./roi-card.tsx";
export { RoiSlice } from "./store.ts";
