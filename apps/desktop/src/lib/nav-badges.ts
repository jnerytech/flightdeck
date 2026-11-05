import { APP_VERSION, isNewer } from "./version.ts";

/** The sidebar items that wear a badge, and the version from which they stop wearing it. */
export type NavBadgeKey = "teams" | "conversations";

export interface NavBadgeRule {
  kind: "beta" | "new";
  /** The first version without the badge. */
  until: string;
}

export const NAV_BADGES: Record<NavBadgeKey, NavBadgeRule> = {
  teams: { kind: "beta", until: "0.39.0" },
  conversations: { kind: "new", until: "0.38.0" },
};

/** The badge an item wears at `version`: its kind, or null once the version reaches `until`. */
export function navBadge(key: NavBadgeKey, version: string = APP_VERSION): "beta" | "new" | null {
  const rule = NAV_BADGES[key];
  // A release candidate counts as the version it leads up to; anything else keeps the badge.
  const released = version.split("-")[0] ?? version;
  return isNewer(released, rule.until) || released === rule.until ? null : rule.kind;
}
