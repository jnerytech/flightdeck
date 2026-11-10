/**
 * The personas' public entry in the app (#1589, #1596): the roles a session can take on, the hosts'
 * and the app's own. Another domain imports from here, never a file inside.
 */
export { type AppPersona, GlobalPersonas, personaInput } from "./global-personas.ts";
export {
  initialPersonasState,
  type PersonasCore,
  PersonasSlice,
  type PersonasSliceState,
} from "./store.ts";
