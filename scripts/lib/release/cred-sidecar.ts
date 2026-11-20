/** The credential helper (issue #3429) as a Tauri sidecar: where a release build puts it, under what name. */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Where the app's release config looks for the helper, relative to `src-tauri` (Tauri adds `-<triple>[.exe]`). */
export const SIDECAR_ENTRY = "binaries/flightdeck-cred";

const SRC_TAURI = "apps/desktop/src-tauri";
const isWindows = (triple: string) => triple.includes("windows");

/** The target triple `rustc -vV` reports for this machine. */
export function hostTriple(rustcVerbose: string): string {
  const host = /^host: (\S+)$/m.exec(rustcVerbose);
  if (host === null) throw new Error("rustc -vV printed no host line");
  return host[1] as string;
}

/** The file name Tauri expects for the sidecar of `triple`. */
export function sidecarFile(triple: string): string {
  return `flightdeck-cred-${triple}${isWindows(triple) ? ".exe" : ""}`;
}

/** Copies the built helper into the folder Tauri reads sidecars from; returns the new path. */
export function stageCredHelper(root: string, triple: string): string {
  const built = join(
    root,
    SRC_TAURI,
    "target/release",
    isWindows(triple) ? "flightdeck-cred.exe" : "flightdeck-cred",
  );
  if (!existsSync(built)) throw new Error(`flightdeck-cred was not built: ${built} is missing`);
  const folder = join(root, SRC_TAURI, "binaries");
  mkdirSync(folder, { recursive: true });
  const staged = join(folder, sidecarFile(triple));
  copyFileSync(built, staged);
  return staged;
}
