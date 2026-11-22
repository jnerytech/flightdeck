/**
 * Issue #3781: what `flightdeckd ui set` prints, as pure rules over the daemon's answer. The command asks
 * the daemon, this words the result.
 */
import type { UiSettings } from "@flightdeck/protocol";

/** The two keys a script reads: how the host presents itself once the change is made. */
export const uiJson = (ui: UiSettings): UiSettings => ({ mode: ui.mode, locked: ui.locked });

/** `mode simple, locked yes`. */
export const uiLine = (ui: UiSettings): string =>
  `mode ${ui.mode}, locked ${ui.locked ? "yes" : "no"}`;

/** The text of a connection that closed after the change went: the host may or may not have made it. */
export const UNSURE =
  "; the host may or may not have made the change; the same command is safe to run again, since it sets and does not toggle";
