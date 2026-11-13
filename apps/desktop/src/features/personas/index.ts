/**
 * The personas' public entry in the app (#1589, #1596): the roles a session can take on, the hosts'
 * and the app's own. Another domain imports from here, never a file inside. The page
 * (`page.tsx`) and the editor are left out on purpose: `app/Screens.tsx` loads the page as a lazy
 * chunk, and exporting it here would pull it into the main bundle.
 */

export { takesEffort } from "./effort.ts";
export { type AppPersona, GlobalPersonas, personaInput } from "./global-personas.ts";
export type { PermissionChoice } from "./permission-select.tsx";
export {
  initialPersonasState,
  type PersonasCore,
  PersonasSlice,
  type PersonasSliceState,
} from "./store.ts";
export { wirePersonas } from "./wire.ts";
