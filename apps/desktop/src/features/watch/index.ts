/**
 * The PR watch of the cards, public entry in the app (#1589, #1596): a card's watch, its commands
 * and the screen a PR link opens. Another domain imports from here, never a file inside.
 */
export { WatchSlice } from "./store.ts";
export { wireWatch } from "./wire.ts";
