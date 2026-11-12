import type { PermissionMode } from "@flightdeck/protocol";
import type { ModeRow } from "../../lib/mode-menu.ts";

/** Whether the composer offers a model picker: the session lets it change and, on OpenCode, the host listed models. */
export function offersModelPicker(_opts: {
  settings: boolean;
  canSetModel: boolean;
  opencode: boolean;
  hasModels: boolean;
}): boolean {
  return false;
}

/** The rows of the mode menu: blocked ones marked, and no accept-edits on OpenCode, which has none. */
export function composerModeMenu(_opts: {
  current: PermissionMode | null;
  start: PermissionMode | null;
  bypassAllowed: boolean;
  opencode: boolean;
}): ModeRow[] {
  return [];
}
