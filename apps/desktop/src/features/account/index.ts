/**
 * The account's public entry in the app (#1589, #1596): the Claude account each host is signed in to,
 * watched while its card is on screen. Another domain imports from here, never a file inside.
 */
export {
  type AccountCore,
  AccountSlice,
  type AccountSliceState,
  initialAccountState,
} from "./store.ts";
export { wireAccount } from "./wire.ts";
