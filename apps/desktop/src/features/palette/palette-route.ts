import type { PaletteTarget } from "../../lib/palette.ts";
import type { Route } from "../../lib/router.ts";

/** The palette's targets that act in place instead of opening a screen. */
type InPlace =
  | "terminal"
  | "new-terminal"
  | "toggle-theme"
  | "toggle-ui-mode"
  | "switch-language"
  | "start-card"
  | "create-card"
  | "create-card-issue"
  | "start-session"
  | "snippet"
  | "pull-link"
  | "switch-client"
  | "shortcuts"
  | "session-view"
  | "decide-oldest";

/** The screen of a palette target that opens one. */
export function paletteRoute(target: Exclude<PaletteTarget, { kind: InPlace }>): Route {
  return target.kind === "settings" ? { name: "hub" } : { name: "settings" };
}
