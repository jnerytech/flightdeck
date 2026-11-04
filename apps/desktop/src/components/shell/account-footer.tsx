import type { AccountState } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import type { Route } from "../../lib/router.ts";

/** The foot of the sidebar: the Claude account and a menu with Settings, the theme and the manual. */
export function AccountFooter(_props: {
  account: AccountState | null;
  collapsed: boolean;
  t: T;
  go(route: Route): void;
  onToggleTheme(): void;
  onOpenManual(): void;
}) {
  return null;
}
