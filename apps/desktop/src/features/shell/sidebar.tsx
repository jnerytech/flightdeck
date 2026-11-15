import { ChevronDown, EyeOff, Plane, Plus } from "lucide-react";
import { type ReactNode, useMemo, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientSwitcher } from "@/features/clients/ui.ts";
import {
  type HostNameError,
  hostNeedsAttention,
  useSwitcherHostId,
  useSwitcherHosts,
} from "@/features/hosts/index.ts";
import { RenameHostDialog } from "@/features/hosts/ui.ts";
import { pendingCount } from "@/features/needs-you/index.ts";
import { activeWorktreeFilter, projectTree } from "@/features/projects/index.ts";
import { ProjectTree, RailFlyout } from "@/features/projects/ui.ts";
import { hubRows, rowRoute } from "@/features/sessions/index.ts";
import { setupProgress, setupSteps } from "@/features/setup/index.ts";
import { type SidebarGroup, toggleGroup } from "@/features/viewprefs/index.ts";
import type { T } from "@/i18n/index.ts";
import { type AppState, type AppStore, type HostView, needsYou } from "@/lib/app-store.ts";
import type { Route } from "@/lib/router.ts";
import { cn } from "@/lib/utils";
import { APP_VERSION, anyHostHas } from "@/lib/version.ts";
import { ConfirmDialog, IconTip } from "@/shared/feedback/index.ts";
import { ProgressRing } from "@/shared/status/index.ts";
import { activeNav } from "./domain/nav-active.ts";
import { type NavBadgeKey, navBadge } from "./domain/nav-badges.ts";
import { SidebarFoot } from "./sidebar-foot.tsx";
import { HostsList, ITEM } from "./sidebar-hosts.tsx";
import { NavButton, NavGroup, NavIcon } from "./sidebar-nav.tsx";

/** A section title that folds its list. */
function SectionTitle(
  props: Readonly<{
    label: string;
    open: boolean;
    onToggle(): void;
    action?: ReactNode;
  }>,
) {
  return (
    <div className="flex items-center justify-between px-2 pt-3">
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="hit-24 flex items-center gap-1 rounded-sm font-medium text-muted-foreground text-xs uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3 transition-transform duration-150", !props.open && "-rotate-90")}
        />
        {props.label}
      </button>
      {props.action}
    </div>
  );
}

/** The app's bar: logo, navigation, hosts, pinned sessions and the footer; a rail of icons when collapsed. */
export function Sidebar(
  props: Readonly<{
    store: AppStore;
    state: AppState;
    collapsed: boolean;
    t: T;
    go(route: Route): void;
    /** Where the user is, to mark the sidebar item of that screen. */
    route?: Route;
    /** The app's version, to know which badges are still due (the app's own unless told). */
    appVersion?: string;
    /** Board or Workflows of a host: its only project opens directly, several ask which. */
    onOpenProjectScreen(hostId: string, kind: "board" | "workflows"): void;
    onNewSession(hostId: string): void;
    onRemoveHost(hostId: string): void;
    onRenameHost(hostId: string, name: string): HostNameError | null;
    onOpenSearch(): void;
    /** The next navigation opens a new tab ("Abrir em nova aba"). */
    onNewTab(): void;
    onToggleTheme(): void;
    /** Opens the sheet of keyboard shortcuts (the account menu, issue #282). */
    onShortcuts?(): void;
    /** Opens What's new: the notes of the latest releases (the account menu, issue #125). */
    onWhatsNew?(): void;
    /** Switches to simple mode; absent when the host in view does not let the person choose. */
    onSimpleMode?(): void;
  }>,
) {
  const { state, t, collapsed, go } = props;
  const badges = {
    beta: t("sidebar.badgeBeta"),
    new: t("sidebar.badgeNew"),
  };
  const version = props.appVersion ?? APP_VERSION;
  // What the person hid from the account menu: the badges, What's new (issue #282).
  const shellPrefs = useSyncExternalStore(
    props.store.shellPrefs.subscribe,
    () => props.store.shellPrefs.value,
  );
  const badgeOf = (key: NavBadgeKey) => {
    const kind = shellPrefs.hideBadges ? null : navBadge(key, version);
    return kind ? badges[kind] : undefined;
  };
  const here = props.route ? activeNav(props.route) : null;
  /**
   * The host the screens that need one open on: the switcher's, as the project tree (#126, #932).
   * With none picked, that is the selected session's host, else the first online (`uiModes.hostId`).
   */
  const switcherId = useSwitcherHostId(props.store);
  const navHost = state.hosts.find((h) => h.id === switcherId) ?? state.hosts[0];
  const pendingItems = needsYou(state);
  const pending = pendingCount(state, pendingItems.length, props.store.now());
  // The sidebar redraws on every store update, streaming events included: the rows and the tree
  // recompute only when the parts they are made of change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows read these parts of the state
  const rows = useMemo(
    () => hubRows(state, t),
    [
      state.hosts,
      state.hub,
      state.meta,
      state.externals,
      state.names,
      state.background,
      state.personas,
      t,
    ],
  );
  const pinned = rows.filter((row) => row.pinned && !row.archived);
  // The tree lists the hosts the switcher shows (#932), as the Projects page does.
  const treeHosts = useSwitcherHosts(props.store, state.hosts);
  const tree = useMemo(
    () => projectTree({ hosts: treeHosts, projects: state.projects, cards: state.cards }, rows),
    [treeHosts, state.projects, state.cards, rows],
  );
  // The setup checklist: from the real state; it leaves when done or hidden.
  const setupHidden = useSyncExternalStore(
    props.store.setup.subscribe,
    () => props.store.setup.hidden,
  );
  const setupNotified = useSyncExternalStore(
    props.store.setup.subscribe,
    () => props.store.setup.notified,
  );
  const setup = useMemo(
    () =>
      setupSteps({
        hosts: state.hosts,
        projects: state.projects,
        cards: state.cards,
        hub: state.hub,
        budgets: state.budgets,
        externals: state.externals,
        probes: state.setupProbes,
        notified: setupNotified,
      }),
    [
      state.hosts,
      state.projects,
      state.cards,
      state.hub,
      state.budgets,
      state.externals,
      state.setupProbes,
      setupNotified,
    ],
  );
  const progress = setupProgress(setup);
  const showSetup = !setupHidden && !progress.complete;
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [folded, setFolded] = useState<SidebarGroup[]>(() => props.store.viewPrefs.sidebarFolded());
  const toggle = (group: SidebarGroup) => {
    const next = toggleGroup(folded, group);
    setFolded(next);
    props.store.viewPrefs.setSidebarFolded(next);
  };
  // The project tree beside the rail's Projects icon (#689). Only a collapsed bar has it open, so
  // a bar that was expanded meanwhile does not bring it back on the next collapse.
  const [projectsFlyout, setProjectsFlyout] = useState(false);
  const projectsOpen = collapsed && projectsFlyout;
  /** The host whose removal is being confirmed. */
  const [removing, setRemoving] = useState<HostView | null>(null);
  const [renaming, setRenaming] = useState<HostView | null>(null);
  const icon = "size-4 shrink-0";
  const needHost = (build: (hostId: string) => Route) => () => {
    if (navHost) go(build(navHost.id));
  };

  /** The host whose page is open. */
  const hereHost = props.route?.name === "host" ? props.route.host : null;
  const hostsList = (
    <HostsList
      hosts={state.hosts}
      deps={state.deps}
      collapsed={collapsed}
      hereHost={hereHost}
      t={t}
      go={go}
      onNewTab={props.onNewTab}
      onNewSession={props.onNewSession}
      onRename={setRenaming}
      onRemove={setRemoving}
    />
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the double click only repeats what a click on an item already did
    <div
      className="flex h-full flex-col gap-1 p-2"
      onDoubleClick={() => props.store.tabs.commit(props.store.tabs.activeId)}
    >
      <div className={cn("flex h-8 items-center gap-2 px-2", collapsed && "justify-center px-0")}>
        <Plane data-logo aria-hidden="true" className="size-5 shrink-0 text-brand" />
        {!collapsed && <span className="font-semibold text-sm">Flightdeck</span>}
      </div>
      <ClientSwitcher
        store={props.store}
        state={state}
        pending={pendingItems}
        collapsed={collapsed}
        go={go}
      />
      {/* The one area that scrolls, between the fixed header and footer (#567). */}
      <div data-slot="sidebar-body" className="sidebar-body">
        <nav aria-label={t("sidebarGroups.main")} className="sidebar-nav">
          <NavGroup
            label={t("sidebarGroups.work")}
            collapsed={collapsed}
            folded={folded.includes("work")}
            onToggle={() => toggle("work")}
          >
            {showSetup && (
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
                    onClick={() => props.store.setup.setHidden(true)}
                  >
                    <EyeOff aria-hidden="true" />
                  </Button>
                )}
              </div>
            )}
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="overview" aria-hidden="true" className={icon} />}
              active={here === "overview"}
              label={t("nav.overview")}
              onClick={() => go({ name: "overview" })}
            />
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="sessions" aria-hidden="true" className={icon} />}
              active={here === "sessions"}
              label={t("sidebar.sessions")}
              name={t("sidebar.openSessions")}
              onClick={() => go({ name: "hub" })}
            />
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="needs-you" aria-hidden="true" className={icon} />}
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
                    icon={<NavIcon name="projects" aria-hidden="true" className={icon} />}
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
                  filter={activeWorktreeFilter(state)}
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
                icon={<NavIcon name="projects" aria-hidden="true" className={icon} />}
                active={here === "projects"}
                label={t("sidebar.projects")}
                onClick={() => go({ name: "all-projects" })}
              />
            )}
            {!collapsed && tree.length > 0 && (
              <ProjectTree
                store={props.store}
                tree={tree}
                filter={activeWorktreeFilter(state)}
                stay={here === "sessions"}
                t={t}
                go={go}
              />
            )}
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="board" aria-hidden="true" className={icon} />}
              active={here === "board"}
              label={t("sidebar.board")}
              disabled={!navHost}
              onClick={() => navHost && props.onOpenProjectScreen(navHost.id, "board")}
            />
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="pull-requests" aria-hidden="true" className={icon} />}
              active={here === "pull-requests"}
              label={t("sidebar.pullRequests")}
              onClick={() => go({ name: "pull-requests" })}
            />
          </NavGroup>
          <NavGroup
            label={t("sidebarGroups.automation")}
            collapsed={collapsed}
            folded={folded.includes("automation")}
            onToggle={() => toggle("automation")}
          >
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="workflows" aria-hidden="true" className={icon} />}
              active={here === "workflows"}
              label={t("sidebar.workflows")}
              disabled={!navHost}
              onClick={() => navHost && props.onOpenProjectScreen(navHost.id, "workflows")}
            />
            {anyHostHas(state.hosts, "teams") && (
              <NavButton
                collapsed={collapsed}
                icon={<NavIcon name="teams" aria-hidden="true" className={icon} />}
                active={here === "teams"}
                label={t("sidebar.teams")}
                badge={badgeOf("teams")}
                onClick={() => go({ name: "teams" })}
              />
            )}
            {/* Hosts from phase 21 carry messages between sessions. */}
            {anyHostHas(state.hosts, "messaging") && (
              <NavButton
                collapsed={collapsed}
                icon={<NavIcon name="conversations" aria-hidden="true" className={icon} />}
                active={here === "conversations"}
                label={t("sidebar.conversations")}
                badge={badgeOf("conversations")}
                onClick={() => go({ name: "conversations" })}
              />
            )}
          </NavGroup>
          <NavGroup
            label={t("sidebarGroups.observability")}
            collapsed={collapsed}
            folded={folded.includes("observability")}
            onToggle={() => toggle("observability")}
          >
            {/* Hosts from phase 8 on read their costs from the transcripts. */}
            {anyHostHas(state.hosts, "costs") && (
              <NavButton
                collapsed={collapsed}
                icon={<NavIcon name="costs" aria-hidden="true" className={icon} />}
                active={here === "costs"}
                label={t("sidebar.costs")}
                onClick={() => go({ name: "costs" })}
              />
            )}
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="activity" aria-hidden="true" className={icon} />}
              active={here === "activity"}
              label={t("sidebar.activity")}
              onClick={() => go({ name: "activity" })}
            />
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="history" aria-hidden="true" className={icon} />}
              active={here === "history"}
              label={t("sidebar.history")}
              disabled={!navHost}
              onClick={needHost((host) => ({ name: "history", host }))}
            />
          </NavGroup>
          <NavGroup
            label={t("sidebarGroups.library")}
            collapsed={collapsed}
            folded={folded.includes("library")}
            onToggle={() => toggle("library")}
          >
            {/* Hosts from phase 20 keep engineering personas. */}
            {anyHostHas(state.hosts, "personas") && (
              <NavButton
                collapsed={collapsed}
                icon={<NavIcon name="personas" aria-hidden="true" className={icon} />}
                active={here === "personas"}
                label={t("sidebar.personas")}
                onClick={() => go({ name: "personas" })}
              />
            )}
            {/* Hosts from phase 18 keep saved commands and prompts. */}
            {anyHostHas(state.hosts, "snippets") && (
              <NavButton
                collapsed={collapsed}
                icon={<NavIcon name="snippets" aria-hidden="true" className={icon} />}
                active={here === "snippets"}
                label={t("sidebar.snippets")}
                onClick={() => go({ name: "snippets" })}
              />
            )}
            {/* Hosts from phase 26 keep Claude Code's plugins. */}
            {anyHostHas(state.hosts, "plugins") && (
              <NavButton
                collapsed={collapsed}
                icon={<NavIcon name="plugins" aria-hidden="true" className={icon} />}
                active={here === "plugins"}
                label={t("sidebar.plugins")}
                onClick={() => go({ name: "plugins" })}
              />
            )}
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="vault" aria-hidden="true" className={icon} />}
              active={here === "vault"}
              label={t("sidebar.vault")}
              chevron
              onClick={() => go({ name: "vault" })}
            />
          </NavGroup>
        </nav>

        <div data-slot="sidebar-hosts" className="sidebar-hosts">
          <NavGroup
            label={t("sidebarGroups.machines")}
            attention={
              state.hosts.some((host) => hostNeedsAttention(host, state.deps[host.id]))
                ? t("sidebarGroups.attention")
                : undefined
            }
            collapsed={collapsed}
            folded={folded.includes("machines")}
            onToggle={() => toggle("machines")}
            action={
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t("sidebar.addHost")}
                onClick={() => go({ name: "add-host" })}
              >
                <Plus />
              </Button>
            }
          >
            {hostsList}
            {/* Hosts from phase 15 keep ssh destinos. */}
            {anyHostHas(state.hosts, "ssh") && (
              <NavButton
                collapsed={collapsed}
                icon={<NavIcon name="connections" aria-hidden="true" className={icon} />}
                active={here === "connections"}
                label={t("sidebar.connections")}
                onClick={() => go({ name: "connections" })}
              />
            )}
          </NavGroup>
        </div>

        <div>
          {!collapsed && (
            <>
              {pinned.length > 0 && (
                <>
                  <SectionTitle
                    label={t("sidebar.pinned")}
                    open={pinnedOpen}
                    onToggle={() => setPinnedOpen(!pinnedOpen)}
                  />
                  {pinnedOpen && (
                    <ul className="flex flex-col gap-0.5">
                      {pinned.map((row) => (
                        <li key={row.key}>
                          <IconTip label={`${row.title} · ${row.hostName}`}>
                            <button
                              type="button"
                              className={ITEM}
                              onClick={() => go(rowRoute(row))}
                            >
                              <span className="min-w-0 flex-1 truncate">{row.title}</span>
                            </button>
                          </IconTip>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <SidebarFoot
        store={props.store}
        state={state}
        collapsed={collapsed}
        t={t}
        go={go}
        route={props.route}
        version={version}
        shellPrefs={shellPrefs}
        setupHidden={setupHidden}
        settingsActive={here === "settings"}
        onOpenSearch={props.onOpenSearch}
        onToggleTheme={props.onToggleTheme}
        onShortcuts={props.onShortcuts}
        onWhatsNew={props.onWhatsNew}
        onSimpleMode={props.onSimpleMode}
      />
      {renaming && (
        <RenameHostDialog
          name={renaming.name}
          onRename={(name) => props.onRenameHost(renaming.id, name)}
          onClose={() => setRenaming(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          message={t("sidebar.removeConfirm", { host: removing.name })}
          confirmLabel={t("sidebar.removeHost")}
          destructive
          onConfirm={() => {
            props.onRemoveHost(removing.id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
