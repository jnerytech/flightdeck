/**
 * The dependencies' public entry in the app (#1589, #1597): which tools a host is missing and how
 * to install them, and the summary of a host's checks. The cards that show them are in ui.ts
 * (#2451). Another domain imports from here, never a file inside.
 */
export {
  type DepLook,
  depLook,
  depsSummary,
  fixFor,
  fixNoteFor,
  fixPageFor,
  requiredMissing,
} from "./domain/deps-summary.ts";
