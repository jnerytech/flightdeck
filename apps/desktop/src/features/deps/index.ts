/**
 * The dependencies' public entry in the app (#1589, #1597): the cards that say which tools a host
 * is missing and how to install them, and the summary of a host's checks. Another domain imports
 * from here, never a file inside.
 */
export {
  type DepLook,
  depLook,
  depsSummary,
  fixFor,
  fixNoteFor,
  fixPageFor,
  requiredMissing,
} from "./deps-summary.ts";
export { MissingToolsCards } from "./missing-tools-cards.tsx";
