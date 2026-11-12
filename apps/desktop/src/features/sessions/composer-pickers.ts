import type { PermissionMode } from "@flightdeck/protocol";
import { type ModeRow, modeRows } from "../../lib/mode-menu.ts";

/** Whether the composer offers a model picker: the session lets it change and, on OpenCode, the host listed models. */
export function offersModelPicker(opts: {
  settings: boolean;
  canSetModel: boolean;
  opencode: boolean;
  hasModels: boolean;
}): boolean {
  return opts.settings && opts.canSetModel && (!opts.opencode || opts.hasModels);
}

/** The rows of the mode menu: blocked ones marked, and no accept-edits on OpenCode, which has none. */
export function composerModeMenu(opts: {
  current: PermissionMode | null;
  start: PermissionMode | null;
  bypassAllowed: boolean;
  opencode: boolean;
}): ModeRow[] {
  // An unknown start blocks nothing as looser (the loosest mode is the base): the host refuses a
  // looser mode itself, and the menu must not claim a start it does not know.
  return modeRows({
    current: opts.current,
    start: opts.start ?? "bypassPermissions",
    bypassAllowed: opts.bypassAllowed,
  }).filter((row) => !opts.opencode || row.mode !== "acceptEdits");
}
