import { EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HostView } from "@/features/hosts/index.ts";
import { ProjectTree, RailFlyout } from "@/features/projects/ui.ts";
import type { setupProgress } from "@/features/setup/index.ts";
import type { T } from "@/i18n/index.ts";
import type { Route } from "@/lib/router.ts";
import { ProgressRing } from "@/shared/status/index.ts";
import type { NavKey } from "./nav-icons.ts";
import { NAV_ICON, NavButton, NavGroup, NavIcon } from "./sidebar-nav.tsx";

type TreeProps = ComponentProps<typeof ProjectTree>;

/** The sidebar's Work group: setup, overview, sessions, needs you, projects, board and pull requests. */
export function SidebarWork(
  props: Readonly<{
    t: T;
    collapsed: boolean;
    folded: boolean;
    onToggle(): void;
    /** The sidebar item of the screen the person is on. */
    here: NavKey | null;
    go(route: Route): void;
    /** How many things wait for the person. */
    pending: number;
    showSetup: boolean;
    progress: ReturnType<typeof setupProgress>;
    onHideSetup(): void;
    /** The project tree and the worktree filter it shows; the tree is empty until a host answers. */
    store: TreeProps["store"];
    tree: TreeProps["tree"];
    filter: TreeProps["filter"];
    /** The host the Board opens on; none disables the item. */
    navHost: HostView | undefined;
    onOpenProjectScreen(hostId: string, kind: "board" | "workflows"): void;
  }>,
) {
  const { t, collapsed, go, here, pending, progress, tree } = props;
  // The project tree beside the rail's Projects icon (#689). Only a collapsed bar has it open, so
  // a bar that was expanded meanwhile does not bring it back on the next collapse.
  const [projectsFlyout, setProjectsFlyout] = useState(false);
  const projectsOpen = collapsed && projectsFlyout;
  const { navHost } = props;
  return (
    <NavGroup
      label={t("sidebarGroups.work")}
      collapsed={collapsed}
      folded={props.folded}
      onToggle={props.onToggle}
    >
      {props.showSetup && (
        <div className="group/setup host-row">
          <NavButton
            collapsed={collapsed}
            icon={<ProgressRing done={progress.done} total={progress.total} />}
            active={here === "setup"}
            label={t("setup.title")}
            name={t("setup.row", { done: progress.done, total: progress.total })}
            tail={
              <span className="shrink-0 text-sidebar-foreground/70 text-xs tabular-nums">
                {t("setup.count", { done: progress.done, total: progress.total })}
              </span>
            }
            onClick={() => go({ name: "setup" })}
          />
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover/setup:opacity-100"
              aria-label={t("setup.hide")}
              onClick={props.onHideSetup}
            >
              <EyeOff aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      <NavButton
        collapsed={collapsed}
        icon={<NavIcon name="overview" aria-hidden="true" className={NAV_ICON} />}
        active={here === "overview"}
        label={t("nav.overview")}
        onClick={() => go({ name: "overview" })}
      />
      <NavButton
        collapsed={collapsed}
        icon={<NavIcon name="sessions" aria-hidden="true" className={NAV_ICON} />}
        active={here === "sessions"}
        label={t("sidebar.sessions")}
        name={t("sidebar.openSessions")}
        onClick={() => go({ name: "hub" })}
      />
      <NavButton
        collapsed={collapsed}
        icon={<NavIcon name="needs-you" aria-hidden="true" className={NAV_ICON} />}
        active={here === "needs-you"}
        strong={pending > 0}
        attention={pending > 0}
        {...(pending > 0 ? { hint: String(pending) } : {})}
        label={t("sidebar.needsYou")}
        onClick={() => go({ name: "needs-you" })}
        tail={
          pending > 0 && (
            <Badge className="h-4 min-w-4 px-1 tabular-nums" variant="default">
              {pending}
            </Badge>
          )
        }
      />
      {collapsed && tree.length > 0 ? (
        // The rail has no room for the tree: the icon opens it beside the rail instead.
        <RailFlyout
          label={t("sidebar.projects")}
          open={projectsOpen}
          onOpenChange={setProjectsFlyout}
          trigger={
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="projects" aria-hidden="true" className={NAV_ICON} />}
              active={here === "projects"}
              label={t("sidebar.projects")}
              opens={{ expanded: projectsOpen }}
              onClick={() => setProjectsFlyout(!projectsOpen)}
            />
          }
        >
          <ProjectTree
            store={props.store}
            tree={tree}
            filter={props.filter}
            stay={here === "sessions"}
            allLink
            onPicked={() => setProjectsFlyout(false)}
            t={t}
            go={(route) => {
              setProjectsFlyout(false);
              go(route);
            }}
          />
        </RailFlyout>
      ) : (
        <NavButton
          collapsed={collapsed}
          icon={<NavIcon name="projects" aria-hidden="true" className={NAV_ICON} />}
          active={here === "projects"}
          label={t("sidebar.projects")}
          onClick={() => go({ name: "all-projects" })}
        />
      )}
      {!collapsed && tree.length > 0 && (
        <ProjectTree
          store={props.store}
          tree={tree}
          filter={props.filter}
          stay={here === "sessions"}
          t={t}
          go={go}
        />
      )}
      <NavButton
        collapsed={collapsed}
        icon={<NavIcon name="board" aria-hidden="true" className={NAV_ICON} />}
        active={here === "board"}
        label={t("sidebar.board")}
        disabled={!navHost}
        onClick={() => navHost && props.onOpenProjectScreen(navHost.id, "board")}
      />
      <NavButton
        collapsed={collapsed}
        icon={<NavIcon name="pull-requests" aria-hidden="true" className={NAV_ICON} />}
        active={here === "pull-requests"}
        label={t("sidebar.pullRequests")}
        onClick={() => go({ name: "pull-requests" })}
      />
    </NavGroup>
  );
}
