/**
 * The personas' public entry in the app (#1589, #1596): the roles a session can take on, the hosts'
 * and the app's own. Another domain imports from here, never a file inside. The page
 * (`page.tsx`) and the editor are left out on purpose: `ui/Screens.tsx` loads the page as a lazy
 * chunk, and exporting it here would pull it into the main bundle.
 */
export { type AppPersona, GlobalPersonas, personaInput } from "./global-personas.ts";
export { EFFORTS, ModelSelect, takesEffort } from "./model-select.tsx";
export { type PermissionChoice, PermissionSelect } from "./permission-select.tsx";
export { PersonaPicker, useSuggestedPersona } from "./persona-picker.tsx";
export { PersonaSwitch } from "./persona-switch.tsx";
export {
  initialPersonasState,
  type PersonasCore,
  PersonasSlice,
  type PersonasSliceState,
} from "./store.ts";
export { SubagentsSwitch } from "./subagents-switch.tsx";
export { wirePersonas } from "./wire.ts";
