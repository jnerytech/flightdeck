/**
 * The files domain's public entry (#1594): the folders and files of a host, listed inside its
 * allowed roots (the project picker, the explorer). Another domain imports from here, never a
 * file inside.
 */
export { listDirs, listFiles } from "./fs-dirs.ts";
