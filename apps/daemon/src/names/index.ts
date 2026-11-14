/**
 * The names' public entry (#1589): the standard names of the host's sessions and the slug they are
 * built from. Another domain imports from here, never a file inside.
 */
export { slug } from "./format.ts";
export type { Names } from "./names.ts";
export { adoptTitles, type TrackOptions, trackNames, warmKnown } from "./track.ts";
