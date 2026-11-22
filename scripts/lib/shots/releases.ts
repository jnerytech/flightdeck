import { type FrameRewriter, installHolds } from "./holds.ts";

/** What the What's new print shows (#4059). */
export type ReleasesMode = "list" | "error" | "loading" | "none";

/**
 * The demo's hosts read the app's releases from GitHub, so a print would show whatever was published
 * last and could fail on a rate limit. The What's new prints wrap the page's sockets with this: the
 * answer to `releases.list` is made in the page and never sent (`list`, `error`), left unanswered
 * (`loading`), or the hosts stop offering the feed, so the dialog says no host can read it (`none`).
 *
 * It goes into the page as its source (`releasesScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function releasesRewriter(mode: ReleasesMode): FrameRewriter {
  return {
    fromApp: (frame) => frame,
    fromHost: (frame) => frame,
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `releasesRewriter`. */
export function releasesScript(mode: ReleasesMode): string {
  return `(${installHolds.toString()})(window, () => (${releasesRewriter.toString()})(${JSON.stringify(mode)}));`;
}
