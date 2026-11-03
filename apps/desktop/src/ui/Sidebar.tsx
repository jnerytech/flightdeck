import {
  ChevronDown,
  CircleAlert,
  type LucideProps,
  MoreHorizontal,
  Plane,
  Plus,
  Search,
  SunMoon,
  TriangleAlert,
} from "lucide-react";
import { Children, type ReactNode, useState } from "react";
import { ClientSwitcher } from "@/components/clients/client-switcher";
import { NAV_ICONS, type NavKey } from "@/components/nav-icons";
import { StatusDot } from "@/components/status/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Key, T } from "../i18n/index.ts";
import { type AppState, type AppStore, type HostView, needsYou } from "../lib/app-store.ts";
import { budgetAlerts } from "../lib/budgets.ts";
import type { HostNameError } from "../lib/host-name.ts";
import { hostDotView } from "../lib/host-status.ts";
import { hubRows } from "../lib/hub.ts";
import { activeNav } from "../lib/nav-active.ts";
import type { Route } from "../lib/router.ts";
import type { SidebarGroup } from "../lib/sidebar-groups.ts";
import { APP_VERSION, hasFeature } from "../lib/version.ts";
import { watchAlerts } from "../lib/watch-alerts.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RenameHostDialog } from "./RenameHostDialog.tsx";
import { rowRoute } from "./Screens.tsx";

const ITEM =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-normal text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The icon of one of the screens the bar lists, the same one its tab wears. */
function NavIcon({ name, ...props }: LucideProps & { name: NavKey }) {
  const Icon = NAV_ICONS[name];
  return <Icon {...props} />;
}

/** One line of the bar: an icon, its label (hidden in the rail, which keeps it as a tooltip) and a tail. */
function NavButton(props: {
  icon: ReactNode;
  label: string;
  /** The accessible name, when it is not the visible label. */
  name?: string;
  collapsed: boolean;
  onClick(): void;
  disabled?: boolean;
  /** A chip or badge after the label: expanded only, the rail has no room for it. */
  tail?: ReactNode;
  /** What the tail says in words (a count, a shortcut): the rail moves it to the name and the tooltip. */
  hint?: string;
  /** The keys that open this item, for assistive technology (`Control+K`). */
  keys?: string;
  /** Something waits here: the rail marks the icon with a dot instead of a badge. */
  attention?: boolean;
  /** The screen the user is on: full contrast and marked as the current page. */
  active?: boolean;
  /** Something waits here: full contrast even when it is not the open screen. */
  strong?: boolean;
}) {
  const railName = props.hint ? `${props.label} (${props.hint})` : props.label;
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      aria-keyshortcuts={props.keys}
      className={cn(
        ITEM,
        props.collapsed && "justify-center px-0",
        (props.active || props.strong) && "text-sidebar-foreground",
        props.active && "bg-sidebar-accent font-medium",
      )}
      aria-label={props.name ?? (props.collapsed ? railName : undefined)}
      title={props.collapsed ? railName : undefined}
      disabled={props.disabled ?? false}
      onClick={props.onClick}
    >
      {props.collapsed && props.attention ? (
        <span className="relative flex">
          {props.icon}
          <span
            data-attention
            aria-hidden="true"
            className="-right-0.5 -top-0.5 absolute size-2 rounded-full bg-primary"
          />
        </span>
      ) : (
        props.icon
      )}
      {!props.collapsed && <span className="min-w-0 flex-1 truncate">{props.label}</span>}
      {!props.collapsed && props.tail}
    </button>
  );
}

/** A section title that folds its list. */
function SectionTitle(props: {
  label: string;
  open: boolean;
  onToggle(): void;
  action?: ReactNode;
}) {
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

/**
 * A titled group of items that folds. Without items it is not drawn; in the icon rail it is only
 * a run of icons, since a heading has no room there.
 */
function NavGroup(props: {
  id: string;
  label: string;
  collapsed: boolean;
  folded: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  const items = Children.toArray(props.children).filter(Boolean);
  if (items.length === 0) return null;
  if (props.collapsed) {
    return (
      <fieldset aria-label={props.label} className="sidebar-group">
        {items}
      </fieldset>
    );
  }
  return (
    <fieldset aria-label={props.label} className="sidebar-group">
      <button
        type="button"
        aria-expanded={!props.folded}
        onClick={props.onToggle}
        className="sidebar-group-title"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3 transition-transform duration-150", props.folded && "-rotate-90")}
        />
        {props.label}
      </button>
      {!props.folded && items}
    </fieldset>
  );
}

/** The app's bar: logo, navigation, hosts, pinned sessions and the footer; a rail of icons when collapsed. */
export function Sidebar(props: {
  store: AppStore;
  state: AppState;
  collapsed: boolean;
  t: T;
  go(route: Route): void;
  /** Where the user is, to mark the sidebar item of that screen. */
  route?: Route;
  /** Board or Workflows of a host: its only project opens directly, several ask which. */
  onOpenProjectScreen(hostId: string, kind: "board" | "workflows"): void;
  onNewSession(hostId: string): void;
  onRemoveHost(hostId: string): void;
  onRenameHost(hostId: string, name: string): HostNameError | null;
  onOpenSearch(): void;
  /** The next navigation opens a new tab ("Abrir em nova aba"). */
  onNewTab(): void;
  onToggleTheme(): void;
}) {
  const { state, t, collapsed, go } = props;
  const here = props.route ? activeNav(props.route) : null;
  /** The host the screens that need one open on: the selected one, else the first online. */
  const navHost =
    (state.selected && state.hosts.find((h) => h.id === state.selected?.hostId)) ||
    state.hosts.find((h) => h.status === "online") ||
    state.hosts[0];
  const pendingItems = needsYou(state);
  const pending =
    pendingItems.length +
    budgetAlerts(state).length +
    state.loopAlerts.length +
    watchAlerts(state).length;
  const pinned = hubRows(state).filter((row) => row.pinned && !row.archived);
  const [hostsOpen, setHostsOpen] = useState(true);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [folded, setFolded] = useState<SidebarGroup[]>(() => props.store.sidebarFolded());
  const toggle = (group: SidebarGroup) => {
    const next = folded.includes(group) ? folded.filter((g) => g !== group) : [...folded, group];
    setFolded(next);
    props.store.setSidebarFolded(next);
  };
  /** The host whose removal is being confirmed. */
  const [removing, setRemoving] = useState<HostView | null>(null);
  const [renaming, setRenaming] = useState<HostView | null>(null);
  const icon = "size-4 shrink-0";
  const needHost = (build: (hostId: string) => Route) => () => {
    if (navHost) go(build(navHost.id));
  };

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
      <nav aria-label={t("sidebarGroups.main")} className="sidebar-nav">
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
        <NavButton
          collapsed={collapsed}
          icon={<NavIcon name="projects" aria-hidden="true" className={icon} />}
          active={here === "projects"}
          label={t("sidebar.projects")}
          onClick={() => go({ name: "all-projects" })}
        />
        <NavButton
          collapsed={collapsed}
          icon={<NavIcon name="board" aria-hidden="true" className={icon} />}
          active={here === "board"}
          label={t("sidebar.board")}
          disabled={!navHost}
          onClick={() => navHost && props.onOpenProjectScreen(navHost.id, "board")}
        />
        <NavGroup
          id="work"
          label={t("sidebarGroups.work")}
          collapsed={collapsed}
          folded={folded.includes("work")}
          onToggle={() => toggle("work")}
        >
          <NavButton
            collapsed={collapsed}
            icon={<NavIcon name="workflows" aria-hidden="true" className={icon} />}
            active={here === "workflows"}
            label={t("sidebar.workflows")}
            disabled={!navHost}
            onClick={() => navHost && props.onOpenProjectScreen(navHost.id, "workflows")}
          />
          {/* Hosts from phase 8 on read their costs from the transcripts. */}
          {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "costs", false)) && (
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="costs" aria-hidden="true" className={icon} />}
              active={here === "costs"}
              label={t("sidebar.costs")}
              onClick={() => go({ name: "costs" })}
            />
          )}
          {/* Hosts from phase 21 carry messages between sessions. */}
          {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "messaging", false)) && (
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="conversations" aria-hidden="true" className={icon} />}
              active={here === "conversations"}
              label={t("sidebar.conversations")}
              onClick={() => go({ name: "conversations" })}
            />
          )}
          {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "teams", false)) && (
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="teams" aria-hidden="true" className={icon} />}
              active={here === "teams"}
              label={t("sidebar.teams")}
              onClick={() => go({ name: "teams" })}
            />
          )}
        </NavGroup>
        <NavGroup
          id="library"
          label={t("sidebarGroups.library")}
          collapsed={collapsed}
          folded={folded.includes("library")}
          onToggle={() => toggle("library")}
        >
          {/* Hosts from phase 20 keep engineering personas. */}
          {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "personas", false)) && (
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="personas" aria-hidden="true" className={icon} />}
              label={t("sidebar.personas")}
              onClick={() => go({ name: "personas" })}
            />
          )}
          {/* Hosts from phase 18 keep saved commands and prompts. */}
          {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "snippets", false)) && (
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="snippets" aria-hidden="true" className={icon} />}
              label={t("sidebar.snippets")}
              onClick={() => go({ name: "snippets" })}
            />
          )}
          {/* Hosts from phase 26 keep Claude Code's plugins. */}
          {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "plugins", false)) && (
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="plugins" aria-hidden="true" className={icon} />}
              label={t("sidebar.plugins")}
              onClick={() => go({ name: "plugins" })}
            />
          )}
          <NavButton
            collapsed={collapsed}
            icon={<NavIcon name="vault" aria-hidden="true" className={icon} />}
            label={t("sidebar.vault")}
            onClick={() => go({ name: "vault" })}
          />
        </NavGroup>
        <NavGroup
          id="infra"
          label={t("sidebarGroups.infra")}
          collapsed={collapsed}
          folded={folded.includes("infra")}
          onToggle={() => toggle("infra")}
        >
          {/* Hosts from phase 15 keep ssh destinos. */}
          {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "ssh", false)) && (
            <NavButton
              collapsed={collapsed}
              icon={<NavIcon name="connections" aria-hidden="true" className={icon} />}
              label={t("sidebar.connections")}
              onClick={() => go({ name: "connections" })}
            />
          )}
          <NavButton
            collapsed={collapsed}
            icon={<NavIcon name="history" aria-hidden="true" className={icon} />}
            label={t("sidebar.history")}
            disabled={!navHost}
            onClick={needHost((host) => ({ name: "history", host }))}
          />
        </NavGroup>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 pt-3">
            {state.hosts.map((host) => (
              <button
                key={host.id}
                type="button"
                aria-label={t("sidebar.openHost", { host: host.name })}
                title={host.name}
                className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent"
                onClick={() => go({ name: "host", host: host.id })}
              >
                <HostDot host={host} t={t} />
              </button>
            ))}
          </div>
        ) : (
          <>
            <SectionTitle
              label={t("sidebar.hosts")}
              open={hostsOpen}
              onToggle={() => setHostsOpen(!hostsOpen)}
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
            />
            {hostsOpen && (
              <ul className="flex flex-col gap-0.5">
                {state.hosts.map((host) => (
                  <li key={host.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      className={cn(ITEM, "min-w-0 flex-1")}
                      aria-label={t("sidebar.openHost", { host: host.name })}
                      onClick={() => go({ name: "host", host: host.id })}
                    >
                      <HostDot host={host} t={t} />
                      <span className="min-w-0 flex-1 truncate">{host.name}</span>
                    </button>
                    {host.hostInfo?.apiKeySanitized === false && (
                      <TriangleAlert
                        role="img"
                        aria-label={t("sidebar.keyPassed", { host: host.name })}
                        className="size-3.5 shrink-0 text-status-needs-you"
                      />
                    )}
                    {host.hostInfo && host.hostInfo.daemonVersion !== APP_VERSION && (
                      <CircleAlert
                        role="img"
                        aria-label={t("sidebar.versionDiffers", { host: host.name })}
                        className="size-3.5 shrink-0 text-status-needs-you"
                      >
                        <title>
                          {t("sidebar.versionTitle", {
                            daemon: host.hostInfo.daemonVersion,
                            app: APP_VERSION,
                          })}
                        </title>
                      </CircleAlert>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label={t("sidebar.hostMenu", { host: host.name })}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {/* An incompatible host offers nothing but its page and removal. */}
                        <DropdownMenuItem
                          onSelect={() => {
                            props.onNewTab();
                            go({ name: "host", host: host.id });
                          }}
                        >
                          {t("tabs.openInNew")}
                        </DropdownMenuItem>
                        {host.status !== "incompatible" && (
                          <>
                            <DropdownMenuItem
                              onSelect={() => go({ name: "history", host: host.id })}
                            >
                              {t("sidebar.hostHistory")}
                            </DropdownMenuItem>
                            {hasFeature(host.hostInfo?.features, "workflows", true) && (
                              <DropdownMenuItem
                                onSelect={() => go({ name: "projects", host: host.id })}
                              >
                                {t("sidebar.hostProjects")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => props.onNewSession(host.id)}>
                              {t("sidebar.newSession")}
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem onSelect={() => setRenaming(host)}>
                          {t("hostPage.rename")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRemoving(host)}>
                          {t("sidebar.removeHost")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            )}
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
                        <button
                          type="button"
                          className={ITEM}
                          title={`${row.title} · ${row.hostName}`}
                          onClick={() => go(rowRoute(row))}
                        >
                          <span className="min-w-0 flex-1 truncate">{row.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-0.5 border-t pt-2">
        <NavButton
          collapsed={collapsed}
          icon={<Search aria-hidden="true" className={icon} />}
          label={t("sidebar.search")}
          name={t("sidebar.searchLabel")}
          hint="Ctrl K"
          keys="Control+K"
          onClick={props.onOpenSearch}
          tail={
            <kbd className="rounded border bg-background px-1 font-mono text-[11px] text-muted-foreground">
              Ctrl K
            </kbd>
          }
        />
        <NavButton
          collapsed={collapsed}
          icon={<NavIcon name="settings" aria-hidden="true" className={icon} />}
          label={t("sidebar.settings")}
          onClick={() => go({ name: "settings" })}
        />
        <NavButton
          collapsed={collapsed}
          icon={<SunMoon aria-hidden="true" className={icon} />}
          label={t("sidebar.theme")}
          onClick={props.onToggleTheme}
        />
      </div>
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

/** A host's connection state as a dot. */
function HostDot(props: { host: HostView; t: T }) {
  return (
    <StatusDot
      {...hostDotView(props.host.status)}
      label={props.t("sidebar.hostState", {
        host: props.host.name,
        state: props.t(`hosts.status.${props.host.status}` as Key),
      })}
    />
  );
}
