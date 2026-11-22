import type { DepId, DepResult } from "@flightdeck/protocol";
import type { Key, T } from "../../../i18n/index.ts";

/** A dependency's name as the app words it ("GitHub CLI (gh)"), the one the host health screen shows. */
export function depName(id: DepId, t: T): string {
  return t(`hostDeps.names.${id}` as Key);
}

/** What the dependency's absence limits ("Without it: pull requests from a card"); null when it limits nothing. */
export function depBreaksText(item: DepResult, t: T): string | null {
  if (item.breaks.length === 0) return null;
  return t("hostDeps.without", {
    features: item.breaks.map((feature) => t(`hostDeps.breaks.${feature}` as Key)).join(", "),
  });
}
