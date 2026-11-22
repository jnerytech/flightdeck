import type { FrameRewriter } from "./holds.ts";

/** #3987 (stub): the Teleport prints answer for the hosts; filled in by the next commit. */
export function teleportRewriter(_refuses = false): FrameRewriter {
  return { fromApp() {}, fromHost: (frame) => frame };
}

/** The init script a print adds: the page's WebSocket wrapped with `teleportRewriter`. */
export function teleportScript(_refuses: boolean): string {
  return "";
}
