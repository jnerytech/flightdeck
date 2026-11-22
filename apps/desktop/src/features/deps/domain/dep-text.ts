import type { DepId, DepResult } from "@flightdeck/protocol";
import type { T } from "../../../i18n/index.ts";

/** A dependency's name as the app words it ("GitHub CLI (gh)"), the one the host health screen shows. */
export function depName(_id: DepId, _t: T): string {
  return "";
}

/** What the dependency's absence limits ("Without it: pull requests from a card"); null when it limits nothing. */
export function depBreaksText(_item: DepResult, _t: T): string | null {
  return null;
}
