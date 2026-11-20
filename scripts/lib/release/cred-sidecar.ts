/** The credential helper (issue #3429) as a Tauri sidecar: where a release build puts it, under what name. */

/** Where the app's release config looks for the helper, relative to `src-tauri` (Tauri adds `-<triple>[.exe]`). */
export const SIDECAR_ENTRY = "";

/** The target triple `rustc -vV` reports for this machine. */
export function hostTriple(_rustcVerbose: string): string {
  return "";
}

/** The file name Tauri expects for the sidecar of `triple`. */
export function sidecarFile(_triple: string): string {
  return "";
}

/** Copies the built helper into the folder Tauri reads sidecars from; returns the new path. */
export function stageCredHelper(_root: string, _triple: string): string {
  return "";
}
