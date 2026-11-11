/**
 * The permissions' public entry in the app (#1589, #1596): answering a permission request, with the
 * hold a high-risk allow needs, and the always-allow control of a request's card. Another domain
 * imports from here, never a file inside.
 */
export { AlwaysAllow } from "./always-allow.tsx";
export { PermissionsSlice } from "./store.ts";
