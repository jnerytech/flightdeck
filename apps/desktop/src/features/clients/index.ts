/**
 * Which client the person works for, public entry in the app (#1589, #1596): the selection of the
 * work screens and the client of each project. Another domain imports from here, never a file inside.
 */
export { ClientScopeSlice } from "./scope-store.ts";
export { wireClientScope } from "./wire.ts";
