import type { ReactNode } from "react";
import type { SidebarGroup } from "@/features/viewprefs/index.ts";
import type { T } from "@/i18n/index.ts";
import type { AppState } from "@/lib/app-store.ts";
import type { Route } from "@/lib/router.ts";
import { anyHostHas } from "@/lib/version.ts";
import type { NavKey } from "./nav-icons.ts";
import { NAV_ICON, NavButton, NavGroup, NavIcon } from "./sidebar-nav.tsx";

/**
 * The bar's Automation, Observability and Library groups: the items a host offers only from some
 * phase on show when one of the hosts has the feature.
 */
export function SidebarGroups(
  props: Readonly<{
    hosts: AppState["hosts"];
    /** The host the screens that need one open on (none: those items are disabled). */
    navHostId: string | undefined;
    /** The item of the screen the user is on. */
    here: NavKey | null;
    t: T;
    collapsed: boolean;
    folded: readonly SidebarGroup[];
    onToggle(group: SidebarGroup): void;
    go(route: Route): void;
    onOpenProjectScreen(hostId: string, kind: "board" | "workflows"): void;
    /** The badge text of an item, when it has one. */
    badgeOf(key: "teams" | "conversations"): string | undefined;
  }>,
) {
  const { hosts, navHostId, here, t, collapsed, folded, go } = props;
  const item = (key: NavKey, label: string, route: Route, extra?: { badge?: string }) => (
    <NavButton
      collapsed={collapsed}
      icon={<NavIcon name={key} aria-hidden="true" className={NAV_ICON} />}
      active={here === key}
      label={label}
      {...(extra?.badge === undefined ? {} : { badge: extra.badge })}
      onClick={() => go(route)}
    />
  );
  const group = (key: SidebarGroup, label: string, children: ReactNode) => (
    <NavGroup
      label={label}
      collapsed={collapsed}
      folded={folded.includes(key)}
      onToggle={() => props.onToggle(key)}
    >
      {children}
    </NavGroup>
  );
  return (
    <>
      {group(
        "automation",
        t("sidebarGroups.automation"),
        <>
          <NavButton
            collapsed={collapsed}
            icon={<NavIcon name="workflows" aria-hidden="true" className={NAV_ICON} />}
            active={here === "workflows"}
            label={t("sidebar.workflows")}
            disabled={!navHostId}
            onClick={() => navHostId && props.onOpenProjectScreen(navHostId, "workflows")}
          />
          {anyHostHas(hosts, "teams") &&
            item("teams", t("sidebar.teams"), { name: "teams" }, { badge: props.badgeOf("teams") })}
          {/* Hosts from phase 21 carry messages between sessions. */}
          {anyHostHas(hosts, "messaging") &&
            item(
              "conversations",
              t("sidebar.conversations"),
              { name: "conversations" },
              { badge: props.badgeOf("conversations") },
            )}
        </>,
      )}
      {group(
        "observability",
        t("sidebarGroups.observability"),
        <>
          {/* Hosts from phase 8 on read their costs from the transcripts. */}
          {anyHostHas(hosts, "costs") && item("costs", t("sidebar.costs"), { name: "costs" })}
          {item("activity", t("sidebar.activity"), { name: "activity" })}
          <NavButton
            collapsed={collapsed}
            icon={<NavIcon name="history" aria-hidden="true" className={NAV_ICON} />}
            active={here === "history"}
            label={t("sidebar.history")}
            disabled={!navHostId}
            onClick={() => navHostId && go({ name: "history", host: navHostId })}
          />
        </>,
      )}
      {group(
        "library",
        t("sidebarGroups.library"),
        <>
          {/* Hosts from phase 20 keep engineering personas. */}
          {anyHostHas(hosts, "personas") &&
            item("personas", t("sidebar.personas"), { name: "personas" })}
          {/* Hosts from phase 18 keep saved commands and prompts. */}
          {anyHostHas(hosts, "snippets") &&
            item("snippets", t("sidebar.snippets"), { name: "snippets" })}
          {/* Hosts from phase 26 keep Claude Code's plugins. */}
          {anyHostHas(hosts, "plugins") &&
            item("plugins", t("sidebar.plugins"), { name: "plugins" })}
          <NavButton
            collapsed={collapsed}
            icon={<NavIcon name="vault" aria-hidden="true" className={NAV_ICON} />}
            active={here === "vault"}
            label={t("sidebar.vault")}
            chevron
            onClick={() => go({ name: "vault" })}
          />
        </>,
      )}
    </>
  );
}
