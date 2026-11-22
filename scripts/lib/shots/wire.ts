import type { FrameRewriter } from "./holds.ts";

/** What a print does to one command on the page's sockets (#3982). */
export type WireRule =
  | { command: string; refuse: string }
  | { command: string; data: unknown }
  | { command: string; as: string };

/** Stub: passes every frame as it came. */
export function wireRewriter(_rules: WireRule[]): FrameRewriter {
  return { fromApp: (frame) => frame, fromHost: (frame) => frame };
}

/** Stub: an init script that does nothing. */
export function wireScript(_rules: WireRule[]): string {
  return "";
}
