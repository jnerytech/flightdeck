import type { DepsResult } from "@flightdeck/protocol";

/** The dependencies as the lines `flightdeckd doctor` prints: the headline, then Required and Optional. */
export function formatDeps(_deps: DepsResult, _os: string): string[] {
  return [];
}
